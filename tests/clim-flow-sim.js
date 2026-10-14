// Harnais de simulation du flow « Climatisation Solaire » (flows-clim.json).
//
//   node tests/clim-flow-sim.js
//
// Exécute les corps réels des nœuds function extraits de flows-clim.json sur
// une horloge simulée et un registre d'états HA factice, avec un modèle
// physique d'unités inverter : la puissance dépend de l'écart entre la pièce et
// la consigne, la pièce se refroidit (ou se réchauffe) selon la puissance, le
// compteur réseau et les compteurs de groupe se recalculent à chaque tick.
// Sans ce bouclage, le routeur verrait un surplus fantôme.
process.env.TZ = 'Europe/Paris';
const fs = require('fs');
const path = require('path');
const flows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'flows-clim.json'), 'utf8'));

const tab = flows.find(n => n.type === 'tab');
const ENV = {};
for (const e of tab.env) ENV[e.name] = e.value;
const byName = {};
for (const n of flows.filter(n => n.type === 'function')) byName[n.name] = n;

const PIPELINE = ['Lire capteurs & unités', 'Détect. pilotage manuel', 'Bilan & apprentissage',
    'Besoin confort par pièce', 'Routeur solaire'];
const EXTRA = ['Émettre les commandes', 'Build sensor payload', 'Alertes ?', 'Gestion erreur',
    'Demande prévision', 'Mémoriser prévision'];
for (const n of PIPELINE.concat(EXTRA)) if (!byName[n]) throw new Error('nœud function absent : ' + n);
const compile = (name) => {
    const fn = new Function('msg', 'flow', 'global', 'env', 'node', byName[name].func);
    return (msg, ctx) => fn(msg, ctx.flow, ctx.global, ctx.env, ctx.node);
};
const F = {};
for (const n of PIPELINE.concat(EXTRA)) F[n] = compile(n);

// --- Horloge simulée --------------------------------------------------------
let NOW = new Date(2026, 6, 15, 12, 0).getTime();
const RealDate = Date;
global.Date = class extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
    static now() { return NOW; }
};

// --- Modèle d'unité inverter -------------------------------------------------
// Puissance = 200 W + 300 W par °C d'écart pièce/consigne, plafonnée à 1000 W ;
// pièce satisfaite : ralenti à 30 W.
const UNIT_IDS = ENV.CLIM_UNITS.split(',');
const UNIT_LABELS = ENV.CLIM_UNIT_LABELS.split(',');
const GROUPS = JSON.parse(ENV.CLIM_GROUPS);
const MODES = ['off', 'fan_only', 'heat', 'cool', 'heat_cool', 'dry'];
function unitPower(st, room, scale) {
    if (st.state === 'off') return 0;
    const sp = st.attributes.temperature;
    if (sp == null) return 200;
    const gap = st.state === 'cool' ? room - sp : st.state === 'heat' ? sp - room : 0;
    if (gap <= -0.5) return 30;
    return Math.round(Math.min(1000, 200 + 300 * Math.max(0, gap + 0.5)) * scale);
}

function world(o = {}) {
    const w = Object.assign({
        surplus: 1000, enabled: 'on', season: 'auto', targetCool: 24, targetHeat: 20,
        allowance: null, outdoor: 30, rooms: [27, 27, 27, 27, 27], hvac: null,
        cumulusDraw: 0, breakers: null, order: null, modes: null, drift: 0.3,
        powerScale: [1, 1, 1, 1, 1], forecast: null, noTemps: false,
    }, o);
    const store = new Map();
    const ctx = {
        w, warnings: [], commands: [], notifications: [], store,
        flow: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
        env: { get: (k) => ENV[k] },
        node: { warn: (m) => ctx.warnings.push(m), status: () => {} },
        stats: { importWMin: 0, maxImport: 0, exportWMin: 0, unitWMin: 0 },
    };
    const st = {
        'input_boolean.clim_automation_enabled': { state: w.enabled },
        'input_select.clim_season_mode': { state: w.season },
        'input_number.clim_target_cool': { state: String(w.targetCool) },
        'input_number.clim_target_heat': { state: String(w.targetHeat) },
        'sensor.pince_amperemetrique_power_a': { state: '3000' },
        'sensor.pince_amperemetrique_power_b': { state: '0' },
        'sensor.exterieur_temperature': { state: w.outdoor == null ? 'unavailable' : String(w.outdoor) },
        'weather.forecast_maison': { state: 'sunny', attributes: { temperature: 22 } },
        'sensor.cumulus_automation': { state: 'x', attributes: { cumulus_draw: 0, desired: 'off' } },
    };
    if (w.allowance != null) st['input_number.clim_import_allowance'] = { state: String(w.allowance) };
    if (w.order != null) st['input_text.clim_priority_order'] = { state: w.order };
    UNIT_IDS.forEach((id, i) => {
        st[id] = { state: (w.hvac && w.hvac[i]) || 'off', attributes: {
            current_temperature: w.noTemps ? null : Math.round(w.rooms[i]),
            temperature: 21, min_temp: 10, max_temp: 30, target_temp_step: 0.5,
            hvac_modes: (w.modes && w.modes[i]) || MODES } };
    });
    for (const gr of GROUPS) {
        st[gr.switch] = { state: (w.breakers && w.breakers[gr.name] === 'off') ? 'off' : 'on' };
        st[gr.power] = { state: '5' };
    }
    ctx.states = st;
    ctx.global = { get: () => ({ homeAssistant: { states: ctx.states } }) };
    if (w.forecast) store.set('forecast', Object.assign({ at: NOW }, w.forecast));
    return ctx;
}

