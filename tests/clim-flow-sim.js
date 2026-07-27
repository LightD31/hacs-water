// Harnais de simulation du flow « Climatisation Solaire » (flows-clim.json).
//
//   node tests/clim-flow-sim.js
//
// Exécute les corps réels des nœuds function extraits de flows-clim.json, avec
// une horloge simulée et un registre d'états HA factice. Couvre en priorité la
// règle centrale du flow : l'eau chaude passe avant le confort, et le surplus
// restant est distribué aux unités par paliers.
//
// Toute la décision vit dans les nœuds function (l'onglet ne contient pas
// d'arbre de switch) : le harnais exécute donc le pipeline réel de bout en bout,
// sans logique dupliquée susceptible de dériver.
const fs = require('fs');
const path = require('path');
const flows = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'flows-clim.json'), 'utf8'));

const tab = flows.find(n => n.type === 'tab');
const ENV = {};
for (const e of tab.env) ENV[e.name] = e.value;

const byName = {};
for (const n of flows.filter(n => n.type === 'function')) byName[n.name] = n;

const PIPELINE = ['Lire capteurs & unités', 'Détect. pilotage manuel',
    'Priorité eau chaude', 'Besoin confort par pièce', 'Allocation par paliers'];
const EXTRA = ['Émettre les commandes', 'Build sensor payload', 'Alertes ?'];
for (const n of PIPELINE.concat(EXTRA)) {
    if (!byName[n]) throw new Error('nœud function absent : ' + n);
}

const compile = (name) => {
    const fn = new Function('msg', 'flow', 'global', 'env', 'node', byName[name].func);
    return (msg, ctx) => fn(msg, ctx.flow, ctx.global, ctx.env, ctx.node);
};
const F = {};
for (const n of PIPELINE.concat(EXTRA)) F[n] = compile(n);

// --- Horloge simulée --------------------------------------------------------
let NOW = Date.parse('2026-07-15T12:00:00Z');
const RealDate = Date;
global.Date = class extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
    static now() { return NOW; }
};
const advance = (min) => { NOW += min * 60000; };

// --- Contexte ---------------------------------------------------------------
let CURRENT;
function makeCtx(states, surplusBase) {
    const store = new Map();
    return {
        warnings: [], commands: [], notifications: [], states,
        surplusBase: surplusBase == null ? null : surplusBase, solar: null,
        flow: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
        global: { get: () => ({ homeAssistant: { states } }) },
        env: { get: (k) => ENV[k] },
        node: { warn: (m) => { if (CURRENT) CURRENT.warnings.push(m); } },
    };
}

// --- Bouclage physique ------------------------------------------------------
// Sans cela, une unité qui démarre ne réduirait pas l'export mesuré et le flow
// verrait un surplus fantôme : chaque palier franchi en ferait démarrer un autre.
// surplusBase = export disponible AVANT la clim et AVANT le cumulus.
function physics(ctx) {
    if (ctx.surplusBase == null) return;
    const running = UNIT_IDS.filter(id => isOn(ctx.states[id].state)).length;
    const cu = ctx.states['sensor.cumulus_automation'];
    const cuPower = cu ? (parseFloat(cu.attributes.cumulus_power) || 0) : 0;
    const exported = ctx.surplusBase - running * UNIT_W - cuPower;
    ctx.states['sensor.powermeter_power_b'].state = String(-exported);
    ctx.states['sensor.powermeter_power_a'].state = String(ctx.solar != null
        ? ctx.solar : Math.max(ctx.surplusBase, 0) + 1000);
}

// --- Un tick complet --------------------------------------------------------
function tick(ctx) {
    CURRENT = ctx;
    physics(ctx);
    let msg = { payload: NOW };
    for (const step of PIPELINE) {
        msg = F[step](msg, ctx);
        if (!msg) return null;
    }
    const [cmds, summary] = F['Émettre les commandes'](msg, ctx);

    // Effet des commandes sur les entités HA (mode + consigne)
    for (const c of cmds || []) {
        ctx.commands.push({
            unit: c.unit, service: c.service, mode: c.hvacModeCmd, temp: c.tempCmd,
            reason: c.reason,
            target: c.payload && c.payload.target && c.payload.target.entity_id,
        });
        const st = ctx.states[c.unitId];
        if (!st) continue;
        if (c.service === 'stop') st.state = 'off';
        else { st.state = c.hvacModeCmd; st.attributes.temperature = c.tempCmd; }
    }

    const s = F['Build sensor payload']({ ...summary }, ctx);
    summary.sensor = s.payload;
    const al = F['Alertes ?']({ ...summary }, ctx);
    if (al) for (const x of al[0]) ctx.notifications.push(x.payload.notification_id);
    return summary;
}

