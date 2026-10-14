// === Lecture brute des entités HA (climatisation / chauffage gratuits) ===
// Getters uniquement, pas de logique métier. Unités décrites par une liste
// ORDONNÉE (priorité décroissante) dans CLIM_UNITS, réordonnable depuis HA par
// le helper CLIM_PRIORITY_HELPER. Température de chaque pièce lue sur
// l'attribut `current_temperature` de l'unité, aucune sonde externe nécessaire.
// PREREQUIS : cocher "Enable global context store" sur le nœud serveur HA.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

let g;
try {
    g = global.get('homeassistant').homeAssistant.states;
    if (!g) throw new Error('states indisponibles');
} catch (e) {
    node.warn('HA indisponible, tick ignoré : ' + e.message);
    return null;
}

const eStr = (k, def) => {
    const v = env.get(k);
    return (v === undefined || v === null || v === '') ? def : String(v);
};
const eNum = (k, def) => {
    const v = parseFloat(env.get(k));
    return isNaN(v) ? def : v;
};
const numOrNull = (id) => {
    const raw = g[id]?.state;
    if (raw === undefined || raw === 'unavailable' || raw === 'unknown') return null;
    const v = parseFloat(raw);
    return isNaN(v) ? null : v;
};
const n = (id, def) => { const v = numOrNull(id); return v == null ? def : v; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const list = (s) => s.split(',').map(x => x.trim()).filter(x => x.length > 0);
const now = Date.now();
msg.now = now;

// --- Constantes du modèle ---
msg.minRunMs = clamp(eNum('CLIM_MIN_RUN_MIN', 20), 0, 240) * 60000;
msg.minOffMs = clamp(eNum('CLIM_MIN_OFF_MIN', 15), 0, 240) * 60000;
msg.confirmMs = clamp(eNum('CLIM_CONFIRM_MIN', 3), 1, 30) * 60000;
msg.storeBand = clamp(eNum('CLIM_STORE_BAND', 1.5), 0, 6);
msg.coolFloor = eNum('CLIM_COOL_FLOOR', 21);
msg.heatCeiling = eNum('CLIM_HEAT_CEILING', 23);
msg.outdoorCoolMin = eNum('CLIM_OUTDOOR_COOL_MIN', 24);
msg.outdoorHeatMax = eNum('CLIM_OUTDOOR_HEAT_MAX', 17);
msg.maxUnits = Math.round(clamp(eNum('CLIM_MAX_UNITS', 5), 1, 20));
msg.exportMargin = clamp(eNum('CLIM_EXPORT_MARGIN_W', 50), -500, 1000);
msg.defaultUnitW = clamp(eNum('CLIM_UNIT_W', 500), 100, 5000);
msg.groupStandbyW = clamp(eNum('CLIM_GROUP_STANDBY_W', 5), 0, 200);

// --- Entités ---
const outdoorId = eStr('CLIM_OUTDOOR_SENSOR', 'sensor.exterieur_temperature');
msg.weatherEntity = eStr('CLIM_WEATHER_ENTITY', 'weather.forecast_maison');
const solarId = eStr('SOLAR_SENSOR', 'sensor.pince_amperemetrique_power_a');
const gridId = eStr('GRID_SENSOR', 'sensor.pince_amperemetrique_power_b');
msg.cumulusSensor = eStr('CUMULUS_SENSOR', 'sensor.cumulus_automation');

// --- Réglages utilisateur (helpers HA) ---
msg.enabled = g['input_boolean.clim_automation_enabled']?.state === 'on';
msg.targetCool = clamp(n('input_number.clim_target_cool', 25), 16, 32);
msg.targetHeat = clamp(n('input_number.clim_target_heat', 20), 10, 28);
// Import réseau toléré pour un BESOIN de confort (pièce hors de sa cible).
// Le stockage au-delà de la cible reste au seul surplus. Absent : 0 W.
msg.importAllowance = clamp(n('input_number.clim_import_allowance', 0), 0, 5000);

const SEASON_MAP = {
    auto: 'auto', froid: 'froid', chaud: 'chaud', 'arrêt': 'arret', arret: 'arret',
    cool: 'froid', heat: 'chaud', off: 'arret'
};
const seasonRaw = String(g['input_select.clim_season_mode']?.state || 'auto').toLowerCase();
msg.seasonMode = SEASON_MAP[seasonRaw] || 'auto';

// --- Température extérieure : sonde, sinon entité météo ---
msg.outdoorTemp = outdoorId ? numOrNull(outdoorId) : null;
msg.outdoorSource = msg.outdoorTemp != null ? 'sonde' : null;
if (msg.outdoorTemp == null) {
    const wt = parseFloat(g[msg.weatherEntity]?.attributes?.temperature);
    if (!isNaN(wt)) { msg.outdoorTemp = wt; msg.outdoorSource = 'météo'; }
}
msg.outdoorAvailable = msg.outdoorTemp != null;

// Prévision du jour et de demain, mémorisée par le nœud « Mémoriser prévision »
// (weather.get_forecasts, toutes les heures). Périmée après 6 h.
const fc = getF('forecast');
msg.forecast = (fc && now - fc.at < 6 * 3600 * 1000) ? fc : null;

// --- Mesures électriques ---
msg.solar = n(solarId, 0);
msg.gridPower = n(gridId, 0);   // > 0 import réseau, < 0 injection
msg.export = -msg.gridPower;

// --- Groupes de disjoncteurs intelligents (JSON) ---
let groupsRaw = env.get('CLIM_GROUPS');
let groupDefs = [];
try {
    if (Array.isArray(groupsRaw)) groupDefs = groupsRaw;
    else if (typeof groupsRaw === 'string' && groupsRaw.trim()) groupDefs = JSON.parse(groupsRaw);
} catch (e) {
    node.warn('CLIM_GROUPS illisible (JSON invalide), mesure par groupe désactivée : ' + e.message);
    groupDefs = [];
}
msg.groups = groupDefs.map(gr => {
    const swState = gr.switch ? g[gr.switch]?.state : undefined;
    return {
        name: gr.name || gr.switch || '?',
        switchId: gr.switch || null,
        // État inconnu : supposé alimenté, sinon une lecture manquante gèlerait le groupe
        breakerOn: (swState === 'on' || swState === 'off') ? swState === 'on' : true,
        breakerKnown: swState === 'on' || swState === 'off',
        powerSensor: gr.power || null,
        power: gr.power ? numOrNull(gr.power) : null,
        units: Array.isArray(gr.units) ? gr.units : []
    };
});
const groupOf = {};
for (const gr of msg.groups) for (const uid of gr.units) groupOf[uid] = gr;

// --- Unités, par ordre de priorité ---
const ids = list(eStr('CLIM_UNITS',
    'climate.salon_room_temperature,climate.daikinap21104_room_temperature,'
    + 'climate.chambre_tom_room_temperature,climate.chambre_didier_room_temperature,'
    + 'climate.chambre_marie_room_temperature'));
const labels = list(eStr('CLIM_UNIT_LABELS',
    'Salon,Cuisine,Chambre Tom,Chambre Didier,Chambre Marie'));

msg.units = ids.map((id, i) => {
    const st = g[id];
    const raw = st?.state;
    const available = raw !== undefined && raw !== 'unavailable' && raw !== 'unknown';
    // Repli sur le dernier état connu : un reboot HA ne vaut pas intervention manuelle
    const hvacMode = available ? raw : (getF('lastKnownHvac:' + id) || 'off');
    if (available) setF('lastKnownHvac:' + id, raw);
    const a = st?.attributes || {};
    const cur = parseFloat(a.current_temperature);
    const sp = parseFloat(a.temperature);
    const gr = groupOf[id] || null;
    return {
        id: id,
        label: labels[i] || id,
        priority: i + 1,
        group: gr ? gr.name : null,
        breakerOn: gr ? gr.breakerOn : true,
        available: available,
        hvacMode: hvacMode,
        on: hvacMode !== 'off',
        hvacAction: a.hvac_action || null,
        current: isNaN(cur) ? null : cur,
        tempAvailable: !isNaN(cur),
        setpoint: isNaN(sp) ? null : sp,
        spMin: isNaN(parseFloat(a.min_temp)) ? 16 : parseFloat(a.min_temp),
        spMax: isNaN(parseFloat(a.max_temp)) ? 30 : parseFloat(a.max_temp),
        spStep: parseFloat(a.target_temp_step) > 0 ? parseFloat(a.target_temp_step) : 0.5,
        modes: Array.isArray(a.hvac_modes) ? a.hvac_modes : []
    };
});

// --- Ordre de priorité pilotable depuis Home Assistant ---
// Jetons : entity_id, sa partie après « climate. », ou le libellé. Unité absente
// du helper : à la suite, dans l'ordre de CLIM_UNITS. Jeton inconnu : ignoré.
msg.priorityHelper = eStr('CLIM_PRIORITY_HELPER', 'input_text.clim_priority_order');
const rawOrder = g[msg.priorityHelper]?.state;
const orderUsable = rawOrder !== undefined && rawOrder !== 'unavailable'
    && rawOrder !== 'unknown' && String(rawOrder).trim() !== '';
msg.priorityOrderSource = 'env';
if (orderUsable) {
    const norm = (v) => String(v).trim().toLowerCase().replace(/^climate\./, '');
    const wanted = list(String(rawOrder)).map(norm);
    const taken = {};
    const ordered = [];
    for (const token of wanted) {
        const hit = msg.units.find(u => !taken[u.id]
            && (norm(u.id) === token || norm(u.label) === token));
        if (hit) { taken[hit.id] = true; ordered.push(hit); }
    }
    for (const u of msg.units) if (!taken[u.id]) ordered.push(u);
    if (ordered.length === msg.units.length) {
        msg.units = ordered;
        msg.units.forEach((u, i) => { u.priority = i + 1; });
        msg.priorityOrderSource = ordered.some((u, i) => u.id !== ids[i]) ? 'helper' : 'helper (identique)';
    }
}
msg.unitCount = msg.units.length;
msg.anyTempAvailable = msg.units.some(u => u.tempAvailable);

if (msg.anyTempAvailable) {
    setF('noTempSince', null);
    msg.noTempHours = 0;
} else {
    let ds = getF('noTempSince');
    if (!ds) { ds = now; setF('noTempSince', ds); }
    msg.noTempHours = Math.round((now - ds) / 360000) / 10;
}

// --- Cumulus ---
// La priorité de l'eau chaude est assurée côté cumulus : il compte la
// consommation que la clim rendrait (recoverable_w) dans son propre surplus et
// démarre sans attendre ; la clim n'a qu'à suivre le compteur.
// Exception symétrique : un cumulus qui chauffe pour le seul STOCKAGE (eau déjà
// à sa cible, règle plan_storage) passe après le confort. Sa consommation est
// alors comptée comme disponible pour la clim, qui la lui reprend ; il s'arrête
// de lui-même quand son surplus retombe sous son seuil.
const cu = g[msg.cumulusSensor];
msg.cumulusFound = !!cu;
const ca = (cu && cu.attributes) || {};
msg.cumulus = {
    enabled: ca.enabled === true,
    desired: ca.desired || null,
    draw: parseFloat(ca.cumulus_draw) || 0,
    rule: ca.rule || null,
    storageOnly: ca.rule === 'plan_storage',
    waterTemp: parseFloat(ca.water_temp),
    target: parseFloat(ca.target_temp),
    leadThreshold: parseFloat(ca.lead_threshold_w)
};

return msg;
