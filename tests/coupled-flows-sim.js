// Simulation couplée des deux flows sur un même compteur.
//
//   node tests/coupled-flows-sim.js
//
// Les deux flows ne se parlent qu'à travers Home Assistant : le cumulus lit
// recoverable_w de sensor.clim_automation, la clim lit cumulus_draw et rule de
// sensor.cumulus_automation, et tous deux lisent le même compteur réseau. Ce
// harnais exécute les deux pipelines réels l'un après l'autre chaque minute,
// sur une journée de soleil, pour vérifier que la priorité tient (eau chaude
// jusqu'à sa cible, puis confort, puis stockage) sans que les deux boucles ne
// se renvoient la balle.
process.env.TZ = 'Europe/Paris';
const fs = require('fs');
const path = require('path');
const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));

function flowOf(file, pipeline, extra) {
    const nodes = load(file);
    const ENV = {};
    for (const e of nodes.find(n => n.type === 'tab').env) ENV[e.name] = e.value;
    const F = {};
    for (const n of nodes.filter(n => n.type === 'function')) {
        if (pipeline.concat(extra).indexOf(n.name) === -1) continue;
        const fn = new Function('msg', 'flow', 'global', 'env', 'node', n.func);
        F[n.name] = (msg, ctx) => fn(msg, ctx.flow, ctx.global, ctx.env, ctx.node);
    }
    return { ENV, F, pipeline, extra };
}
const CU = flowOf('flows.json',
    ['Lire capteurs', 'Apprentissage', 'Planifier', 'Décider', 'Action & historique'],
    ['Build sensor payload']);
const CL = flowOf('flows-clim.json',
    ['Lire capteurs & unités', 'Détect. pilotage manuel', 'Bilan & apprentissage',
        'Besoin confort par pièce', 'Routeur solaire', 'Émettre les commandes'],
    ['Build sensor payload']);

let NOW = 0;
const RealDate = Date;
global.Date = class extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
    static now() { return NOW; }
};
const at = (day, hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new RealDate(2026, 6, 15 + day, h, m || 0).getTime();
};
const bell = (t, peak) => {
    const d = new RealDate(t);
    const h = d.getHours() + d.getMinutes() / 60;
    return (h <= 7 || h >= 21) ? 0 : peak * Math.sin(Math.PI * (h - 7) / 14);
};
function forecast(day, peak) {
    const out = [];
    for (let i = 0; i < 48; i++) {
        const t = new RealDate(2026, 6, 15 + day, 0, i * 30).getTime();
        const w = bell(t + 15 * 60000, peak);
        out.push({ period_start: new RealDate(t).toISOString(), pv_estimate: w / 1000, pv_estimate10: w * 0.6 / 1000 });
    }
    return out;
}

const UNIT_IDS = CL.ENV.CLIM_UNITS.split(',');
const GROUPS = JSON.parse(CL.ENV.CLIM_GROUPS);
const KWH_PER_DEG = 200 * 4.186 / 3600;

function makeCtx(ENV, states) {
    const store = new Map();
    return { store, warnings: [], env: { get: (k) => ENV[k] },
        flow: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
        global: { get: () => ({ homeAssistant: { states } }) },
        node: { warn: () => {}, status: () => {} } };
}