function run(ctx, minutes) {
    let m;
    for (let i = 0; i < minutes; i++) { m = tick(ctx); advance(1); }
    return m;
}

// --- Générateur d'états HA --------------------------------------------------
const UNIT_IDS = ENV.CLIM_UNITS.split(',');
const UNIT_LABELS = ENV.CLIM_UNIT_LABELS.split(',');
const MODES = ['off', 'fan_only', 'heat', 'cool', 'heat_cool', 'dry'];
const UNIT_W = 800;   // = CLIM_LOAD_W, consommation simulée d'une unité

function states(o = {}) {
    const d = {
        solar: 3000, grid: -1000, enabled: 'on', season: 'auto',
        targetCool: 25, targetHeat: 20, surplusTrig: null, outdoor: null,
        temps: [27, 27, 27, 27, 27],           // par unité, ordre de CLIM_UNITS
        hvac: ['off', 'off', 'off', 'off', 'off'],
        cumulus: null, noCumulus: false, modes: null, ...o,
    };
    const st = {
        'sensor.powermeter_power_a': { state: String(d.solar) },
        'sensor.powermeter_power_b': { state: String(d.grid) },
        'input_boolean.clim_automation_enabled': { state: d.enabled },
        'input_select.clim_season_mode': { state: d.season },
        'input_number.clim_target_cool': { state: String(d.targetCool) },
        'input_number.clim_target_heat': { state: String(d.targetHeat) },
    };
    UNIT_IDS.forEach((id, i) => {
        st[id] = {
            state: d.hvac[i],
            attributes: {
                current_temperature: d.temps[i],
                temperature: null,
                hvac_modes: (d.modes && d.modes[i]) || MODES,
                hvac_action: null,
            },
        };
    });
    if (d.outdoor != null) {
        ENV.CLIM_OUTDOOR_SENSOR = 'sensor.temp_exterieur_temperature';
        st['sensor.temp_exterieur_temperature'] = { state: String(d.outdoor) };
    } else {
        ENV.CLIM_OUTDOOR_SENSOR = '';
    }
    if (d.surplusTrig != null) {
        st['input_number.clim_surplus_trigger'] = { state: String(d.surplusTrig) };
    }
    if (!d.noCumulus) {
        st['sensor.cumulus_automation'] = {
            state: 'Veille', attributes: Object.assign({}, d.cumulus || HOT) };
    }
    return st;
}

const isOn = (st) => st !== 'off' && st !== 'unavailable' && st !== 'unknown';
const onCount = (ctx) => UNIT_IDS.filter(id => isOn(ctx.states[id].state)).length;
const onLabels = (ctx) => UNIT_IDS
    .map((id, i) => (isOn(ctx.states[id].state) ? UNIT_LABELS[i] : null))
    .filter(Boolean);

