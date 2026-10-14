// === Bilan instantané et apprentissage de l'installation ===
// Tout ce que le planificateur a besoin de savoir et qu'aucun réglage fixe ne
// décrit bien, appris en continu sur les mesures :
//   - consommation de fond de la maison, heure par heure (hors cumulus, hors clim)
//   - biais de Solcast sur la production réelle (jour courant et long terme)
//   - vitesse de refroidissement du ballon, puisages compris (°C/h)
//   - rendement réel de la chauffe (°C gagnés par kWh consommé)
// Plus le surplus lissé, seule grandeur comparée au seuil du plan : le lissage
// absorbe nuages et bouilloires sans hystérésis de 5 min à attendre.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const now = msg.now;
const MIN_DRAW_W = 100;               // en dessous : résistance non alimentée
const STARTUP_GRACE_MS = 60 * 1000;   // compteur pas encore rafraîchi après turn_on
const SMOOTH_TAU_MS = 3 * 60 * 1000;  // constante de temps du surplus lissé

// Pas de temps depuis la dernière exécution (borné : reprise après coupure)
const lastRun = getF('learnLastRun');
const dtMs = lastRun ? clamp(now - lastRun, 0, 10 * 60000) : 0;
setF('learnLastRun', now);
const ema = (prev, sample, tauMs) => {
    if (prev == null || isNaN(prev)) return sample;
    const a = 1 - Math.exp(-dtMs / tauMs);
    return prev + a * (sample - prev);
};

// --- Consommation réelle du cumulus ---
// Interrupteur ON mais puissance nulle hors période de grâce : thermostat
// mécanique ouvert (ballon plein à son réglage), la résistance ne chauffe pas.
const lastAction = getF('lastAction');
const lastActionAt = getF('lastActionAt') || 0;
const justTurnedOn = lastAction === 'turn_on' && msg.switchState === 'on'
    && (now - lastActionAt) < STARTUP_GRACE_MS;
let draw = 0;
msg.thermostatTripped = false;
if (msg.switchState === 'on') {
    if (msg.cumulusPower >= MIN_DRAW_W) draw = msg.cumulusPower;
    else if (justTurnedOn) draw = msg.loadW;
    else msg.thermostatTripped = true;
}
msg.cumulusDraw = Math.round(draw);
msg.heating = draw > 0;

// --- Surplus potentiel : ce qui serait exporté sans le cumulus ---
// « own » : sans le cumulus seul (stockage au-delà de la cible, le confort
// passe d'abord). « withClim » : en effaçant aussi la clim pilotée (besoin réel
// d'eau chaude, prioritaire sur le confort).
const potOwn = msg.export + draw;
const potWithClim = potOwn + msg.climRecoverable;
const prevOwn = getF('surplusAvgOwn');
const prevClim = getF('surplusAvgClim');
// Changement d'état du relais : le surplus potentiel est continu par
// construction, le lissage n'a pas à repartir de zéro.
const avgOwn = ema(prevOwn, potOwn, SMOOTH_TAU_MS);
const avgClim = ema(prevClim, potWithClim, SMOOTH_TAU_MS);
setF('surplusAvgOwn', avgOwn);
setF('surplusAvgClim', avgClim);
msg.potentialSurplus = Math.round(potWithClim);
msg.potentialOwn = Math.round(potOwn);
msg.surplusAvgOwn = Math.round(avgOwn);
msg.surplusAvgClim = Math.round(avgClim);

// --- Consommation de fond, profil horaire ---
// Maison moins cumulus moins clim : ce qui mange la production avant tout
// pilotage. Une case par heure, chacune ne bouge que pendant son heure : en
// quelques jours le profil reflète la vie de la maison (repas, télétravail…).
const DEFAULT_BASE_W = 250;
let profile = getF('baseProfile');
if (!Array.isArray(profile) || profile.length !== 24) profile = new Array(24).fill(DEFAULT_BASE_W);
const hour = new Date(now).getHours();
const baseSample = clamp(msg.house - draw - msg.climTotal, 0, 5000);
if (dtMs > 0) {
    profile[hour] = Math.round(ema(profile[hour], baseSample, 3600 * 1000));
    setF('baseProfile', profile);
}
msg.baseProfile = profile;
msg.baseNow = Math.round(baseSample);

