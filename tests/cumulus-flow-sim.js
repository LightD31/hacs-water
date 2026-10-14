// Harnais de simulation du flow « Cumulus Solaire » (flows.json).
//
//   node tests/cumulus-flow-sim.js
//
// Exécute les corps réels des nœuds function extraits de flows.json sur une
// horloge simulée, un registre d'états HA factice et un modèle physique simple :
// production solaire en cloche, consommation de fond, ballon qui chauffe à la
// puissance de la résistance et refroidit (pertes + puisages). Le compteur réseau
// se recalcule à chaque tick, comme sur l'installation.
process.env.TZ = 'Europe/Paris';
const fs = require('fs');
const path = require('path');
const flows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'flows.json'), 'utf8'));

const tab = flows.find(n => n.type === 'tab');
const ENV = {};
for (const e of tab.env) ENV[e.name] = e.value;
const byName = {};
for (const n of flows.filter(n => n.type === 'function')) byName[n.name] = n;

const PIPELINE = ['Lire capteurs', 'Apprentissage', 'Planifier', 'Décider', 'Action & historique'];
const EXTRA = ['Build sensor payload', 'Alertes ?', 'Gestion erreur'];
for (const n of PIPELINE.concat(EXTRA)) if (!byName[n]) throw new Error('nœud function absent : ' + n);
const compile = (name) => {
    const fn = new Function('msg', 'flow', 'global', 'env', 'node', byName[name].func);
    return (msg, ctx) => fn(msg, ctx.flow, ctx.global, ctx.env, ctx.node);
};
const F = {};
for (const n of PIPELINE.concat(EXTRA)) F[n] = compile(n);

// --- Horloge simulée --------------------------------------------------------
let NOW = 0;
const RealDate = Date;
global.Date = class extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
    static now() { return NOW; }
};
const at = (day, hhmm) => {   // jour 0 = 2026-10-14, heure locale
    const [h, m] = hhmm.split(':').map(Number);
    return new RealDate(2026, 9, 14 + day, h, m || 0).getTime();
};

// --- Modèle solaire ---------------------------------------------------------
// Cloche entre 8 h 30 et 18 h 30, pic à 13 h 30, crête `peak` W.
const bell = (t, peak) => {
    const d = new RealDate(t);
    const h = d.getHours() + d.getMinutes() / 60;
    if (h <= 8.5 || h >= 18.5) return 0;
    return peak * Math.sin(Math.PI * (h - 8.5) / 10);
};
function forecastFor(day, peak) {
    const out = [];
    for (let i = 0; i < 48; i++) {
        const t = new RealDate(2026, 9, 14 + day, 0, i * 30).getTime();
        const mid = t + 15 * 60000;
        const w = bell(mid, peak);
        out.push({
            period_start: new RealDate(t).toISOString(),
            pv_estimate: w / 1000, pv_estimate10: w * 0.6 / 1000, pv_estimate90: w * 1.1 / 1000,
        });
    }
    return out;
}

const SWITCH = ENV.CUMULUS_SWITCH;
const KWH_PER_DEG = 200 * 4.186 / 3600;

function makeWorld(o = {}) {
    const w = Object.assign({
        temp: 50, target: 55, minT: 46, enabled: 'on', eff: 0.9, effTrue: 0.9,
        peakToday: 1600, peakTomorrow: 1600, solarFactor: 1,   // réel / prévu
        base: 250, decay: 0.25, switch: 'off', upstream: 20, tempAvailable: true,
        solcastAgeH: 0.5, climRecoverable: 0, climDraw: 0, thermostatAt: 75,
        loadW: 1200, startDay: 0,
    }, o);
    const store = new Map(Object.entries(o.context || {}));
    const ctx = {
        w, warnings: [], commands: [], notifications: [],
        flow: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
        env: { get: (k) => ENV[k] },
        node: { warn: (m) => ctx.warnings.push(m) },
        stats: { heatKwh: 0, gridKwh: 0, onMinutes: 0, switches: 0, maxTemp: w.temp, minTemp: w.temp },
        store,
    };
    ctx.global = { get: () => ({ homeAssistant: { states: ctx.states } }) };
    return ctx;
}