// --- Assertions -------------------------------------------------------------
let pass = 0, fail = 0;
function check(label, cond, extra = '') {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function scenario(name, fn) {
    console.log('\n### ' + name);
    if (process.env.ONLY && name.indexOf(process.env.ONLY) !== 0) return;
    fn();
}

// ===========================================================================
// Chaque scénario fixe surplusBase = export disponible AVANT clim et AVANT
// cumulus. Le compteur réseau est recalculé à chaque tick en fonction de ce qui
// tourne réellement, donc les paliers se comportent comme sur l'installation.
// ===========================================================================

// eau chaude au-delà du seuil de priorité / en demande
const HOT = { enabled: true, desired: 'off', current_switch: 'off', cumulus_power: 0,
    water_temp: 61, reach_for: 55, solar_covers_target: false,
    anti_injection_useful: false, legionella_critical_pending: false,
    thermostat_tripped: false, manual_hold_active: false };
const COLD = Object.assign({}, HOT, { water_temp: 45 });

scenario('1. Eau chaude prioritaire : 1500 W de surplus, rien pour la clim', () => {
    const ctx = makeCtx(states({ cumulus: COLD }), 1500);
    const m = run(ctx, 12);
    check('réservation cumulus = 1200 W', m.cumulusReserveW === 1200, String(m.cumulusReserveW));
    check('surplus dispo = 300 W', m.availableW === 300, String(m.availableW));
    check('aucune unité démarrée', onCount(ctx) === 0, onLabels(ctx).join(','));
    check('préemption signalée', m.preemptedByHotWater === true);
    check('état « eau chaude prioritaire »', /eau chaude prioritaire/i.test(m.state), m.state);
});

scenario('2. Priorité jusqu\'à 60 °C, pas seulement jusqu\'à la cible', () => {
    // Eau à 57 °C : au-dessus de reach_for (55) mais sous le seuil de priorité
    const ctx = makeCtx(states({
        cumulus: Object.assign({}, HOT, { water_temp: 57 }) }), 1500);
    let m = run(ctx, 12);
    check('seuil de priorité = 60 °C', m.hotWaterPriorityTemp === 60,
        String(m.hotWaterPriorityTemp));
    check('réservation maintenue à 57 °C', m.cumulusReserveW === 1200,
        m.cumulusReserveReason);
    check('aucune unité démarrée', onCount(ctx) === 0, onLabels(ctx).join(','));
    // L'eau franchit 60 °C : le surplus est rendu au confort
    ctx.states['sensor.cumulus_automation'].attributes.water_temp = 61;
    m = run(ctx, 8);
    check('réservation levée à 61 °C', m.cumulusReserveW === 0, m.cumulusReserveReason);
    check('une unité démarre', onCount(ctx) === 1, onLabels(ctx).join(','));
});

scenario('3. Seuil relevé par un cycle légionelle (reach_for 62 °C)', () => {
    const ctx = makeCtx(states({
        cumulus: Object.assign({}, HOT, { water_temp: 61, reach_for: 62 }) }), 1500);
    const m = run(ctx, 12);
    check('seuil suit reach_for', m.hotWaterPriorityTemp === 62,
        String(m.hotWaterPriorityTemp));
    check('réservation maintenue à 61 °C', m.cumulusReserveW === 1200,
        m.cumulusReserveReason);
    check('aucune unité démarrée', onCount(ctx) === 0, onLabels(ctx).join(','));
});

scenario('4. Un palier : 1000 W libres → une seule unité, la plus prioritaire', () => {
    const ctx = makeCtx(states({}), 1000);
    let m = run(ctx, 4);
    check('rien avant confirmation du palier', onCount(ctx) === 0, m.state);
    m = run(ctx, 4);
    check('une unité démarrée', onCount(ctx) === 1, onLabels(ctx).join(','));
    check('c\'est le Salon (priorité 1)', onLabels(ctx)[0] === 'Salon', onLabels(ctx).join(','));
    check('mode froid', ctx.states[UNIT_IDS[0]].state === 'cool', ctx.states[UNIT_IDS[0]].state);
    check('consigne de stockage 23.5 °C',
        ctx.states[UNIT_IDS[0]].attributes.temperature === 23.5,
        String(ctx.states[UNIT_IDS[0]].attributes.temperature));
    check('cible entité portée par le message',
        ctx.commands[0].target === UNIT_IDS[0], String(ctx.commands[0].target));
    m = run(ctx, 15);
    check('pas de 2e unité avec 1000 W', onCount(ctx) === 1, onLabels(ctx).join(','));
    check('surplus dispo stable à 1000 W', m.availableW === 1000, String(m.availableW));
});

scenario('5. Montée en paliers : +1 unité par palier confirmé', () => {
    const ctx = makeCtx(states({}), 2600);
    let m = run(ctx, 7);
    check('1 unité après le 1er palier', onCount(ctx) === 1, onLabels(ctx).join(','));
    m = run(ctx, 7);
    check('2 unités après le 2e palier', onCount(ctx) === 2, onLabels(ctx).join(','));
    check('ordre de priorité respecté',
        onLabels(ctx).join(',') === 'Salon,Cuisine', onLabels(ctx).join(','));
    m = run(ctx, 7);
    check('3 unités après le 3e palier', onCount(ctx) === 3, onLabels(ctx).join(','));
    m = run(ctx, 15);
    check('4e unité non finançable (2600 W)', onCount(ctx) === 3, onLabels(ctx).join(','));
    check('surplus dispo stable à 2600 W', m.availableW === 2600, String(m.availableW));
    check('aucun watt pris au réseau',
        parseFloat(ctx.states['sensor.powermeter_power_b'].state) <= 0,
        ctx.states['sensor.powermeter_power_b'].state);
});

scenario('6. Délestage : le moins prioritaire part en premier', () => {
    const ctx = makeCtx(states({}), 2600);
    run(ctx, 21);
    check('3 unités en marche', onCount(ctx) === 3, onLabels(ctx).join(','));
    ctx.surplusBase = 800;                      // le soleil baisse
    run(ctx, 60);
    check('délestage jusqu\'à 1 unité', onCount(ctx) === 1, onLabels(ctx).join(','));
    check('le Salon est conservé', onLabels(ctx)[0] === 'Salon', onLabels(ctx).join(','));
    const stops = ctx.commands.filter(c => c.service === 'stop').map(c => c.unit);
    check('délestage dans l\'ordre inverse de la priorité',
        stops.join(',') === 'Chambre Tom,Cuisine', stops.join(','));
});

scenario('7. Préemption en plein cycle par l\'eau chaude', () => {
    const ctx = makeCtx(states({}), 1800);
    run(ctx, 14);
    check('2 unités en marche', onCount(ctx) === 2, onLabels(ctx).join(','));
    // L'eau chaude est puisée : le cumulus redemande 1200 W
    ctx.states['sensor.cumulus_automation'].attributes.water_temp = 42;
    let m = run(ctx, 1);
    check('réservation rétablie', m.cumulusReserveW === 1200, String(m.cumulusReserveW));
    check('surplus dispo réduit à 600 W', m.availableW === 600, String(m.availableW));
    m = run(ctx, 30);
    check('délestage à 1 unité pour servir l\'eau chaude', onCount(ctx) === 1,
        onLabels(ctx).join(','));
    check('le Salon est conservé', onLabels(ctx)[0] === 'Salon', onLabels(ctx).join(','));
});

scenario('8. hardStop : import réseau franc, délestage sans attendre min-run', () => {
    const ctx = makeCtx(states({}), 1800);
    run(ctx, 14);
    check('2 unités en marche', onCount(ctx) === 2, onLabels(ctx).join(','));
    ctx.surplusBase = 0;                        // effondrement du surplus
    ctx.states['sensor.cumulus_automation'].attributes.water_temp = 42;
    let m = run(ctx, 1);
    check('min-run pas écoulé', m.units[1].minRunOk === false,
        'minRunLeft=' + m.units[1].minRunLeftMin);
    m = run(ctx, 4);
    check('hardStop armé', m.hardStop === true, String(m.hardStop));
    check('délestage total malgré min-run', onCount(ctx) === 0, onLabels(ctx).join(','));
});

scenario('9. Unité allumée à la main : jamais coupée, conso non récupérable', () => {
    const ctx = makeCtx(states({}), 1800);
    ctx.states[UNIT_IDS[4]].state = 'cool';     // l'utilisateur allume Chambre Marie
    const m = run(ctx, 14);
    const marie = m.units[4];
    check('pilotage manuel détecté', marie.manualControl === true);
    check('non revendiquée par le flow', marie.owned === false);
    check('desired = skip', marie.desired === 'skip', marie.desired);
    check('toujours en marche', ctx.states[UNIT_IDS[4]].state === 'cool');
    check('aucune commande vers cette unité',
        ctx.commands.every(c => c.target !== UNIT_IDS[4]),
        JSON.stringify(ctx.commands.map(c => c.unit)));
    check('le Salon a démarré sur le reliquat',
        ctx.states[UNIT_IDS[0]].state === 'cool', ctx.states[UNIT_IDS[0]].state);
    check('conso récupérable = 1 unité seulement', m.climDraw === 800, String(m.climDraw));
    check('sa conso reste à la charge de la maison', m.availableW === 1000,
        String(m.availableW));
    check('pas de 3e unité', onCount(ctx) === 2, onLabels(ctx).join(','));
});

scenario('10. Pause 45 min après intervention manuelle sur une unité du flow', () => {
    const ctx = makeCtx(states({}), 1000);
    run(ctx, 8);
    check('Salon démarré par le flow', onLabels(ctx).join(',') === 'Salon',
        onLabels(ctx).join(','));
    ctx.states[UNIT_IDS[0]].state = 'off';      // extinction manuelle
    advance(3);
    let m = run(ctx, 3);
    check('pause armée sur le Salon', m.units[0].holdActive === true);
    check('Salon non redémarré pendant la pause', ctx.states[UNIT_IDS[0]].state === 'off');
    m = run(ctx, 15);
    check('une autre pièce prend le relais',
        onCount(ctx) === 1 && onLabels(ctx)[0] !== 'Salon', onLabels(ctx).join(','));
    advance(50);
    m = run(ctx, 2);
    check('pause expirée', m.units[0].holdActive === false);
});

scenario('11. Confort atteint : libération immédiate, sans attendre le surplus', () => {
    const ctx = makeCtx(states({}), 1000);
    run(ctx, 8);
    check('Salon en marche', onCount(ctx) === 1, onLabels(ctx).join(','));
    ctx.states[UNIT_IDS[0]].attributes.current_temperature = 22.5;
    const m = run(ctx, 1);
    check('arrêt en un seul tick', ctx.states[UNIT_IDS[0]].state === 'off',
        ctx.states[UNIT_IDS[0]].state);
    check('min-run non opposé au confort', m.units[0].minRunOk === false,
        'minRunLeft=' + m.units[0].minRunLeftMin);
});

scenario('12. Stockage : le cycle continue sous la cible de confort', () => {
    const ctx = makeCtx(states({}), 1000);
    run(ctx, 8);
    ctx.states[UNIT_IDS[0]].attributes.current_temperature = 24.5;  // < 25, > 23.5
    let m = run(ctx, 2);
    check('cycle poursuivi', ctx.states[UNIT_IDS[0]].state === 'cool',
        ctx.states[UNIT_IDS[0]].state);
    check('mode toujours froid', m.units[0].needMode === 'cool', m.units[0].needMode);
    ctx.states[UNIT_IDS[0]].attributes.current_temperature = 23.4;
    run(ctx, 2);
    check('arrêt à la cible de stockage', ctx.states[UNIT_IDS[0]].state === 'off');
});

scenario('13. Chauffage gratuit en hiver', () => {
    const ctx = makeCtx(states({ outdoor: 5, temps: [18, 18, 18, 18, 18] }), 1000);
    const m = run(ctx, 8);
    check('mode chaud', m.units[0].needMode === 'heat', m.units[0].needMode);
    check('démarrage en chauffage', ctx.states[UNIT_IDS[0]].state === 'heat',
        ctx.states[UNIT_IDS[0]].state);
    check('consigne de stockage 21.5 °C',
        ctx.states[UNIT_IDS[0]].attributes.temperature === 21.5,
        String(ctx.states[UNIT_IDS[0]].attributes.temperature));
});

scenario('14. Saison neutre : rien à faire malgré le surplus', () => {
    const ctx = makeCtx(states({ outdoor: 20, temps: [21, 21, 21, 21, 21] }), 3000);
    const m = run(ctx, 10);
    check('aucun besoin', m.needCount === 0, String(m.needCount));
    check('aucune unité démarrée', onCount(ctx) === 0);
    check('état hors saison', /Hors saison/.test(m.state), m.state);
});

scenario('15. Mode saison sur arrêt', () => {
    const ctx = makeCtx(states({ season: 'arrêt' }), 2000);
    const m = run(ctx, 10);
    check('aucun besoin', m.needCount === 0);
    check('aucune commande', ctx.commands.length === 0);
    check('état lisible', /arrêt/i.test(m.state), m.state);
});

scenario('16. Automatisation désactivée : aucune commande', () => {
    const ctx = makeCtx(states({ enabled: 'off' }), 3000);
    const m = run(ctx, 10);
    check('état désactivé', m.state === 'Désactivé', m.state);
    check('aucune commande', ctx.commands.length === 0, String(ctx.commands.length));
    check('toutes les unités en skip', m.units.every(u => u.desired === 'skip'));
});

scenario('17. Température de pièce illisible : unité écartée', () => {
    const ctx = makeCtx(states({}), 1000);
    ctx.states[UNIT_IDS[0]].attributes.current_temperature = null;
    const m = run(ctx, 10);
    check('Salon sans besoin exploitable', m.units[0].needMode === 'none',
        m.units[0].needMode);
    check('raison explicite', /illisible/.test(m.units[0].needReason),
        m.units[0].needReason);
    check('Salon non démarré', ctx.states[UNIT_IDS[0]].state === 'off');
    check('la Cuisine prend le relais', onLabels(ctx).join(',') === 'Cuisine',
        onLabels(ctx).join(','));
});

scenario('18. Unité sans mode « cool » : écartée, notification', () => {
    const ctx = makeCtx(states({}), 1000);
    ctx.states[UNIT_IDS[0]].attributes.hvac_modes = ['off', 'heat_cool'];
    const m = run(ctx, 10);
    check('mode non supporté détecté', m.units[0].modeSupported === false);
    check('Salon non démarré', ctx.states[UNIT_IDS[0]].state === 'off');
    check('notification émise', ctx.notifications.includes('clim_mode_non_supporte'));
    check('une seule notification', ctx.notifications
        .filter(x => x === 'clim_mode_non_supporte').length === 1,
        JSON.stringify(ctx.notifications));
    check('la Cuisine prend le relais', onLabels(ctx).join(',') === 'Cuisine',
        onLabels(ctx).join(','));
});

scenario('19. Unité injoignable : ignorée, jamais commandée', () => {
    const ctx = makeCtx(states({}), 1000);
    ctx.states[UNIT_IDS[0]].state = 'unavailable';
    const m = run(ctx, 10);
    check('Salon marqué indisponible', m.units[0].available === false);
    check('desired = skip', m.units[0].desired === 'skip', m.units[0].desired);
    check('aucune commande vers le Salon',
        ctx.commands.every(c => c.target !== UNIT_IDS[0]));
    check('la Cuisine prend le relais', onLabels(ctx).join(',') === 'Cuisine',
        onLabels(ctx).join(','));
});

scenario('20. Sensor cumulus absent : réservation de sécurité + notification', () => {
    const ctx = makeCtx(states({ noCumulus: true }), 2600);
    const m = run(ctx, 10);
    check('cumulus introuvable', m.cumulusFound === false);
    check('réservation de sécurité', m.cumulusReserveW === 1200, String(m.cumulusReserveW));
    check('1400 W restants → 1 unité', onCount(ctx) === 1, onLabels(ctx).join(','));
    check('notification émise', ctx.notifications.includes('clim_cumulus_absent'));
});

scenario('21. Anti court-cycle : min-off au redémarrage', () => {
    const ctx = makeCtx(states({}), 1000);
    run(ctx, 8);
    check('démarrée', onCount(ctx) === 1);
    ctx.surplusBase = 0;                        // nuage
    run(ctx, 6);
    check('arrêtée', onCount(ctx) === 0, onLabels(ctx).join(','));
    ctx.surplusBase = 1000;                     // retour du soleil
    let m = run(ctx, 7);
    check('redémarrage du Salon bloqué par min-off', m.units[0].minOffOk === false,
        'minOffLeft=' + m.units[0].minOffLeftMin);
    check('Salon toujours arrêté', ctx.states[UNIT_IDS[0]].state === 'off',
        ctx.states[UNIT_IDS[0]].state);
    check('le surplus n\'est pas gaspillé, une autre pièce le prend',
        onCount(ctx) === 1 && onLabels(ctx)[0] !== 'Salon', onLabels(ctx).join(','));
});

scenario('22. Délestage différé par min-run, sans import réseau', () => {
    // Seul cas où le report existe réellement : plusieurs unités en marche et
    // une baisse de budget SANS import réseau (ici la réservation eau chaude).
    // Avec une seule unité, availableW sous le seuil d'arrêt implique
    // forcément un import, et le garde-fou tranche avant le min-run.
    const ctx = makeCtx(states({}), 1800);
    run(ctx, 14);
    check('2 unités en marche', onCount(ctx) === 2, onLabels(ctx).join(','));
    ctx.states['sensor.cumulus_automation'].attributes.water_temp = 42;
    let m = run(ctx, 8);
    check('budget réduit à 600 W', m.availableW === 600, String(m.availableW));
    check('aucun import réseau', m.gridImporting === false,
        ctx.states['sensor.powermeter_power_b'].state + ' W au compteur');
    check('pas de hardStop', m.hardStop === false);
    check('délestage annoncé mais différé', m.shedDeferred === true,
        'target=' + m.targetCount);
    check('les 2 unités tournent encore', onCount(ctx) === 2, onLabels(ctx).join(','));
    check('état « arrêt différé »', /différé/i.test(m.state), m.state);
    m = run(ctx, 15);
    check('délestage effectif après min-run', onCount(ctx) === 1, onLabels(ctx).join(','));
    check('la Cuisine part, le Salon reste', onLabels(ctx)[0] === 'Salon',
        onLabels(ctx).join(','));
});

scenario('23. Cumulus déjà en chauffe : pas de double comptage', () => {
    const ctx = makeCtx(states({
        cumulus: Object.assign({}, COLD, {
            desired: 'on', current_switch: 'on', cumulus_power: 1200 }),
    }), 1500);
    const m = run(ctx, 12);
    check('aucune réservation supplémentaire', m.cumulusReserveW === 0,
        m.cumulusReserveReason);
    check('surplus dispo = 300 W (reliquat réel)', m.availableW === 300,
        String(m.availableW));
    check('aucune unité démarrée', onCount(ctx) === 0, onLabels(ctx).join(','));
});

scenario('24. Anti-injection cumulus : le confort attend', () => {
    const ctx = makeCtx(states({
        cumulus: Object.assign({}, HOT, { anti_injection_useful: true }),
    }), 1500);
    const m = run(ctx, 12);
    check('réservation malgré l\'eau au-delà du seuil', m.cumulusReserveW === 1200,
        m.cumulusReserveReason);
    check('aucune unité démarrée', onCount(ctx) === 0, onLabels(ctx).join(','));
});

scenario('25. Thermostat cumulus ouvert : surplus rendu au confort', () => {
    // Échappatoire indispensable : sans elle, un ballon incapable d'atteindre
    // 60 °C réserverait le surplus en permanence et la clim ne tournerait jamais.
    const ctx = makeCtx(states({
        cumulus: Object.assign({}, COLD, {
            current_switch: 'on', thermostat_tripped: true, cumulus_power: 0 }),
    }), 1000);
    const m = run(ctx, 10);
    check('aucune réservation', m.cumulusReserveW === 0, m.cumulusReserveReason);
    check('une unité démarrée', onCount(ctx) === 1, onLabels(ctx).join(','));
});

scenario('26. Réalignement de consigne après changement de cible', () => {
    const ctx = makeCtx(states({}), 1000);
    run(ctx, 8);
    check('consigne initiale 23.5 °C',
        ctx.states[UNIT_IDS[0]].attributes.temperature === 23.5,
        String(ctx.states[UNIT_IDS[0]].attributes.temperature));
    ctx.states['input_number.clim_target_cool'].state = '24';
    run(ctx, 3);
    check('consigne réalignée à 22.5 °C',
        ctx.states[UNIT_IDS[0]].attributes.temperature === 22.5,
        String(ctx.states[UNIT_IDS[0]].attributes.temperature));
    const adjusts = ctx.commands.filter(c => /réalignement/.test(c.reason));
    check('un seul réalignement, pas de rafale', adjusts.length === 1, String(adjusts.length));
});

scenario('27. Plafond CLIM_MAX_UNITS', () => {
    const saved = ENV.CLIM_MAX_UNITS;
    ENV.CLIM_MAX_UNITS = '2';
    const ctx = makeCtx(states({}), 5000);
    const m = run(ctx, 40);
    check('plafonné à 2 unités', onCount(ctx) === 2, onLabels(ctx).join(','));
    check('target_count plafonné', m.targetCount === 2, String(m.targetCount));
    ENV.CLIM_MAX_UNITS = saved;
});

scenario('28. Sensor : attributs clés et détail par unité', () => {
    const ctx = makeCtx(states({ cumulus: COLD }), 2600);
    const m = run(ctx, 10);
    const at = m.sensor.attributes;
    for (const k of ['available_w', 'cumulus_reserve_w', 'cumulus_reserve_reason',
        'hot_water_priority', 'hot_water_priority_temp', 'preempted_by_hot_water',
        'target_count', 'tier_candidate', 'fundable_units', 'surplus_trigger_per_unit',
        'active_units', 'units', 'clim_draw_estimated', 'clim_kwh_today']) {
        check('attribut ' + k, at[k] !== undefined, JSON.stringify(at[k]));
    }
    check('5 unités détaillées', at.units.length === 5, String(at.units.length));
    check('chaque unité porte son entity_id',
        at.units.every(u => UNIT_IDS.indexOf(u.entity_id) !== -1));
    check('priorités 1..5', at.units.map(u => u.priority).join(',') === '1,2,3,4,5',
        at.units.map(u => u.priority).join(','));
    check('state lisible',
        typeof m.sensor.state === 'string' && m.sensor.state.length > 3, m.sensor.state);
});

console.log('\n=== ' + pass + ' assertions OK, ' + fail + ' échecs ===');
process.exit(fail ? 1 : 0);