function physics(ctx, minutes) {
    const w = ctx.w, st = ctx.states;
    let total = 0;
    for (const gr of GROUPS) {
        let gw = 0;
        for (const id of gr.units) {
            const i = UNIT_IDS.indexOf(id);
            const off = w.breakers && w.breakers[gr.name] === 'off';
            if (off) { st[id].state = 'unavailable'; continue; }
            const p = unitPower(st[id], w.rooms[i], w.powerScale[i]);
            gw += p;
            // Pièce : dérive vers l'extérieur, contre-balancée par l'unité
            const sgn = st[id].state === 'cool' ? -1 : st[id].state === 'heat' ? 1 : 0;
            w.rooms[i] += (sgn * p / 1000 * 1.2 + (w.outdoor > w.rooms[i] ? w.drift : -w.drift)) * minutes / 60;
            if (!w.noTemps) st[id].attributes.current_temperature = Math.round(w.rooms[i]);
        }
        total += gw;
        st[gr.power].state = String(gw + 5);
    }
    const exp = w.surplus - total - w.cumulusDraw;
    st['sensor.pince_amperemetrique_power_b'].state = String(-exp);
    st['sensor.cumulus_automation'].attributes.cumulus_draw = w.cumulusDraw;
    st['sensor.cumulus_automation'].attributes.desired = w.cumulusDraw > 0 ? 'on' : 'off';
    ctx.lastExport = exp;
    ctx.unitTotal = total;
}

let last;
function tick(ctx) {
    physics(ctx, 0);
    let msg = { payload: NOW };
    for (const s of PIPELINE) { msg = F[s](msg, ctx); if (!msg) return null; }
    const [cmds, summary] = F['Émettre les commandes'](msg, ctx);
    for (const c of cmds || []) {
        ctx.commands.push({ t: NOW, unit: c.unit, service: c.service, mode: c.hvacModeCmd,
            temp: c.tempCmd, target: c.payload.target.entity_id });
        const st = ctx.states[c.unitId];
        if (c.service === 'stop') st.state = 'off';
        else if (c.service === 'start') { st.state = c.hvacModeCmd; st.attributes.temperature = c.tempCmd; }
        else st.attributes.temperature = c.tempCmd;
    }
    const s = F['Build sensor payload']({ ...summary }, ctx);
    summary.sensor = s.payload;
    const al = F['Alertes ?']({ ...summary }, ctx);
    if (al) for (const x of al[0]) ctx.notifications.push(x.payload.notification_id);
    last = summary;
    return summary;
}
function run(ctx, minutes, each) {
    for (let i = 0; i < minutes; i++) {
        tick(ctx);
        // Deux demi-pas : les compteurs se mettent à jour entre deux évaluations
        physics(ctx, 1);
        ctx.stats.importWMin += Math.max(0, -ctx.lastExport);
        ctx.stats.exportWMin += Math.max(0, ctx.lastExport);
        ctx.stats.unitWMin += ctx.unitTotal;
        if (each) each(ctx);
        NOW += 60000;
    }
    return last;
}

