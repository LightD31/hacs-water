// === Bilan électrique et apprentissage de la puissance des unités ===
// Unités inverter : la puissance varie de 150 à 1000 W selon l'écart à la
// consigne, aucune valeur fixe ne la décrit. Elle est donc APPRISE sur les
// compteurs des disjoncteurs : quand une unité tourne seule sur son groupe,
// la mesure du groupe est la sienne. Plusieurs unités sur un groupe : la mesure
// est partagée au prorata de leur puissance apprise.
//
// recoverable_w = ce que le flow rendrait en coupant ce qu'il a allumé. Publié
// pour le flow cumulus, qui l'ajoute à son surplus : l'eau chaude démarre sans
// attendre que la clim lui laisse la place, la clim suit ensuite le compteur.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const now = msg.now;
const lastRun = getF('bilanLastRun');
const dtMs = lastRun ? clamp(now - lastRun, 0, 10 * 60000) : 0;
setF('bilanLastRun', now);
const ema = (prev, sample, tauMs) => {
    if (prev == null || isNaN(prev)) return sample;
    return prev + (1 - Math.exp(-dtMs / tauMs)) * (sample - prev);
};

// --- Export disponible, lissé (60 s) : une bouilloire ne doit pas faire bouger
// les consignes. Un cumulus en simple stockage cède sa consommation au confort.
msg.cumulusYieldW = msg.cumulus.storageOnly ? Math.max(0, Math.round(msg.cumulus.draw)) : 0;
const exportAvg = ema(getF('exportAvg'), msg.export + msg.cumulusYieldW, 60 * 1000);
setF('exportAvg', exportAvg);
msg.exportAvg = Math.round(exportAvg);

// --- Puissance par unité ---
const learned = (u) => {
    const v = getF('unitW:' + u.id);
    return v == null ? msg.defaultUnitW : v;
};
const metered = msg.groups.filter(gr => gr.power != null);
let climTotal = 0;
const accounted = {};
for (const gr of msg.groups) {
    const inGroup = msg.units.filter(u => gr.units.indexOf(u.id) !== -1);
    for (const u of inGroup) accounted[u.id] = true;
    const running = inGroup.filter(u => u.on);
    if (gr.power == null) {
        for (const u of running) { u.powerW = learned(u); u.powerSource = 'estimation'; climTotal += u.powerW; }
        continue;
    }
    const net = Math.max(0, gr.power - msg.groupStandbyW);
    climTotal += net;
    if (running.length === 1) {
        const u = running[0];
        u.powerW = net;
        u.powerSource = 'mesure';
        // Apprentissage hors démarrage (pic d'inrush) et hors veille compresseur
        if (dtMs > 0 && net > 60) {
            setF('unitW:' + u.id, Math.round(clamp(ema(getF('unitW:' + u.id), net, 30 * 60000), 100, 3000)));
        }
    } else if (running.length > 1) {
        const sum = running.reduce((a, u) => a + learned(u), 0);
        for (const u of running) {
            u.powerW = Math.round(net * learned(u) / sum);
            u.powerSource = 'prorata';
        }
    }
}
for (const u of msg.units) {
    if (!accounted[u.id] && u.on) { u.powerW = learned(u); u.powerSource = 'estimation'; climTotal += u.powerW; }
    if (!u.on) { u.powerW = 0; u.powerSource = null; }
    u.learnedW = learned(u);
    u.powerW = Math.round(u.powerW || 0);
}
msg.climTotal = Math.round(climTotal);
msg.recoverable = msg.units.filter(u => u.owned && u.on).reduce((a, u) => a + u.powerW, 0);
msg.metered = metered.length > 0;

// --- Énergie du jour consommée par les unités pilotées, et sa part solaire ---
const dayKey = new Date(now).toDateString();
let day = getF('energyDay');
if (!day || day.key !== dayKey) day = { key: dayKey, kwh: 0, solarKwh: 0 };
if (msg.recoverable > 0 && dtMs > 0) {
    const kwh = msg.recoverable * dtMs / 3600000 / 1000;
    day.kwh += kwh;
    day.solarKwh += kwh * clamp((msg.export + msg.recoverable) / msg.recoverable, 0, 1);
}
setF('energyDay', day);
msg.climKwhToday = Math.round(day.kwh * 100) / 100;
msg.climSolarShareToday = day.kwh > 0.05 ? Math.round(day.solarKwh / day.kwh * 100) : null;

return msg;