function simulate(o) {
    const w = Object.assign({ peak: 3200, base: 300, water: 50, rooms: [27, 27, 23, 23, 23],
        thermostatAt: 64, outdoor: 31 }, o);
    NOW = at(0, '07:00');
    const st = {
        'input_boolean.cumulus_automation_enabled': { state: 'on' },
        'input_number.cumulus_target_temp': { state: '55' },
        'input_number.cumulus_min_temp': { state: '46' },
        'input_number.cumulus_efficiency': { state: '0.9' },
        'input_boolean.clim_automation_enabled': { state: 'on' },
        'input_select.clim_season_mode': { state: 'froid' },
        'input_number.clim_target_cool': { state: '24' },
        'input_number.clim_target_heat': { state: '20' },
        'select.solcast_pv_forecast_utiliser_le_champ_de_prevision': { state: 'estimate' },
        'sensor.exterieur_temperature': { state: String(w.outdoor) },
        'sensor.cumulus_automation': { state: 'x', attributes: {} },
        'sensor.clim_automation': { state: 'x', attributes: {} },
    };
    UNIT_IDS.forEach((id, i) => {
        st[id] = { state: 'off', attributes: { current_temperature: w.rooms[i], temperature: 21,
            min_temp: 10, max_temp: 30, target_temp_step: 0.5, hvac_modes: ['off', 'cool', 'heat'] } };
    });
    for (const gr of GROUPS) { st[gr.switch] = { state: 'on' }; st[gr.power] = { state: '5' }; }
    const cuCtx = makeCtx(CU.ENV, st), clCtx = makeCtx(CL.ENV, st);
    const stats = { cuSwitches: 0, heatKwh: 0, heatGridKwh: 0, exportKwh: 0, importKwh: 0,
        climKwh: 0, waterAt: {}, waterMax: w.water, firstHeat: null };

    const phys = () => {
        const solar = bell(NOW, w.peak);
        let clim = 0;
        for (const gr of GROUPS) {
            let g = 0;
            for (const id of gr.units) {
                const i = UNIT_IDS.indexOf(id), u = st[id];
                let p = 0;
                if (u.state === 'cool') {
                    const gap = w.rooms[i] - u.attributes.temperature;
                    p = gap <= -0.5 ? 30 : Math.min(1000, 200 + 300 * (gap + 0.5));
                }
                g += p;
                w.rooms[i] += (-(p / 1000) * 1.2 + 0.3) / 60;
                u.attributes.current_temperature = Math.round(w.rooms[i]);
            }
            st[gr.power].state = String(g + 5);
            clim += g;
        }
        const sw = st[CU.ENV.CUMULUS_SWITCH]?.state || 'off';
        const cumulus = sw === 'on' && w.water < w.thermostatAt ? 1200 : 0;
        const house = w.base + cumulus + clim;
        st[CU.ENV.SOLAR_SENSOR] = { state: String(solar) };
        st[CU.ENV.GRID_SENSOR] = { state: String(house - solar) };
        st[CU.ENV.HOUSE_SENSOR] = { state: String(house) };
        st[CU.ENV.CUMULUS_POWER] = { state: String(cumulus) };
        st[CU.ENV.WATER_TEMP_SENSOR] = { state: String(Math.round(w.water * 10) / 10) };
        st[CU.ENV.SOLAR_TANK_SENSOR] = { state: '20' };
        const lu = new RealDate(NOW - 1800000).toISOString();
        const day = new RealDate(NOW).getDate() - 15;
        st['sensor.solcast_pv_forecast_previsions_pour_aujourd_hui'] = { state: '20', last_updated: lu,
            attributes: { detailedForecast: forecast(day, w.peak) } };
        st['sensor.solcast_pv_forecast_previsions_pour_demain'] = { state: '20', last_updated: lu,
            attributes: { detailedForecast: forecast(day + 1, w.peak) } };
        return { solar, clim, cumulus, grid: house - solar };
    };
    if (!st[CU.ENV.CUMULUS_SWITCH]) st[CU.ENV.CUMULUS_SWITCH] = { state: 'off' };

    for (let t = NOW; NOW < at(0, '21:00'); NOW += 60000) {
        phys();
        // --- Flow cumulus ---
        let m = { payload: NOW };
        for (const s of CU.pipeline.slice(0, 4)) m = CU.F[s](m, cuCtx);
        const [cmd, sum] = CU.F['Action & historique'](m, cuCtx);
        if (cmd) { st[CU.ENV.CUMULUS_SWITCH].state = cmd.action === 'turn_on' ? 'on' : 'off'; stats.cuSwitches++; }
        st['sensor.cumulus_automation'] = { state: sum.state,
            attributes: CU.F['Build sensor payload']({ ...sum }, cuCtx).payload.attributes };
        phys();
        // --- Flow clim ---
        let c = { payload: NOW };
        for (const s of CL.pipeline.slice(0, 5)) c = CL.F[s](c, clCtx);
        const [cmds, csum] = CL.F['Émettre les commandes'](c, clCtx);
        for (const k of cmds || []) {
            const u = st[k.unitId];
            if (k.service === 'stop') u.state = 'off';
            else { if (k.service === 'start') u.state = k.hvacModeCmd; u.attributes.temperature = k.tempCmd; }
        }
        st['sensor.clim_automation'] = { state: csum.state,
            attributes: CL.F['Build sensor payload']({ ...csum }, clCtx).payload.attributes };
        // --- Physique de la minute ---
        const p = phys();
        if (p.cumulus > 0) {
            w.water += p.cumulus / 1000 / 60 * 0.9 / KWH_PER_DEG;
            stats.heatKwh += p.cumulus / 60000;
            stats.heatGridKwh += (Math.max(0, p.grid) - Math.max(0, p.grid - p.cumulus)) / 60000;
            if (!stats.firstHeat) stats.firstHeat = NOW;
        }
        w.water -= 0.2 / 60;
        stats.exportKwh += Math.max(0, -p.grid) / 60000;
        stats.importKwh += Math.max(0, p.grid) / 60000;
        stats.climKwh += p.clim / 60000;
        stats.waterMax = Math.max(stats.waterMax, w.water);
        const hh = new RealDate(NOW).toTimeString().slice(0, 5);
        if (hh.endsWith(':00')) stats.waterAt[hh] = Math.round(w.water * 10) / 10;
    }
    stats.water = w.water;
    stats.rooms = w.rooms.map(r => Math.round(r * 10) / 10);
    return stats;
}

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
    if (cond) { pass++; console.log('  ✓ ' + label + (process.env.VERBOSE && extra !== '' ? '  (' + extra + ')' : '')); }
    else { fail++; console.log('  ✗ ' + label + (extra !== '' ? '  → ' + extra : '')); }
}
const r1 = (v) => Math.round(v * 10) / 10;