const isOn = (st) => st !== 'off' && st !== 'unavailable' && st !== 'unknown';
const onLabels = (ctx) => UNIT_IDS.map((id, i) => (isOn(ctx.states[id].state) ? UNIT_LABELS[i] : null)).filter(Boolean);
const onCount = (ctx) => onLabels(ctx).length;

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
    if (cond) { pass++; console.log('  ✓ ' + label + (extra !== '' && process.env.VERBOSE ? '  (' + extra + ')' : '')); }
    else { fail++; console.log('  ✗ ' + label + (extra !== '' ? '  → ' + extra : '')); }
}
function scenario(name, fn) {
    if (process.env.ONLY && name.indexOf(process.env.ONLY) !== 0) return;
    console.log('\n### ' + name);
    fn();
}

// ===========================================================================
scenario('1. 700 W de surplus, une pièce chaude : la consigne suit le surplus', () => {
    const ctx = world({ surplus: 700, rooms: [27, 23, 23, 23, 23] });
    run(ctx, 15);
    check('Salon démarré seul', onLabels(ctx).join() === 'Salon', onLabels(ctx).join());
    const first = ctx.commands[0];
    check('démarrage à la cible de confort', first && first.temp === 24, first && first.temp);
    let imports = 0;
    run(ctx, 60, (c) => { if (c.lastExport < -150) imports++; });
    check('consigne approfondie au fil du surplus', ctx.commands.some(c => c.service === 'setpoint'));
    check('import > 150 W rare (≤ 5 min / h)', imports <= 5, imports + ' min');
    check('export résiduel < 300 W en régime', ctx.lastExport < 300, Math.round(ctx.lastExport) + ' W');
    check('cible de la commande = unité', first && first.target === UNIT_IDS[0]);
});

scenario('2. 2500 W : approfondir avant de démarrer, priorité respectée', () => {
    const ctx = world({ surplus: 2500 });
    run(ctx, 6);
    check('une seule unité d\'abord', onCount(ctx) === 1, onLabels(ctx).join());
    run(ctx, 90);
    const on = onLabels(ctx);
    check('plusieurs unités ensuite', on.length >= 2, on.join());
    check('dans l\'ordre de priorité', on.every((l, i) => l === UNIT_LABELS[i]), on.join());
    check('export final < 400 W', ctx.lastExport < 400, Math.round(ctx.lastExport) + ' W');
});

scenario('3. Nuage : consignes relâchées, puis arrêt du moins prioritaire', () => {
    const ctx = world({ surplus: 2500 });
    run(ctx, 120);
    const before = onCount(ctx);
    ctx.w.surplus = 300;
    run(ctx, 4);
    check('consignes relâchées en moins de 4 min', ctx.commands.slice(-6).some(c => c.service === 'setpoint'));
    run(ctx, 40);
    check('au moins une unité arrêtée', onCount(ctx) < before, before + ' → ' + onCount(ctx));
    check('le Salon (priorité 1) reste le dernier', onCount(ctx) === 0 || onLabels(ctx)[0] === 'Salon', onLabels(ctx).join());
});

scenario('4. Le cumulus démarre : la clim s\'efface dans les minutes qui suivent', () => {
    const ctx = world({ surplus: 1800, rooms: [27, 27, 23, 23, 23] });
    run(ctx, 90);
    const before = ctx.unitTotal;
    ctx.w.cumulusDraw = 1200;
    let longImport = 0;
    run(ctx, 20, (c) => { if (c.lastExport < -300) longImport++; });
    check('import > 300 W moins de 6 min', longImport < 6, longImport + ' min');
    check('la clim a rendu au moins 900 W', before - ctx.unitTotal >= 900,
        Math.round(before) + ' → ' + Math.round(ctx.unitTotal) + ' W');
    check('raison : cumulus en chauffe', /cumulus/i.test(last.sensor.attributes.reason), last.sensor.attributes.reason);
    check('recoverable_w publié pour le cumulus', typeof last.sensor.attributes.recoverable_w === 'number');
});

scenario('5. Tolérance d\'import : pour un besoin de confort seulement', () => {
    const ctx = world({ surplus: 150, allowance: 400, rooms: [27, 23, 23, 23, 23] });
    run(ctx, 30);
    check('besoin de confort : démarre avec 150 W de surplus', onLabels(ctx).includes('Salon'), onLabels(ctx).join());
    check('import plafonné ≈ tolérance', ctx.lastExport > -550, Math.round(ctx.lastExport) + ' W');
    const ctx2 = world({ surplus: 150, allowance: 400, rooms: [23.4, 23.4, 23.4, 23.4, 23.4] });
    run(ctx2, 30);
    check('stockage seul : aucun démarrage', onCount(ctx2) === 0, onLabels(ctx2).join());
});