// Registre HA dérivé de l'état du monde
function buildStates(ctx) {
    const w = ctx.w;
    const day = new RealDate(NOW).getDate() - 14;
    const solar = bell(NOW, (day === 0 ? w.peakToday : w.peakTomorrow) * w.solarFactor);
    const thermostatOpen = w.temp >= w.thermostatAt;
    const cumulus = w.switch === 'on' && !thermostatOpen ? w.loadW : 0;
    const house = w.base + cumulus + w.climDraw;
    const grid = house - solar;
    ctx.phys = { solar, cumulus, house, grid };
    const solcastLU = new RealDate(NOW - w.solcastAgeH * 3600000).toISOString();
    const st = {
        'input_boolean.cumulus_automation_enabled': { state: w.enabled },
        'input_number.cumulus_target_temp': { state: String(w.target) },
        'input_number.cumulus_min_temp': { state: String(w.minT) },
        'input_number.cumulus_efficiency': { state: String(w.eff) },
        'input_number.cumulus_tank_volume': { state: '200' },
        [ENV.WATER_TEMP_SENSOR]: { state: w.tempAvailable ? String(Math.round(w.temp * 10) / 10) : 'unavailable' },
        [ENV.SOLAR_TANK_SENSOR]: { state: String(w.upstream) },
        [ENV.SOLAR_SENSOR]: { state: String(solar) },
        [ENV.GRID_SENSOR]: { state: String(grid) },
        [ENV.HOUSE_SENSOR]: { state: String(house) },
        [ENV.CUMULUS_POWER]: { state: String(cumulus) },
        [SWITCH]: { state: w.switch },
        'select.solcast_pv_forecast_utiliser_le_champ_de_prevision': { state: 'estimate' },
        'sensor.solcast_pv_forecast_previsions_pour_aujourd_hui': {
            state: '9.6', last_updated: solcastLU,
            attributes: { detailedForecast: w.noForecast ? [] : forecastFor(day, w.peakToday) } },
        'sensor.solcast_pv_forecast_previsions_pour_demain': {
            state: '10', last_updated: solcastLU,
            attributes: { detailedForecast: w.noForecast ? [] : forecastFor(day + 1, w.peakTomorrow),
                estimate10: 6, estimate90: 11 } },
        'sensor.solcast_pv_forecast_previsions_de_production_restantes_aujourd_hui': { state: '4' },
        [ENV.CLIM_SENSOR]: { state: 'x', attributes: {
            recoverable_w: w.climRecoverable, clim_power_total_w: w.climDraw } },
    };
    ctx.states = st;
}

// Physique sur une minute
function physics(ctx) {
    const w = ctx.w, p = ctx.phys;
    const minH = 1 / 60;
    if (p.cumulus > 0) {
        w.temp += p.cumulus / 1000 * minH * w.effTrue / KWH_PER_DEG;
        ctx.stats.heatKwh += p.cumulus / 1000 * minH;
        ctx.stats.onMinutes++;
    }
    w.temp -= w.decay * minH;
    // Import imputable au cumulus : avec lui moins sans lui
    ctx.stats.gridKwh += (Math.max(0, p.grid) - Math.max(0, p.grid - p.cumulus)) / 1000 * minH;
    ctx.stats.maxTemp = Math.max(ctx.stats.maxTemp, w.temp);
    ctx.stats.minTemp = Math.min(ctx.stats.minTemp, w.temp);
}

let last;
function tick(ctx) {
    buildStates(ctx);
    let msg = { payload: NOW };
    for (const step of PIPELINE.slice(0, 4)) {
        msg = F[step](msg, ctx);
        if (!msg) return null;
    }
    const [cmd, summary] = F['Action & historique'](msg, ctx);
    if (cmd) {
        ctx.commands.push({ t: NOW, action: cmd.action, reason: cmd.reason,
            target: cmd.payload.target.entity_id });
        ctx.w.switch = cmd.action === 'turn_on' ? 'on' : 'off';
        ctx.stats.switches++;
    }
    const s = F['Build sensor payload']({ ...summary }, ctx);
    summary.sensor = s.payload;
    const al = F['Alertes ?']({ ...summary }, ctx);
    if (al) for (const x of al[0]) ctx.notifications.push(x.payload.notification_id);
    last = summary;
    return summary;
}
function run(ctx, minutes, each) {
    let m;
    for (let i = 0; i < minutes; i++) {
        m = tick(ctx);
        if (each) each(m, ctx);
        physics(ctx);
        NOW += 60000;
    }
    return m;
}
const runUntil = (ctx, t, each) => run(ctx, Math.round((t - NOW) / 60000), each);