console.log('\n### Journée d\'été, eau à 50 °C, deux pièces chaudes, 3,2 kW de crête');
const a = simulate({});
check('eau à sa cible le soir', a.water >= 54.5, r1(a.water) + ' °C');
check('chauffe de l\'eau à plus de 90 % solaire', a.heatGridKwh / a.heatKwh < 0.1,
    r1(100 - a.heatGridKwh / a.heatKwh * 100) + ' %');
check('relais du cumulus : moins de 12 commandes', a.cuSwitches < 12, a.cuSwitches);
check('clim servie dans la journée', a.climKwh > 3, r1(a.climKwh) + ' kWh');
check('pièces chaudes ramenées sous 25 °C', a.rooms[0] < 25 && a.rooms[1] < 25, a.rooms.join(', '));
check('export de la journée < 25 % de la production', a.exportKwh < 0.25 * 3.2 * 14 * 2 / Math.PI,
    r1(a.exportKwh) + ' kWh');

console.log('\n### Petite production (1,6 kW), eau à 47 °C : l\'eau chaude passe avant');
const b = simulate({ peak: 1600, water: 47, base: 250 });
check('eau remontée au-dessus de 52 °C', b.water > 52, r1(b.water) + ' °C');
check('clim limitée au reliquat', b.climKwh < a.climKwh, r1(b.climKwh) + ' kWh');
check('relais du cumulus : moins de 12 commandes', b.cuSwitches < 12, b.cuSwitches);

console.log('\n' + pass + ' assertion(s) OK, ' + fail + ' en échec');
process.exit(fail ? 1 : 0);