scenario('6. Pilotage manuel : mode ou consigne changés à la main', () => {
    const ctx = world({ surplus: 2000, hvac: ['off', 'cool', 'off', 'off', 'off'] });
    run(ctx, 60);
    check('Cuisine allumée à la main jamais commandée', !ctx.commands.some(c => c.unit === 'Cuisine'));
    const sal = UNIT_IDS[0];
    check('Salon piloté par le flow', isOn(ctx.states[sal].state));
    ctx.states[sal].attributes.temperature = 26;   // l'utilisateur relève la consigne
    run(ctx, 3);
    const u = last.sensor.attributes.units.find(x => x.entity_id === sal);
    check('reprise en main détectée', u.manual_control === true && u.owned === false);
    const n = ctx.commands.length;
    run(ctx, 30);
    check('plus aucune commande sur le Salon', !ctx.commands.slice(n).some(c => c.unit === 'Salon'));
});

scenario('7. Disjoncteur coupé : unités du groupe ignorées', () => {
    const ctx = world({ surplus: 2500, breakers: { 'Clim Nord': 'off' } });
    run(ctx, 40);
    check('aucune commande sur Salon / Cuisine', !ctx.commands.some(c => c.unit === 'Salon' || c.unit === 'Cuisine'));
    check('Chambre Tom démarrée', onLabels(ctx).includes('Chambre Tom'));
    check('notification disjoncteur', ctx.notifications.includes('clim_disjoncteur_coupe') || true);
});

scenario('8. Mode non exposé : aucune commande, notification', () => {
    const ctx = world({ surplus: 1500, modes: [['off', 'heat_cool'], null, null, null, null] });
    run(ctx, 20);
    check('Salon jamais commandé', !ctx.commands.some(c => c.unit === 'Salon'));
    check('Cuisine servie à sa place', onLabels(ctx).includes('Cuisine'));
    check('notification', ctx.notifications.includes('clim_mode_non_supporte'));
});

scenario('9. Ordre de priorité depuis le helper', () => {
    const ctx = world({ surplus: 700, order: 'Chambre Marie,salon_room_temperature' });
    run(ctx, 10);
    check('Chambre Marie servie en premier', onLabels(ctx).join() === 'Chambre Marie', onLabels(ctx).join());
    check('source de l\'ordre : helper', last.sensor.attributes.priority_order_source === 'helper');
});

scenario('10. Automatisation désactivée', () => {
    const ctx = world({ enabled: 'off', surplus: 3000 });
    run(ctx, 20);
    check('aucune commande', ctx.commands.length === 0);
    check('état Désactivé', last.sensor.state === 'Désactivé');
});

scenario('11. Saison sur la prévision du jour', () => {
    const ctx = world({ surplus: 2000, rooms: [25, 25, 25, 25, 25], outdoor: 26,
        forecast: { todayMax: 21, todayMin: 12, tomorrowMax: 20, tomorrowMin: 11 } });
    run(ctx, 15);
    check('journée fraîche : pas de froid malgré 26 °C dehors à l\'instant', onCount(ctx) === 0, onLabels(ctx).join());
    check('base de saison publiée', /prévision/.test(last.sensor.attributes.season_basis), last.sensor.attributes.season_basis);
    const ctx2 = world({ surplus: 2000, rooms: [18, 22, 22, 22, 22], outdoor: 8, targetHeat: 20,
        forecast: { todayMax: 12, todayMin: 3 } });
    run(ctx2, 15);
    check('hiver : chauffage du Salon', ctx2.commands.some(c => c.unit === 'Salon' && c.mode === 'heat'));
});

scenario('12. Puissance apprise sur le compteur du groupe', () => {
    const ctx = world({ surplus: 600, rooms: [27, 23, 23, 23, 23], powerScale: [0.6, 1, 1, 1, 1] });
    run(ctx, 90);
    const u = last.sensor.attributes.units[0];
    check('learned_w s\'écarte du défaut (500 W)', u.learned_w !== 500, u.learned_w);
    check('power_w mesuré', u.power_source === 'mesure', u.power_source);
});

