// Harnais de simulation du flow « Climatisation Solaire » (flows-clim.json).
//
//   node tests/clim-flow-sim.js
//
// Exécute les corps réels des nœuds function extraits de flows-clim.json, avec
// une horloge simulée et un registre d'états HA factice. Couvre en priorité la
// règle centrale du flow : l'eau chaude passe avant le confort.
//
// ATTENTION : la fonction tree() ci-dessous REPRODUIT à la main les nœuds
// switch/change de l'arbre de décision (le harnais n'embarque pas de moteur
// JSONata). Toute modification de l'arbre dans Node-RED doit être répercutée
// ici, sinon les assertions valident un arbre qui n'existe plus.
const fs = require('fs');
const path = require('path');
const flows = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'flows-clim.json'), 'utf8'));

const tab = flows.find(n => n.type === 'tab');
const ENV = {};
for (const e of tab.env) ENV[e.name] = e.value;

const byName = {};
for (const n of flows.filter(n => n.type === 'function')) byName[n.name] = n;

const NEEDED = ['Lire capteurs', 'Détect. pilotage manuel', 'Priorité eau chaude',
    'Besoin confort & mode', 'Hyst. surplus & anti court-cycle',
    '→ Maintien (temporisations)', 'Calc action & historique',
    'Build sensor payload', 'Alertes ?'];
for (const n of NEEDED) if (!byName[n]) throw new Error('nœud function absent : ' + n);

const compile = (name) => {
    const fn = new Function('msg', 'flow', 'global', 'env', 'node', byName[name].func);
    return (msg, ctx) => fn(msg, ctx.flow, ctx.global, ctx.env, ctx.node);
};
const F = {};
for (const n of NEEDED) F[n] = compile(n);

// --- Horloge simulée --------------------------------------------------------
let NOW = Date.parse('2026-07-15T12:00:00Z');
const RealDate = Date;
global.Date = class extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
    static now() { return NOW; }
};
const advance = (min) => { NOW += min * 60000; };

// --- Contexte -------------------------------------------------------------
function makeCtx(states) {
    const store = new Map();
    const warnings = [];
    return {
        warnings, actions: [], notifications: [],
        states,
        flow: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
        global: { get: () => ({ homeAssistant: { states } }) },
        env: { get: (k) => ENV[k] },
        node: { warn: (m) => warnings.push(m) },
    };
}

// --- Arbre de décision (miroir des switch/change de flows-clim.json) --------
function tree(msg) {
    if (!msg.enabled) {
        msg.desired = msg.climOn ? 'on' : 'off';
        msg.state = 'Désactivé'; msg.reason = 'Automatisation désactivée';
        return msg;
    }
    if (msg.manualHoldActive || msg.manualControl) {
        msg.desired = msg.climOn ? 'on' : 'off';
        msg.state = msg.manualLabel; msg.reason = msg.manualReason;
        return msg;
    }
    if (!msg.indoorAvailable) {
        msg.degradedSonde = true; msg.desired = 'off';
        msg.state = 'Sonde intérieure HS'; msg.reason = 'Température illisible';
        return msg;
    }
    if (msg.needMode === 'none') {
        msg.desired = 'off'; msg.state = 'Confort atteint'; msg.reason = msg.needReason;
        return msg;
    }
    if (msg.surplusOk) {
        if (msg.climOn === false && msg.canStart === true) {
            msg.desired = 'on';
            msg.state = msg.needMode === 'cool' ? 'Rafraîchissement gratuit' : 'Chauffage gratuit';
            msg.reason = 'Surplus libre ' + msg.availableW + ' W après eau chaude';
            return msg;
        }
    } else if (msg.climOn === true && (msg.canStop === true || msg.hardStop === true)) {
        msg.desired = 'off';
        msg.state = msg.preemptedByHotWater
            ? 'Veille (eau chaude prioritaire)' : 'Veille (surplus insuffisant)';
        msg.reason = 'Surplus insuffisant';
        return msg;
    }
    return F['→ Maintien (temporisations)'](msg, CTX);
}

