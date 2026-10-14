// === Lecture brute des entités HA ===
// Getters uniquement, aucune logique métier. Entités configurables dans l'onglet
// Env du flow, valeurs par défaut = installation d'origine.
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
const usable = (raw) => raw !== undefined && raw !== null
    && raw !== 'unavailable' && raw !== 'unknown' && !isNaN(parseFloat(raw));
const numOr = (id, def) => (usable(g[id]?.state) ? parseFloat(g[id].state) : def);
const attrNum = (id, key) => {
    const v = parseFloat(g[id]?.attributes?.[key]);
    return isNaN(v) ? null : v;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const now = Date.now();
msg.now = now;

// --- Entités ---
const ID = {
    switch: eStr('CUMULUS_SWITCH', 'switch.chauffe_eau_electrique'),
    power: eStr('CUMULUS_POWER', 'sensor.chauffe_eau_electrique_power'),
    temp: eStr('WATER_TEMP_SENSOR', 'sensor.temp_chauffe_eau_electrique_temperature'),
    solarTank: eStr('SOLAR_TANK_SENSOR', 'sensor.temp_chauffe_eau_solaire_temperature'),
    solar: eStr('SOLAR_SENSOR', 'sensor.pince_amperemetrique_power_a'),
    grid: eStr('GRID_SENSOR', 'sensor.pince_amperemetrique_power_b'),
    house: eStr('HOUSE_SENSOR', 'sensor.pince_amperemetrique_power_ab'),
    clim: eStr('CLIM_SENSOR', 'sensor.clim_automation'),
    solcastToday: 'sensor.solcast_pv_forecast_previsions_pour_aujourd_hui',
    solcastTomorrow: 'sensor.solcast_pv_forecast_previsions_pour_demain',
    solcastRemaining: 'sensor.solcast_pv_forecast_previsions_de_production_restantes_aujourd_hui',
    solcastField: 'select.solcast_pv_forecast_utiliser_le_champ_de_prevision'
};

msg.switchId = ID.switch;

// --- Constantes de l'installation ---
msg.loadW = clamp(eNum('CUMULUS_LOAD_W', 1200), 100, 10000);
msg.solarMargin = clamp(eNum('SOLAR_SUFFICIENT_MARGIN', 3), 0, 20);

// --- Réglages utilisateur (helpers HA) ---
msg.enabled = g['input_boolean.cumulus_automation_enabled']?.state === 'on';
msg.target = clamp(numOr('input_number.cumulus_target_temp', 55), 30, 75);
msg.minT = clamp(numOr('input_number.cumulus_min_temp', 45), 20, msg.target);
msg.effSetting = clamp(numOr('input_number.cumulus_efficiency', 0.9), 0.3, 1);
msg.tankL = clamp(numOr('input_number.cumulus_tank_volume', 200), 30, 500);
msg.kwhPerDeg = msg.tankL * 4.186 / 3600;   // kWh thermiques par °C

// --- Sonde du ballon électrique (capteur critique) ---
const rawTemp = g[ID.temp]?.state;
msg.tempAvailable = usable(rawTemp);
msg.temp = msg.tempAvailable ? parseFloat(rawTemp) : null;
if (msg.tempAvailable) {
    setF('sondeDownSince', null);
    msg.sondeDownHours = 0;
} else {
    let ds = getF('sondeDownSince');
    if (!ds) { ds = now; setF('sondeDownSince', ds); }
    msg.sondeDownHours = Math.round((now - ds) / 360000) / 10;
}

// --- Ballon solaire en amont (préchauffe en série) ---
const rawSolarTank = g[ID.solarTank]?.state;
msg.solarTankAvailable = usable(rawSolarTank);
msg.solarTankTemp = msg.solarTankAvailable ? parseFloat(rawSolarTank) : null;

// --- Mesures électriques ---
msg.solar = numOr(ID.solar, 0);
msg.gridPower = numOr(ID.grid, 0);           // > 0 import, < 0 export
msg.export = -msg.gridPower;
msg.house = usable(g[ID.house]?.state) ? parseFloat(g[ID.house].state)
    : msg.solar + msg.gridPower;
msg.cumulusPower = Math.max(0, numOr(ID.power, 0));

// Interrupteur : repli sur le dernier état connu pendant un reboot HA
// (unavailable/unknown), sinon fausse « commande manuelle » en aval.
const rawSwitch = g[ID.switch]?.state;
msg.switchAvailable = rawSwitch === 'on' || rawSwitch === 'off';
msg.switchState = msg.switchAvailable ? rawSwitch : (getF('lastKnownSwitch') || 'off');
if (msg.switchAvailable) setF('lastKnownSwitch', rawSwitch);

// --- Flow clim : consommation qu'il rendrait en s'effaçant ---
// L'eau chaude passe avant le confort : le cumulus « voit à travers » la clim
// pilotée. Attribut absent ou flow clim inexistant : 0.
const ca = g[ID.clim]?.attributes || {};
const rec = parseFloat(ca.recoverable_w);
msg.climRecoverable = isNaN(rec) ? 0 : Math.max(0, rec);
const climMeasured = parseFloat(ca.clim_power_total_w);
msg.climTotal = isNaN(climMeasured) ? msg.climRecoverable : Math.max(0, climMeasured);

// --- Solcast : créneaux 30 min d'aujourd'hui et de demain ---
const sel = g[ID.solcastField]?.state || 'estimate';
msg.forecastField = sel === 'estimate10' ? 'pv_estimate10'
    : sel === 'estimate90' ? 'pv_estimate90' : 'pv_estimate';
const toSlots = (id, day) => (g[id]?.attributes?.detailedForecast || []).map(s => ({
    t: new Date(s.period_start).getTime(),
    pv: (parseFloat(s[msg.forecastField]) || 0) * 1000,
    pv10: (parseFloat(s.pv_estimate10 ?? s[msg.forecastField]) || 0) * 1000,
    day: day
})).filter(s => !isNaN(s.t));
msg.forecastSlots = toSlots(ID.solcastToday, 0).concat(toSlots(ID.solcastTomorrow, 1))
    .sort((a, b) => a.t - b.t);
msg.kwhToday = numOr(ID.solcastToday, 0);
msg.kwhTodayRemaining = numOr(ID.solcastRemaining, 0);
msg.kwhTomorrow = numOr(ID.solcastTomorrow, 0);
msg.kwhTomorrowP10 = attrNum(ID.solcastTomorrow, 'estimate10');
msg.kwhTomorrowP90 = attrNum(ID.solcastTomorrow, 'estimate90');

const lu = g[ID.solcastToday]?.last_updated;
const ageMs = lu ? now - new Date(lu).getTime() : Infinity;
msg.solcastAgeHours = isFinite(ageMs) ? Math.round(ageMs / 360000) / 10 : null;
msg.solcastStale = !(ageMs <= 6 * 3600 * 1000) || msg.forecastSlots.length === 0;

return msg;