// --- Assertions -------------------------------------------------------------
let pass = 0, fail = 0;
function check(label, cond, extra = '') {
    if (cond) { pass++; console.log('  ✓ ' + label + (extra !== '' && process.env.VERBOSE ? '  (' + extra + ')' : '')); }
    else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function scenario(name, fn) {
    if (process.env.ONLY && name.indexOf(process.env.ONLY) !== 0) return;
    console.log('\n### ' + name);
    fn();
}
const hh = (t) => new RealDate(t).toTimeString().slice(0, 5);
const firstOn = (ctx) => ctx.commands.find(c => c.action === 'turn_on');
const solarShare = (ctx) => ctx.stats.heatKwh > 0
    ? 1 - Math.min(ctx.stats.gridKwh, ctx.stats.heatKwh) / ctx.stats.heatKwh : 1;

// ===========================================================================
scenario('1. Journée ensoleillée, petit besoin : chauffe au pic, pas le matin', () => {
    NOW = at(0, '07:00');
    const ctx = makeWorld({ temp: 52, decay: 0.1 });
    const onAt = [];
    runUntil(ctx, at(0, '19:00'), (m) => { if (m && m.desired === 'on') onAt.push(NOW); });
    const first = firstOn(ctx);
    check('chauffe lancée dans la journée', !!first);
    check('pas avant 11 h (attente des meilleurs créneaux)', first && first.t >= at(0, '11:00'),
        first && hh(first.t));
    check('cible atteinte le soir', ctx.w.temp >= 54.5, ctx.w.temp.toFixed(1));
    check('chauffe à plus de 90 % solaire', solarShare(ctx) > 0.9, (solarShare(ctx) * 100).toFixed(0) + ' %');
});

scenario('2. Semaine du 10 octobre : 800 W d\'export, eau à 48 °C → chauffe', () => {
    // Le flow précédent attendait 1250 W pendant 5 min et laissait l'eau
    // descendre trois jours durant en exportant 400 à 950 W.
    NOW = at(0, '08:00');
    const ctx = makeWorld({ temp: 48, peakToday: 1050, peakTomorrow: 1050, base: 250, decay: 0.2 });
    runUntil(ctx, at(0, '18:30'));
    check('chauffe engagée', ctx.stats.onMinutes > 60, ctx.stats.onMinutes + ' min');
    check('eau remontée d\'au moins 5 °C', ctx.w.temp >= 53, ctx.w.temp.toFixed(1));
    check('part solaire > 55 %', solarShare(ctx) > 0.55, (solarShare(ctx) * 100).toFixed(0) + ' %');
    check('jamais sous le minimum', ctx.stats.minTemp >= 46, ctx.stats.minTemp.toFixed(1));
});

scenario('3. Eau sous le minimum la nuit : chauffe immédiate', () => {
    NOW = at(0, '23:00');
    const ctx = makeWorld({ temp: 44 });
    run(ctx, 3);
    check('turn_on émis', firstOn(ctx) && firstOn(ctx).t <= at(0, '23:01'));
    check('règle : minimum garanti', last.rule === 'plan_floor', last.rule);
    check('cible de la commande = interrupteur de l\'onglet Env',
        firstOn(ctx) && firstOn(ctx).target === SWITCH);
    run(ctx, 200);
    check('arrêt une fois le filet atteint (≈ 48 °C)', ctx.w.switch === 'off' && ctx.w.temp < 50,
        ctx.w.temp.toFixed(1));
});

scenario('4. Ciel gris aujourd\'hui, grand soleil demain, eau confortable : attente', () => {
    NOW = at(0, '09:00');
    const ctx = makeWorld({ temp: 53, peakToday: 500, peakTomorrow: 1800, decay: 0.15 });
    runUntil(ctx, at(0, '18:00'));
    check('aucune chauffe aujourd\'hui', ctx.stats.onMinutes === 0, ctx.stats.onMinutes + ' min');
    check('raison : attente soleil', /attente soleil/i.test(last.state), last.state);
    runUntil(ctx, at(1, '17:00'));
    check('chauffe demain', ctx.stats.onMinutes > 0);
    check('demain, chauffe ≥ 90 % solaire', solarShare(ctx) > 0.9, (solarShare(ctx) * 100).toFixed(0) + ' %');
});

scenario('5. Gros besoin, ciel bouché : chauffe avec part de réseau plutôt qu\'attendre', () => {
    NOW = at(0, '09:00');
    const ctx = makeWorld({ temp: 47, peakToday: 700, peakTomorrow: 700, decay: 0.3 });
    runUntil(ctx, at(0, '18:00'));
    check('chauffe engagée malgré un surplus < tirage', ctx.stats.onMinutes > 30, ctx.stats.onMinutes + ' min');
    check('minimum jamais franchi', ctx.stats.minTemp >= 45.8, ctx.stats.minTemp.toFixed(1));
});

scenario('6. Anti-légionelle : due → planifiée au soleil, échue → immédiate', () => {
    NOW = at(0, '07:00');
    const ctxDue = makeWorld({ temp: 55, context: { lastHighTempAt: at(0, '07:00') - 8 * 86400000 } });
    runUntil(ctxDue, at(0, '19:00'));
    const f = firstOn(ctxDue);
    check('cycle dû : chauffe en journée, pas à 7 h', f && f.t >= at(0, '10:00'), f && hh(f.t));
    check('60 °C atteints', ctxDue.stats.maxTemp >= 60, ctxDue.stats.maxTemp.toFixed(1));
    check('compteur remis à zéro', last.daysSinceHighTemp < 1, last.daysSinceHighTemp);

    NOW = at(0, '22:00');
    const ctxOver = makeWorld({ temp: 52, context: { lastHighTempAt: at(0, '22:00') - 10.5 * 86400000 } });
    run(ctxOver, 2);
    check('échue : chauffe immédiate même de nuit', ctxOver.w.switch === 'on');
    check('règle : légionelle échue', last.rule === 'legionella_overdue', last.rule);
    check('attribut legionella_critical', last.sensor.attributes.legionella_critical === true);
});

scenario('7. Commande manuelle : pause de 45 min', () => {
    NOW = at(0, '21:00');
    const ctx = makeWorld({ temp: 52 });
    run(ctx, 2);
    ctx.w.switch = 'on';   // allumé à la main
    run(ctx, 5);
    check('pause détectée', last.manualHoldActive === true);
    check('aucune commande pendant la pause', ctx.commands.length === 0, JSON.stringify(ctx.commands));
    run(ctx, 45);
    check('reprise après 45 min : arrêt', ctx.commands.length >= 1 && ctx.w.switch === 'off');
});

scenario('8. Ballon solaire amont chaud : pas d\'appoint, stockage gratuit conservé', () => {
    NOW = at(0, '09:00');
    const ctx = makeWorld({ temp: 47, upstream: 62, peakToday: 900 });
    runUntil(ctx, at(0, '17:00'));
    check('aucune chauffe à surplus partiel', ctx.stats.onMinutes === 0, ctx.stats.onMinutes + ' min');
    NOW = at(0, '12:00');
    const ctx2 = makeWorld({ temp: 47, upstream: 62, peakToday: 2000, base: 200 });
    runUntil(ctx2, at(0, '15:00'));
    check('stockage gratuit au fort surplus', ctx2.stats.onMinutes > 0);
    check('à plus de 85 % solaire', solarShare(ctx2) > 0.85, (solarShare(ctx2) * 100).toFixed(0) + ' %');
});

scenario('9. Thermostat mécanique ouvert : pas de battement du relais', () => {
    NOW = at(0, '11:00');
    const ctx = makeWorld({ temp: 63, thermostatAt: 63, peakToday: 2200, base: 200 });
    runUntil(ctx, at(0, '15:00'));
    check('relais fermé une seule fois', ctx.stats.switches <= 1, ctx.stats.switches + ' commandes');
    check('thermostat_tripped publié', last.sensor.attributes.thermostat_tripped === true);
});

scenario('10. Sonde HS : seul le surplus quasi gratuit chauffe', () => {
    NOW = at(0, '08:00');
    const ctx = makeWorld({ tempAvailable: false, peakToday: 1000 });
    runUntil(ctx, at(0, '17:00'));
    check('aucune chauffe à 1000 W de crête', ctx.stats.onMinutes === 0);
    NOW = at(0, '08:00');
    const ctx2 = makeWorld({ tempAvailable: false, peakToday: 2200, base: 200 });
    runUntil(ctx2, at(0, '17:00'));
    check('chauffe au fort surplus', ctx2.stats.onMinutes > 0);
    check('notification sonde HS', ctx2.notifications.includes('cumulus_sonde_hs'));
    check('état préfixé', /sonde HS/i.test(last.sensor.state), last.sensor.state);
});

scenario('11. Automatisation désactivée : aucune commande', () => {
    NOW = at(0, '12:00');
    const ctx = makeWorld({ enabled: 'off', temp: 40 });
    run(ctx, 30);
    check('aucune commande', ctx.commands.length === 0);
    check('état Désactivé', last.sensor.state === 'Désactivé');
});

scenario('12. Solcast inexploitable : repli à 50 % de part solaire', () => {
    NOW = at(0, '09:00');
    const ctx = makeWorld({ temp: 50, noForecast: true, peakToday: 1500 });
    runUntil(ctx, at(0, '16:00'));
    const comfort = last.plans.find(p => p.id === 'comfort');
    check('chauffe engagée', ctx.stats.onMinutes > 0);
    check('plan de confort en repli', !comfort || comfort.fallback === true);
    NOW = at(0, '09:00');
    const ctx2 = makeWorld({ temp: 50, solcastAgeH: 13 });
    run(ctx2, 2);
    check('notification Solcast', ctx2.notifications.includes('cumulus_solcast'));
});

scenario('13. Eau chaude avant le confort : le cumulus voit à travers la clim', () => {
    NOW = at(0, '13:00');
    // Export réel faible car la clim pilotée tire 700 W qu'elle rendrait.
    const ctx = makeWorld({ temp: 47, peakToday: 1300, base: 250, climDraw: 700, climRecoverable: 700 });
    run(ctx, 10);
    check('surplus lissé inclut la clim', last.surplusAvgClim > last.surplusAvgOwn + 500,
        last.surplusAvgClim + ' / ' + last.surplusAvgOwn);
    check('chauffe engagée', ctx.w.switch === 'on');
    // Au-delà de la cible, le stockage ne prend pas le surplus de la clim
    NOW = at(0, '13:00');
    const ctx2 = makeWorld({ temp: 58, peakToday: 1600, base: 200, climDraw: 700, climRecoverable: 700 });
    run(ctx2, 20);
    check('stockage : pas de chauffe en volant la clim', ctx2.stats.onMinutes === 0);
});

scenario('14. Apprentissage : profil de fond, refroidissement, rendement', () => {
    NOW = at(0, '00:00');
    const ctx = makeWorld({ temp: 47, base: 420, decay: 0.4, effTrue: 0.7, eff: 0.9 });
    runUntil(ctx, at(3, '00:00'));
    const a = last.sensor.attributes;
    check('fond de 14 h appris (≈ 420 W)', Math.abs(a.base_profile[14] - 420) < 40, a.base_profile[14]);
    check('refroidissement appris (≈ 0,4 °C/h)', Math.abs(a.decay_c_per_h - 0.4) < 0.12, a.decay_c_per_h);
    check('rendement appris (≈ 0,7)', a.efficiency_learned != null
        && Math.abs(a.efficiency_learned - 0.7) < 0.12, a.efficiency_learned + ' (' + a.efficiency_samples + ' sessions)');
    check('bilan du jour publié', typeof a.heat_kwh_today === 'number');
});

scenario('15. Biais Solcast : production réelle à 70 % de la prévision', () => {
    NOW = at(0, '08:00');
    const ctx = makeWorld({ solarFactor: 0.7, temp: 50 });
    runUntil(ctx, at(0, '14:00'));
    check('biais du jour ≈ 0,7', Math.abs(last.biasToday - 0.7) < 0.08, last.biasToday);
});

scenario('16. Payload du sensor : aucun null au premier niveau, chemin de décision', () => {
    NOW = at(0, '12:00');
    const ctx = makeWorld({ tempAvailable: false });
    run(ctx, 3);
    const a = last.sensor.attributes;
    const nulls = Object.keys(a).filter(k => a[k] === null || a[k] === undefined);
    check('aucun attribut nul (sonde HS)', nulls.length === 0, nulls.join(', '));
    check('decision_path non vide', Array.isArray(a.decision_path) && a.decision_path.length >= 4);
    check('une seule règle décisive', a.decision_path.filter(s => s.status === 'hit').length === 1);
    const size = JSON.stringify(last.sensor).length;
    check('payload < 16 ko', size < 16000, size + ' o');
});

scenario('17. Anti court-cycle : surplus en dents de scie', () => {
    NOW = at(0, '12:00');
    const ctx = makeWorld({ temp: 58, peakToday: 1600, base: 200 });
    let k = 0;
    run(ctx, 120, () => { ctx.w.base = (k++ % 4 < 2) ? 100 : 900; });
    check('au plus une commande toutes les 3 min', ctx.stats.switches <= 40 / 1, ctx.stats.switches + ' commandes');
});

scenario('18. Erreur de commande : historique purgé', () => {
    NOW = at(0, '12:00');
    const ctx = makeWorld();
    ctx.store.set('lastAction', 'turn_on');
    ctx.store.set('lastActionAt', NOW);
    ctx.store.set('expectedSwitch', 'on');
    F['Gestion erreur']({ error: { message: 'boom', source: { name: 'switch.turn_on', id: 'x' } } }, ctx);
    check('lastAction purgé', ctx.store.get('lastAction') === null);
    check('expectedSwitch purgé', ctx.store.get('expectedSwitch') === null);
});

console.log('\n' + pass + ' assertion(s) OK, ' + fail + ' en échec');
process.exit(fail ? 1 : 0);