// --- Un tick complet -------------------------------------------------------
let CTX;
function tick(ctx) {
    CTX = ctx;
    let msg = { payload: NOW };
    for (const step of ['Lire capteurs', 'Détect. pilotage manuel', 'Priorité eau chaude',
        'Besoin confort & mode', 'Hyst. surplus & anti court-cycle']) {
        msg = F[step](msg, ctx);
        if (!msg) return null;
    }
    msg = tree(msg);
    msg = F['Calc action & historique'](msg, ctx);
    const s = F['Build sensor payload']({ ...msg }, ctx);
    msg.sensor = s.payload;
    if (msg.action !== 'none') {
        ctx.actions.push({ action: msg.action, targetHvac: msg.targetHvac,
            availableW: msg.availableW, storeTarget: msg.storeTarget, state: msg.state });
    }
    const al = F['Alertes ?']({ ...msg }, ctx);
    if (al) for (const x of al[0]) ctx.notifications.push(x.payload.notification_id);
    // Simule l'effet de la commande sur l'entité HA (mode + consigne)
    if (msg.action === 'start' || msg.action === 'adjust') {
        ctx.states[msg.climEntity].state = msg.targetHvac;
        ctx.states[msg.climEntity].attributes.temperature = msg.storeTarget;
    } else if (msg.action === 'stop') {
        ctx.states[msg.climEntity].state = 'off';
    }
    return msg;
}

// --- Générateur d'états HA -------------------------------------------------
function states(o = {}) {
    const d = {
        solar: 2000, grid: -1000, climPower: 0, hvac: 'off', setpoint: null,
        indoor: 27, outdoor: 30, enabled: 'on', season: 'auto',
        targetCool: 25, targetHeat: 20, surplusTrig: null,
        cumulus: { enabled: true, desired: 'off', current_switch: 'off',
            cumulus_power: 0, water_temp: 45, reach_for: 55,
            solar_covers_target: false, anti_injection_useful: false,
            legionella_critical_pending: false, thermostat_tripped: false,
            manual_hold_active: false },
        noCumulus: false, ...o,
    };
    const st = {
        'sensor.powermeter_power_a': { state: String(d.solar) },
        'sensor.powermeter_power_b': { state: String(d.grid) },
        'sensor.clim_power': { state: String(d.climPower) },
        'sensor.temp_salon_temperature': { state: d.indoor === null ? 'unavailable' : String(d.indoor) },
        'sensor.temp_exterieur_temperature': { state: d.outdoor === null ? 'unavailable' : String(d.outdoor) },
        'input_boolean.clim_automation_enabled': { state: d.enabled },
        'input_select.clim_season_mode': { state: d.season },
        'input_number.clim_target_cool': { state: String(d.targetCool) },
        'input_number.clim_target_heat': { state: String(d.targetHeat) },
        'climate.clim': { state: d.hvac, attributes: { temperature: d.setpoint, hvac_modes: ['off', 'cool', 'heat'] } },
    };
    if (d.surplusTrig != null) st['input_number.clim_surplus_trigger'] = { state: String(d.surplusTrig) };
    if (!d.noCumulus) st['sensor.cumulus_automation'] = { state: 'Veille', attributes: d.cumulus };
    return st;
}