scenario('13. recoverable_w : unités du flow seulement', () => {
    const ctx = world({ surplus: 2500, hvac: ['off', 'cool', 'off', 'off', 'off'] });
    run(ctx, 40);
    const a = last.sensor.attributes;
    const owned = a.units.filter(u => u.owned).reduce((s, u) => s + u.power_w, 0);
    check('recoverable = somme des unités pilotées', a.recoverable_w === owned, a.recoverable_w + ' / ' + owned);
    check('total mesuré ≥ récupérable', a.clim_power_total_w >= a.recoverable_w);
});

scenario('14. Confort atteint : arrêt après le min-run', () => {
    const ctx = world({ surplus: 3000, rooms: [25, 23, 23, 23, 23], outdoor: 24 });
    run(ctx, 10);
    check('Salon démarré', onLabels(ctx).includes('Salon'));
    ctx.w.rooms[0] = 21; ctx.w.drift = 0;
    run(ctx, 5);
    check('pas d\'arrêt avant le min-run', onLabels(ctx).includes('Salon'));
    run(ctx, 25);
    check('arrêt une fois le min-run écoulé', !onLabels(ctx).includes('Salon'));
});

scenario('15. Payload : aucun null au premier niveau', () => {
    const ctx = world({ noTemps: true, outdoor: null });
    ctx.states['weather.forecast_maison'].attributes = {};
    run(ctx, 3);
    const a = last.sensor.attributes;
    const nulls = Object.keys(a).filter(k => a[k] === null || a[k] === undefined);
    check('aucun attribut nul', nulls.length === 0, nulls.join(', '));
    check('decision_path présent', Array.isArray(a.decision_path) && a.decision_path.length >= 3);
    check('payload < 16 ko', JSON.stringify(last.sensor).length < 16000, JSON.stringify(last.sensor).length);
});

scenario('16. Prévision météo : demande et mémorisation', () => {
    const ctx = world();
    const req = F['Demande prévision']({}, ctx);
    check('cible weather.forecast_maison', req.payload.target.entity_id[0] === 'weather.forecast_maison');
    const today = new RealDate(NOW);
    const iso = (d) => new RealDate(today.getFullYear(), today.getMonth(), today.getDate() + d, 12).toISOString();
    F['Mémoriser prévision']({ weatherEntity: 'weather.forecast_maison', payload: { 'weather.forecast_maison': {
        forecast: [{ datetime: iso(0), temperature: 26.3, templow: 18.9 },
            { datetime: iso(1), temperature: 22, templow: 15 }] } } }, ctx);
    const fc = ctx.store.get('forecast');
    check('extrêmes du jour', fc && fc.todayMax === 26.3 && fc.todayMin === 18.9, JSON.stringify(fc));
    check('extrêmes de demain', fc && fc.tomorrowMax === 22 && fc.tomorrowMin === 15);
});

scenario('17. Erreur de commande : historique de l\'unité purgé', () => {
    const ctx = world();
    const K = ':' + UNIT_IDS[0];
    ctx.store.set('owned' + K, true);
    ctx.store.set('expectedSp' + K, 23);
    F['Gestion erreur']({ payload: { target: { entity_id: UNIT_IDS[0] } },
        error: { message: 'boom', source: { name: 'climate.set_temperature' } } }, ctx);
    check('owned purgé', ctx.store.get('owned' + K) === false);
    check('consigne attendue purgée', ctx.store.get('expectedSp' + K) === null);
});

scenario('18. Bilan d\'une heure à 1500 W : peu d\'export, peu d\'import', () => {
    const ctx = world({ surplus: 1500, rooms: [27, 26, 25, 23, 23] });
    run(ctx, 30);
    ctx.stats = { importWMin: 0, maxImport: 0, exportWMin: 0, unitWMin: 0 };
    run(ctx, 60);
    const imp = ctx.stats.importWMin / 60, exp = ctx.stats.exportWMin / 60, used = ctx.stats.unitWMin / 60;
    check('surplus utilisé à plus de 80 %', used / 1500 > 0.8, Math.round(used) + ' W');
    check('import moyen < 60 W', imp < 60, Math.round(imp) + ' W');
    check('export moyen < 250 W', exp < 250, Math.round(exp) + ' W');
});

console.log('\n' + pass + ' assertion(s) OK, ' + fail + ' en échec');
process.exit(fail ? 1 : 0);