// --- Biais Solcast ---
// Rapport production mesurée / prévue sur le créneau courant, en journée.
// Jour courant : réactif (45 min), repart chaque matin du biais long terme.
// Long terme : lent (≈ 3 jours de soleil), appliqué aux créneaux de demain.
const slotNow = (msg.forecastSlots || []).find(s => now >= s.t && now < s.t + 1800000);
const dayKey = new Date(now).toDateString();
let biasLong = getF('solcastBiasLong');
if (biasLong == null) biasLong = 1;
let biasToday = getF('solcastBiasToday');
if (getF('solcastBiasDay') !== dayKey) {
    setF('solcastBiasDay', dayKey);
    biasToday = biasLong;
}
if (slotNow && slotNow.pv >= 150 && !msg.solcastStale && dtMs > 0) {
    const ratio = clamp(msg.solar / slotNow.pv, 0.2, 2);
    biasToday = ema(biasToday, ratio, 45 * 60000);
    biasLong = ema(biasLong, ratio, 3 * 8 * 3600 * 1000);
}
msg.biasToday = Math.round(clamp(biasToday == null ? 1 : biasToday, 0.2, 2) * 1000) / 1000;
msg.biasLong = Math.round(clamp(biasLong, 0.3, 1.5) * 1000) / 1000;
setF('solcastBiasToday', msg.biasToday);
setF('solcastBiasLong', msg.biasLong);
msg.forecastNowW = slotNow ? Math.round(slotNow.pv) : null;

// --- Refroidissement du ballon (pertes + puisages), °C/h ---
// Mesuré par tranches d'une heure sans chauffe. Une chauffe remet la référence.
const DEFAULT_DECAY = 0.25;
let decay = getF('decayRate');
if (decay == null) decay = DEFAULT_DECAY;
if (msg.tempAvailable) {
    let ref = getF('decayRef');
    if (msg.heating || !ref) {
        ref = { t: now, temp: msg.temp };
    } else if (now - ref.t >= 3600 * 1000) {
        const h = (now - ref.t) / 3600000;
        const rate = clamp((ref.temp - msg.temp) / h, 0, 4);
        // ≈ 2 jours de mémoire : un bain isolé ne fausse pas tout le plan
        decay = decay + (1 - Math.exp(-h / 48)) * (rate - decay);
        ref = { t: now, temp: msg.temp };
    }
    setF('decayRef', ref);
}
setF('decayRate', decay);
msg.decayRate = Math.round(clamp(decay, 0.02, 4) * 1000) / 1000;

// --- Rendement de chauffe ---
// Session de chauffe = suite de ticks avec résistance alimentée. En fin de
// session d'au moins 0,4 kWh et 1,5 °C, rendement = énergie thermique gagnée
// (volume × ΔT) / énergie électrique consommée. La sonde du ballon ne voit
// qu'une strate : ce « rendement » corrige aussi sa position, d'où l'intérêt
// de l'apprendre plutôt que de le supposer.
let sess = getF('heatSession');
let effLearned = getF('effLearned');
let effSamples = getF('effSamples') || 0;
if (msg.heating && msg.tempAvailable) {
    if (!sess) sess = { startTemp: msg.temp, kwh: 0 };
    sess.kwh += draw * dtMs / 3600000 / 1000;
    sess.lastTemp = msg.temp;
} else if (sess) {
    const dT = (sess.lastTemp != null ? sess.lastTemp : sess.startTemp) - sess.startTemp;
    if (sess.kwh >= 0.4 && dT >= 1.5) {
        const sample = clamp(msg.kwhPerDeg * dT / sess.kwh, 0.3, 1);
        effLearned = effLearned == null ? sample : effLearned + 0.3 * (sample - effLearned);
        effSamples++;
        setF('effLearned', effLearned);
        setF('effSamples', effSamples);
    }
    sess = null;
}
setF('heatSession', sess);
msg.effLearned = effLearned == null ? null : Math.round(effLearned * 100) / 100;
msg.effSamples = effSamples;
// Réglage utilisateur tant que l'apprentissage n'a pas trois sessions
msg.eff = (effLearned != null && effSamples >= 3) ? clamp(effLearned, 0.3, 1) : msg.effSetting;
msg.effSource = (effLearned != null && effSamples >= 3) ? 'appris' : 'réglage';

// --- Bilan énergétique du jour ---
// Part solaire instantanée de la chauffe = min(1, surplus potentiel / tirage).
let day = getF('energyDay');
if (!day || day.key !== dayKey) day = { key: dayKey, heatKwh: 0, solarKwh: 0 };
if (draw > 0 && dtMs > 0) {
    const kwh = draw * dtMs / 3600000 / 1000;
    const share = clamp(potOwn / draw, 0, 1);
    day.heatKwh += kwh;
    day.solarKwh += kwh * share;
}
setF('energyDay', day);
msg.heatKwhToday = Math.round(day.heatKwh * 100) / 100;
msg.solarKwhToday = Math.round(day.solarKwh * 100) / 100;
msg.solarShareToday = day.heatKwh > 0.05 ? Math.round(day.solarKwh / day.heatKwh * 100) : null;

return msg;