// --- Assertions ------------------------------------------------------------
let pass = 0, fail = 0;
function check(label, cond, extra = '') {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function scenario(name, fn) { console.log('\n### ' + name); fn(); }

// Fait tourner n ticks d'une minute, renvoie le dernier msg
function run(ctx, minutes) {
    let m;
    for (let i = 0; i < minutes; i++) { m = tick(ctx); advance(1); }
    return m;
}

// ===========================================================================
scenario('1. Eau chaude prioritaire : surplus juste suffisant pour le cumulus', () => {
    // 1500 W de surplus, cumulus à 45°C sous sa cible 55°C → 1200 W réservés
    const ctx = makeCtx(states({ solar: 2000, grid: -1500 }));
    const m = run(ctx, 10);
    check('réservation cumulus = 1200 W', m.cumulusReserveW === 1200, String(m.cumulusReserveW));
    check('surplus dispo clim = 300 W', m.availableW === 300, String(m.availableW));
    check('clim NON démarrée', m.action === 'none' && m.desired === 'off', m.state);
    check('préemption signalée', m.preemptedByHotWater === true, String(m.preemptedByHotWater));
    check('état « eau chaude prioritaire »', /eau chaude prioritaire/i.test(m.state), m.state);
    check('raison nommant la réservation', /réservé au cumulus/i.test(m.reason)
        || /eau chaude/i.test(m.reason), m.reason);
});

scenario('2. Surplus abondant : eau chaude servie ET clim démarrée', () => {
    const ctx = makeCtx(states({ solar: 3000, grid: -2500 }));
    let m = run(ctx, 4);
    check('pas de démarrage avant 5 min (hystérésis)', m.action === 'none', m.state);
    m = run(ctx, 4);
    const a = ctx.actions[0] || {};
    check('surplus dispo au démarrage = 1300 W', a.availableW === 1300, String(a.availableW));
    check('démarrage en froid', a.action === 'start' && a.targetHvac === 'cool',
        a.action + '/' + a.targetHvac);
    check('consigne de stockage 23.5°C', a.storeTarget === 23.5, String(a.storeTarget));
    check('un seul démarrage, pas de rafale', ctx.actions.length === 1,
        JSON.stringify(ctx.actions.map(x => x.action)));
});

scenario('3. Cumulus déjà en chauffe : pas de double comptage', () => {
    // cumulus tire 1200 W, il reste 300 W d'injection → 300 W pour la clim
    const ctx = makeCtx(states({
        solar: 2000, grid: -300,
        cumulus: { enabled: true, desired: 'on', current_switch: 'on', cumulus_power: 1200,
            water_temp: 50, reach_for: 55, solar_covers_target: false,
            anti_injection_useful: false, legionella_critical_pending: false,
            thermostat_tripped: false, manual_hold_active: false },
    }));
    const m = run(ctx, 10);
    check('aucune réservation supplémentaire', m.cumulusReserveW === 0, String(m.cumulusReserveW));
    check('surplus dispo = 300 W (reliquat réel)', m.availableW === 300, String(m.availableW));
    check('clim non démarrée', m.action === 'none', m.state);
});

scenario('4. Eau chaude à la cible : tout le surplus va au confort', () => {
    const ctx = makeCtx(states({
        solar: 2000, grid: -1000,
        cumulus: { enabled: true, desired: 'off', current_switch: 'off', cumulus_power: 0,
            water_temp: 56, reach_for: 55, solar_covers_target: false,
            anti_injection_useful: false, legionella_critical_pending: false,
            thermostat_tripped: false, manual_hold_active: false },
    }));
    const m = run(ctx, 8);
    check('réservation nulle', m.cumulusReserveW === 0, m.cumulusReserveReason);
    check('surplus dispo au démarrage = 1000 W', (ctx.actions[0] || {}).availableW === 1000,
        String((ctx.actions[0] || {}).availableW));
    check('clim démarrée', (ctx.actions[0] || {}).action === 'start', m.state);
});

scenario('5. Préemption en plein cycle : le cumulus reprend le surplus', () => {
    const ctx = makeCtx(states({
        solar: 2000, grid: -1000,
        cumulus: { enabled: true, desired: 'off', current_switch: 'off', cumulus_power: 0,
            water_temp: 56, reach_for: 55, solar_covers_target: false,
            anti_injection_useful: false, legionella_critical_pending: false,
            thermostat_tripped: false, manual_hold_active: false },
    }));
    let m = run(ctx, 8);
    check('clim en marche', ctx.states['climate.clim'].state === 'cool', ctx.states['climate.clim'].state);
    // La clim consomme désormais 800 W → le réseau s'équilibre
    ctx.states['sensor.clim_power'].state = '800';
    ctx.states['sensor.powermeter_power_b'].state = '-200';
    m = run(ctx, 2);
    check('maintien tant que le surplus reste', m.desired === 'on', m.state);
    // L'eau chaude est puisée : le cumulus redemande de l'énergie
    ctx.states['sensor.cumulus_automation'].attributes.water_temp = 42;
    m = run(ctx, 1);
    check('réservation rétablie', m.cumulusReserveW === 1200, String(m.cumulusReserveW));
    check('surplus dispo négatif', m.availableW < 0, String(m.availableW));
    check('arrêt encore différé (min-run)', m.action === 'none' && m.canStop === false, m.state);
    m = run(ctx, 3);
    check('arrêt forcé par hardStop malgré min-run', m.action === 'stop' && m.hardStop === true,
        m.action + ' hardStop=' + m.hardStop);
    check('clim éteinte', ctx.states['climate.clim'].state === 'off');
});

scenario('6. Clim allumée à la main : jamais coupée par le flow', () => {
    const ctx = makeCtx(states({ solar: 0, grid: 500, indoor: 27, hvac: 'off' }));
    run(ctx, 3);
    ctx.states['climate.clim'].state = 'cool';   // action utilisateur
    advance(3);
    const m = run(ctx, 3);
    check('pilotage manuel détecté', m.manualControl === true);
    check('aucune commande envoyée', m.action === 'none', m.action);
    check('clim toujours en marche', ctx.states['climate.clim'].state === 'cool');
    check('pause de 45 min armée', m.manualHoldUntil != null);
});

scenario('7. Chauffage gratuit en hiver', () => {
    const ctx = makeCtx(states({
        solar: 2500, grid: -1500, indoor: 18, outdoor: 5, season: 'auto',
        cumulus: { enabled: true, desired: 'off', current_switch: 'off', cumulus_power: 0,
            water_temp: 56, reach_for: 55, solar_covers_target: false,
            anti_injection_useful: false, legionella_critical_pending: false,
            thermostat_tripped: false, manual_hold_active: false },
    }));
    const m = run(ctx, 8);
    check('mode chaud', m.needMode === 'heat', m.needMode);
    check('démarrage en chauffage', (ctx.actions[0] || {}).action === 'start'
        && ctx.actions[0].targetHvac === 'heat', JSON.stringify(ctx.actions[0]));
    check('consigne de stockage 21.5°C', m.storeTarget === 21.5, String(m.storeTarget));
});

scenario('8. Saison neutre : rien à faire malgré le surplus', () => {
    const ctx = makeCtx(states({
        solar: 3000, grid: -2500, indoor: 21, outdoor: 20,
        cumulus: { enabled: true, desired: 'off', current_switch: 'off', cumulus_power: 0,
            water_temp: 56, reach_for: 55, solar_covers_target: false,
            anti_injection_useful: false, legionella_critical_pending: false,
            thermostat_tripped: false, manual_hold_active: false },
    }));
    const m = run(ctx, 8);
    check('aucun besoin', m.needMode === 'none', m.needMode);
    check('aucune commande', m.action === 'none', m.action);
});

scenario('9. Stockage : le cycle froid continue sous la cible de confort', () => {
    const ctx = makeCtx(states({
        solar: 3000, grid: -2500, indoor: 27,
        cumulus: { enabled: true, desired: 'off', current_switch: 'off', cumulus_power: 0,
            water_temp: 56, reach_for: 55, solar_covers_target: false,
            anti_injection_useful: false, legionella_critical_pending: false,
            thermostat_tripped: false, manual_hold_active: false },
    }));
    run(ctx, 8);
    ctx.states['sensor.temp_salon_temperature'].state = '24.5';  // sous la cible 25
    let m = run(ctx, 2);
    check('cycle poursuivi (stockage de fraîcheur)', m.needMode === 'cool' && m.desired === 'on', m.state);
    ctx.states['sensor.temp_salon_temperature'].state = '23.0';  // cible de stockage atteinte
    m = run(ctx, 2);
    check('arrêt à la cible de stockage', m.needMode === 'none' && m.desired === 'off', m.state);
});

scenario('10. Sonde intérieure HS : pas de pilotage à l\'aveugle', () => {
    const ctx = makeCtx(states({ solar: 3000, grid: -2500, indoor: null }));
    const m = run(ctx, 5);
    check('mode dégradé', m.degradedSonde === true);
    check('consigne OFF', m.desired === 'off', m.state);
    check('pas encore de notification (< 2 h)', ctx.notifications.length === 0,
        JSON.stringify(ctx.notifications));
    advance(130);
    tick(ctx);
    check('notification sonde HS après 2 h', ctx.notifications.includes('clim_sonde_hs'),
        JSON.stringify(ctx.notifications));
});

scenario('11. Sensor cumulus absent : surplus réservé par sécurité', () => {
    const ctx = makeCtx(states({ solar: 3000, grid: -2500, noCumulus: true }));
    const m = run(ctx, 8);
    check('cumulus introuvable', m.cumulusFound === false);
    check('réservation de sécurité', m.cumulusReserveW === 1200, String(m.cumulusReserveW));
    check('surplus dispo au démarrage = 1300 W, clim autorisée',
        (ctx.actions[0] || {}).availableW === 1300 && ctx.actions[0].action === 'start',
        JSON.stringify(ctx.actions[0]));
    check('notification sensor absent', ctx.notifications.includes('clim_cumulus_absent'));
    check('une seule notification malgré 8 ticks',
        ctx.notifications.filter(x => x === 'clim_cumulus_absent').length === 1,
        JSON.stringify(ctx.notifications));
});

scenario('12. Anti court-cycle au redémarrage', () => {
    const ctx = makeCtx(states({
        solar: 3000, grid: -2500,
        cumulus: { enabled: true, desired: 'off', current_switch: 'off', cumulus_power: 0,
            water_temp: 56, reach_for: 55, solar_covers_target: false,
            anti_injection_useful: false, legionella_critical_pending: false,
            thermostat_tripped: false, manual_hold_active: false },
    }));
    run(ctx, 8);
    check('démarrée', ctx.states['climate.clim'].state === 'cool');
    // Nuage : plus de surplus du tout
    ctx.states['sensor.powermeter_power_b'].state = '600';
    ctx.states['sensor.clim_power'].state = '800';
    let m = run(ctx, 25);
    check('arrêtée après disparition du surplus', ctx.states['climate.clim'].state === 'off', m.state);
    // Retour du soleil immédiat
    ctx.states['sensor.powermeter_power_b'].state = '-2500';
    ctx.states['sensor.clim_power'].state = '0';
    m = run(ctx, 7);
    check('redémarrage bloqué par min-off', m.action === 'none' && m.canStart === false,
        m.state + ' minOffLeft=' + m.minOffLeftMin);
    m = run(ctx, 12);
    check('redémarrage après min-off', ctx.states['climate.clim'].state === 'cool', m.state);
});

scenario('13. Anti-injection cumulus : le confort attend', () => {
    const ctx = makeCtx(states({
        solar: 3000, grid: -1500,
        cumulus: { enabled: true, desired: 'off', current_switch: 'off', cumulus_power: 0,
            water_temp: 58, reach_for: 55, solar_covers_target: false,
            anti_injection_useful: true, legionella_critical_pending: false,
            thermostat_tripped: false, manual_hold_active: false },
    }));
    const m = run(ctx, 8);
    check('réservation malgré l\'eau à la cible', m.cumulusReserveW === 1200, m.cumulusReserveReason);
    check('surplus dispo = 300 W', m.availableW === 300, String(m.availableW));
    check('clim non démarrée', m.action === 'none', m.state);
});

scenario('14. Automatisation désactivée : aucune commande', () => {
    const ctx = makeCtx(states({ solar: 3000, grid: -2500, enabled: 'off' }));
    const m = run(ctx, 8);
    check('état désactivé', m.state === 'Désactivé');
    check('aucune commande', m.action === 'none');
});

scenario('15. Clim injoignable : aucune commande, notification', () => {
    const ctx = makeCtx(states({ solar: 3000, grid: -2500, hvac: 'unavailable' }));
    let m = run(ctx, 8);
    check('entité marquée indisponible', m.climAvailable === false);
    check('aucune commande', m.action === 'none', m.action);
    advance(70);
    tick(ctx);
    check('notification après 1 h', ctx.notifications.includes('clim_injoignable'),
        JSON.stringify(ctx.notifications));
});

scenario('16. Sensor : attributs clés exposés', () => {
    const ctx = makeCtx(states({ solar: 3000, grid: -2500 }));
    const m = run(ctx, 8);
    const at = m.sensor.attributes;
    for (const k of ['available_w', 'cumulus_reserve_w', 'cumulus_reserve_reason',
        'hot_water_priority', 'need_mode', 'store_target', 'surplus_trigger',
        'stop_trigger', 'min_run_left_min', 'clim_owned', 'clim_kwh_today']) {
        check('attribut ' + k, at[k] !== undefined, JSON.stringify(at[k]));
    }
    check('state lisible', typeof m.sensor.state === 'string' && m.sensor.state.length > 3, m.sensor.state);
});

scenario('17. Unité sans mode « cool » : aucune commande en boucle', () => {
    const ctx = makeCtx(states({
        solar: 3000, grid: -2500,
        cumulus: { enabled: true, desired: 'off', current_switch: 'off', cumulus_power: 0,
            water_temp: 56, reach_for: 55, solar_covers_target: false,
            anti_injection_useful: false, legionella_critical_pending: false,
            thermostat_tripped: false, manual_hold_active: false },
    }));
    ctx.states['climate.clim'].attributes.hvac_modes = ['off', 'heat_cool'];
    const m = run(ctx, 12);
    check('mode non supporté détecté', m.modeSupported === false, String(m.modeSupported));
    check('aucune commande envoyée', ctx.actions.length === 0, JSON.stringify(ctx.actions));
    check('raison explicite', /n.expose pas le mode cool/.test(m.reason), m.reason);
    check('clim restée à l\'arrêt', ctx.states['climate.clim'].state === 'off');
});

scenario('18. Réalignement de consigne après dérive', () => {
    const ctx = makeCtx(states({
        solar: 3000, grid: -2500,
        cumulus: { enabled: true, desired: 'off', current_switch: 'off', cumulus_power: 0,
            water_temp: 56, reach_for: 55, solar_covers_target: false,
            anti_injection_useful: false, legionella_critical_pending: false,
            thermostat_tripped: false, manual_hold_active: false },
    }));
    run(ctx, 8);
    check('démarrage avec consigne 23.5', ctx.states['climate.clim'].attributes.temperature === 23.5,
        String(ctx.states['climate.clim'].attributes.temperature));
    ctx.states['input_number.clim_target_cool'].state = '24';   // cible abaissée
    const m = run(ctx, 2);
    check('réalignement émis', ctx.actions.some(a => a.action === 'adjust'),
        JSON.stringify(ctx.actions.map(a => a.action)));
    check('nouvelle consigne 22.5', ctx.states['climate.clim'].attributes.temperature === 22.5,
        String(ctx.states['climate.clim'].attributes.temperature));
    check('pas de rafale de réalignements', ctx.actions.filter(a => a.action === 'adjust').length === 1,
        JSON.stringify(ctx.actions.map(a => a.action)));
});

console.log('\n=== ' + pass + ' assertions OK, ' + fail + ' échecs ===');
process.exit(fail ? 1 : 0);
