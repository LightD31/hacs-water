// === Planification de la chauffe sur la prévision solaire ===
// Contrat Base, export non rémunéré : un kWh exporté ne vaut rien, un kWh
// réseau coûte le même prix à toute heure. Chauffer coûte donc
//     kWh réseau = tirage du cumulus − surplus disponible pendant la chauffe
// et le bon moment est celui où le surplus attendu est le plus grand.
//
// Pour chaque besoin (minimum garanti, cible de confort, cycle anti-légionelle),
// on répartit l'énergie à fournir sur les créneaux Solcast restants avant son
// échéance, en prenant d'abord les créneaux au plus fort surplus attendu
// (production × biais appris − consommation de fond apprise). Le surplus du
// dernier créneau retenu devient le SEUIL du besoin : chauffer maintenant dès
// que le surplus mesuré l'atteint est aussi bon que le plan.
//   - Besoin faible, beau temps devant : seuil haut, on attend le pic.
//   - Besoin fort ou ciel bouché : seuil bas, chauffe avec une part de réseau.
//   - Échéance imminente sans soleil : seuil nul, chauffe immédiate.
// Le refroidissement appris du ballon est pris en compte : attendre coûte des
// degrés, donc de l'énergie.
//
// Jour et nuit viennent de l'intégration Sun (repli : production Solcast) :
//   - l'anti-légionelle ne chauffe que de jour, échéance au coucher du soleil ;
//   - en journée, si l'eau doit passer sous le filet avant le retour du bon
//     soleil demain, le manque est pris sur le soleil restant plutôt que la nuit.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const now = msg.now;
const H = 3600000;
const SLOT_MS = 30 * 60000;

const LEGIO_TEMP_REACHED = 60;   // °C validant un cycle
const LEGIO_GOAL = 61;           // °C visés (marge sur la strate de la sonde)
const LEGIO_DUE_DAYS = 7;
const LEGIO_DEADLINE_DAYS = 10;
const FLOOR_DEADBAND = msg.floorMargin != null ? msg.floorMargin : 2;   // °C au-dessus du minimum visés par le filet
const STORAGE_COVER = 0.9;       // part solaire exigée pour stocker au-delà de la cible
const COMFORT_MIN_SHARE = 0.15;  // part solaire minimale d'un créneau de confort
const SUN_GOOD_SHARE = 0.5;      // « bon soleil » : surplus attendu ≥ la moitié du tirage
const FALLBACK_SUNSET_H = 19;    // coucher supposé sans intégration Sun
const MAX_HORIZON_MS = 48 * H;

// --- Heures du soleil (intégration Sun), à la minute d'horloge locale ---
const clockMin = (t) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const atClock = (dayT, min) => { const d = new Date(dayT); d.setHours(0, min, 0, 0); return d.getTime(); };
const riseMin = msg.sunAvailable ? clockMin(msg.nextRising) : null;
const setMin = msg.sunAvailable ? clockMin(msg.nextSetting) : FALLBACK_SUNSET_H * 60;

// --- Anti-légionelle : échéance plutôt que forçage aveugle ---
let lastHigh = getF('lastHighTempAt');
if (!lastHigh) { lastHigh = now; setF('lastHighTempAt', now); }   // pas de « dû » fantôme au déploiement
if (msg.tempAvailable && msg.temp >= LEGIO_TEMP_REACHED) {
    lastHigh = now;
    setF('lastHighTempAt', now);
}
msg.daysSinceHighTemp = r1((now - lastHigh) / (24 * H));
msg.legionellaDue = now - lastHigh > LEGIO_DUE_DAYS * 24 * H;
// Échéance au coucher du soleil de son 10e jour, quelle que soit l'heure du
// dernier 60 °C : le dernier jour reste utilisable en entier, et le cycle ne se
// retrouve plus coincé dans la nuit d'avant (14 novembre : échéance à 8 h 53,
// cycle entier au réseau de 2 h à 7 h 42, soleil de midi parti en stockage).
msg.legionellaDeadline = atClock(lastHigh + LEGIO_DEADLINE_DAYS * 24 * H, setMin);
msg.legionellaOverdue = msg.legionellaDue && now >= msg.legionellaDeadline;

// --- Cibles ---
msg.reachFor = msg.legionellaDue ? Math.max(msg.target, LEGIO_GOAL) : msg.target;
msg.stopTemp = Math.min(msg.minT + FLOOR_DEADBAND, msg.target);
msg.solarSufficientThreshold = r1(msg.target + msg.solarMargin);
msg.solarCoversTarget = msg.solarTankAvailable === true
    && msg.solarTankTemp >= msg.solarSufficientThreshold;

// --- Créneaux : surplus attendu par créneau ---
const base = msg.baseProfile || new Array(24).fill(250);
const slots = (msg.forecastSlots || [])
    .filter(s => s.t + SLOT_MS > now)
    .map(s => {
        const bias = s.day === 0 ? msg.biasToday : msg.biasLong;
        const b = base[new Date(s.t).getHours()] || 0;
        return {
            t: s.t,
            day: s.day,
            pv: s.pv,
            exp: Math.max(0, s.pv * bias - b),
            exp10: Math.max(0, s.pv10 * Math.min(bias, 1) - b)
        };
    });
const lastSlotEnd = slots.length ? slots[slots.length - 1].t + SLOT_MS : now;
msg.forecastUsable = !msg.solcastStale && slots.length > 0;

// Énergie thermique (kWh) à apporter pour passer de `from` à `goal` °C
const thermalNeed = (from, goal) => Math.max(0, goal - from) * msg.kwhPerDeg;

// --- Jour et nuit ---
// Créneau de jour : son milieu tombe entre lever et coucher (heures du jour,
// stables à quelques minutes près sur les 48 h du plan). Repli : production > 0.
const isDaylight = (s) => {
    if (!msg.sunAvailable) return s.pv > 0;
    const m = clockMin(s.t + SLOT_MS / 2);
    return m >= riseMin && m < setMin;
};
const curSlot = slots.find(s => s.t <= now && now < s.t + SLOT_MS) || null;
const isCurrentSlot = (s) => s.t <= now && now < s.t + SLOT_MS;
const sunUpNow = msg.sunAvailable ? msg.sunUp === true : !!(curSlot && curSlot.pv > 0);
// Fin du jour en cours, puis premier créneau de bon soleil après la nuit
let k = 0;
while (k < slots.length && isDaylight(slots[k])) k++;
const sunsetT = !sunUpNow ? now
    : msg.sunAvailable ? msg.nextSetting
    : (k < slots.length ? slots[k].t : lastSlotEnd);
const goodSunW = msg.loadW * SUN_GOOD_SHARE;
const sunReturn = slots.find(s => s.t >= sunsetT && isDaylight(s) && s.exp >= goodSunW);
const sunReturnT = sunReturn ? sunReturn.t : lastSlotEnd;
msg.sunUpNow = sunUpNow;
msg.sunsetT = sunsetT;
msg.sunReturnT = sunReturnT;

/**
 * Répartit un besoin sur les meilleurs créneaux avant l'échéance.
 * Options :
 *   pessimistic : percentile bas de Solcast (filets de sécurité)
 *   minExp      : surplus attendu minimal d'un créneau retenu. Le confort ne
 *                 chauffe qu'au soleil (contrat Base : chauffer sur le réseau
 *                 maintenant ou plus tard coûte pareil, autant ne pas le faire
 *                 pour une cible qui n'est pas un minimum).
 *   goalAt      : la cible vaut à cet instant (anticipation), pas au moment de
 *                 la chauffe ; projection ancrée sur l'heure de la mesure. À
 *                 refroidissement constant, l'heure de la chauffe n'y change rien.
 *   daylightOnly: créneaux de jour seulement (anti-légionelle)
 * Retourne :
 *   threshold   : surplus (W) à partir duquel chauffer maintenant vaut le plan
 *   thresholdOn : seuil de maintien, celui du créneau suivant (une chauffe
 *                 engagée ne s'interrompt pas dès que le besoin restant fond)
 *   nowPicked   : le créneau courant fait partie du plan (seuil nul : c'est
 *                 l'heure, à surplus égal on chauffe au plus près de l'échéance
 *                 pour limiter les pertes)
 */
function plan(goal, deadline, o) {
    o = o || {};
    const pessimistic = o.pessimistic === true;
    const minExp = o.minExp || 0;
    const dl = Math.min(deadline, now + MAX_HORIZON_MS);
    const out = { goal: goal, deadline: dl, daylightOnly: o.daylightOnly === true };
    if (!msg.tempAvailable) return null;
    const needAt = (tMean) => o.goalAt != null
        ? thermalNeed(msg.temp - msg.decayRate * Math.max(0, o.goalAt - (msg.tempAt || now)) / H, goal)
        : thermalNeed(msg.temp - msg.decayRate * Math.max(0, tMean - now) / H, goal);
    if (needAt(now) <= 0) return null;

    // Repli sans prévision exploitable : demi-solaire, puis immédiat à l'approche
    if (!msg.forecastUsable) {
        out.threshold = (dl - now) < 2 * H ? 0 : Math.round(msg.loadW * 0.5);
        out.thresholdOn = out.threshold;
        out.nowPicked = out.threshold === 0;
        out.needKwh = r2(thermalNeed(msg.temp - msg.decayRate * (dl - now) / H / 2, goal) / msg.eff);
        out.fallback = true;
        out.slots = [];
        return out;
    }

    const cands = slots
        .filter(s => s.t < dl && (!o.daylightOnly || isDaylight(s)))
        .map(s => {
            const start = Math.max(s.t, now);
            const end = Math.min(s.t + SLOT_MS, dl);
            return { t: s.t, start: start, h: Math.max(0, end - start) / H,
                exp: pessimistic ? s.exp10 : s.exp };
        })
        .filter(s => s.h > 0 && s.exp >= minExp)
        // À surplus égal, le plus tard : moins de pertes avant usage. Chauffe
        // engagée : le créneau en cours passe devant. Un besoin à seuil nul
        // prend alors le relais de la chauffe en cours (minimum puis
        // anti-légionelle) au lieu de couper et de redémarrer plus tard ; le
        // verrou du nœud Décider ne tient, lui, que le plan qui a démarré.
        .sort((a, b) => b.exp - a.exp
            || (msg.switchState === 'on' ? isCurrentSlot(b) - isCurrentSlot(a) : 0)
            || b.t - a.t);
    if (cands.length === 0 && minExp) return null;

    // Deux passes : le besoin dépend du moment de la chauffe (refroidissement).
    let tMean = now;
    let picked = [], need = 0, got = 0;
    for (let pass = 0; pass < 2; pass++) {
        need = needAt(tMean);
        picked = [];
        got = 0;
        for (const s of cands) {
            if (got >= need) break;
            picked.push(s);
            got += msg.loadW / 1000 * s.h * msg.eff;
        }
        const w = picked.reduce((a, s) => a + s.h, 0);
        tMean = w > 0 ? picked.reduce((a, s) => a + (s.start + s.h * H / 2) * s.h, 0) / w : now;
    }
    // Besoin plus grand que tous les créneaux réunis : chauffe dès maintenant
    // pour un filet de sécurité ; pour le confort, au moindre surplus utile.
    const shortfall = got < need;
    const last = picked[picked.length - 1];
    const next = cands[picked.length];
    if (shortfall && !minExp) {
        out.threshold = 0;
        // De jour seulement : la nuit, on attend le jour (échéance passée, la
        // règle « échue » du nœud Décider force la chauffe).
        out.nowPicked = !o.daylightOnly || sunUpNow;
    } else {
        out.threshold = last ? Math.round(last.exp) : 0;
        out.nowPicked = picked.some(s => s.start === now || (s.t <= now && now < s.t + SLOT_MS));
    }
    out.thresholdOn = next ? Math.min(out.threshold, Math.round(next.exp)) : out.threshold;
    out.needKwh = r2(need / msg.eff);
    out.freeKwh = r2(picked.reduce((a, s) => a + Math.min(s.exp, msg.loadW) * s.h, 0) / 1000);
    out.gridKwh = r2(Math.max(0, out.needKwh - out.freeKwh));
    out.shortfall = shortfall;
    out.slots = picked.map(s => s.t).sort((a, b) => a - b);
    out.firstSlot = out.slots.length ? out.slots[0] : null;
    return out;
}

const plans = [];

// 1. Minimum garanti : échéance = moment où le refroidissement atteint min_temp.
//    Déjà dessous : immédiat (seuil nul). Prévision pessimiste (p10).
//    Inutile si le ballon solaire amont fournit déjà l'eau à la cible.
//    Échéance ancrée sur l'heure de la MESURE (pas sur l'horloge : une valeur
//    figée la faisait reculer d'une minute par minute) et sur la pente la plus
//    raide entre refroidissement appris et puisage en cours.
const floorRate = Math.max(msg.decayRate, msg.drawRate || 0, 0.02);
const tempAt = msg.tempAt || now;
// La sonde publie à 1 °C de variation : la vraie température est au-dessus de
// (mesure − 1 °C). Estimation bornée à 0,9 °C sous la mesure.
// En chauffe la sonde monte : pas d'extrapolation à la baisse.
msg.tempEst = !msg.tempAvailable ? null : msg.heating ? msg.temp
    : r1(Math.max(msg.temp - 0.9, msg.temp - floorRate * Math.max(0, now - tempAt) / H));
if (msg.tempAvailable && msg.tempEst < msg.stopTemp && !msg.solarCoversTarget) {
    const deadline = msg.tempEst <= msg.minT ? now
        : Math.max(now, tempAt + (msg.temp - msg.minT) / floorRate * H);
    const p = plan(msg.stopTemp, deadline, { pessimistic: true });
    if (p) plans.push(Object.assign(p, { id: 'floor', label: 'Minimum garanti', basis: 'clim' }));
}

// 1 bis. Anticipation de la nuit : soleil levé, l'eau passera-t-elle sous le
//    seuil du filet avant le retour du bon soleil demain ? Si oui, le manque
//    est pris maintenant sur le bon soleil restant du jour (au moins la moitié
//    du tirage couverte), jamais sur le réseau : le filet (1) reste là pour la
//    nuit si le jour n'y suffit pas. Refroidissement appris (moyenne avec les
//    puisages) : sur une nuit entière, la pente du moment n'a pas de sens.
if (msg.tempAvailable && !msg.solarCoversTarget && msg.forecastUsable && sunUpNow && sunsetT > now) {
    const p = plan(msg.stopTemp, sunsetT, { minExp: goodSunW, goalAt: sunReturnT });
    if (p) plans.push(Object.assign(p, { id: 'floor_ahead', label: 'Anticipation de la nuit', basis: 'clim' }));
}

// 2. Anti-légionelle : échéance au coucher du 10e jour, créneaux de jour
//    seulement. Le plan va chercher le meilleur soleil d'ici là ; s'il ne
//    suffit pas, le complément se fait de jour. Échéance passée : seuil nul.
if (msg.legionellaDue && msg.tempAvailable && msg.temp < LEGIO_GOAL) {
    const p = plan(LEGIO_GOAL, msg.legionellaOverdue ? now : msg.legionellaDeadline, { daylightOnly: true });
    if (p) plans.push(Object.assign(p, { id: 'legionella', label: 'Anti-légionelle', basis: 'clim' }));
}

// 3. Confort : cible atteinte d'ici la fin de la prévision (demain soir), au
//    soleil seulement. Inutile si le ballon solaire amont fournit déjà l'eau.
if (!msg.solarCoversTarget) {
    const p = plan(msg.target, lastSlotEnd, { minExp: msg.loadW * COMFORT_MIN_SHARE });
    if (p) plans.push(Object.assign(p, { id: 'comfort', label: 'Cible de confort', basis: 'clim' }));
}

// 4. Stockage : chaleur quasi gratuite toujours prise, sans plafond logiciel
//    (le thermostat mécanique coupe). Le confort de la clim passe avant : seuil
//    comparé au surplus SANS effacer la clim.
const storageW = Math.round(msg.loadW * STORAGE_COVER);
plans.push({ id: 'storage', label: 'Stockage gratuit', basis: 'own',
    threshold: storageW, thresholdOn: storageW, nowPicked: false, slots: [] });

msg.plans = plans;

// Créneaux retenus du besoin le plus contraignant, pour l'affichage
const needPlans = plans.filter(p => p.id !== 'storage');
const lead = needPlans.slice().sort((a, b) => (b.nowPicked - a.nowPicked) || a.threshold - b.threshold)[0] || null;
msg.leadPlan = lead ? lead.id : null;
msg.plannedSlots = lead ? lead.slots : [];
msg.needKwh = lead ? lead.needKwh : 0;
msg.planGridKwh = lead && lead.gridKwh != null ? lead.gridKwh : 0;

// Surplus attendu sur le reste de la journée, pour l'affichage
msg.expectedSurplusKwh = r1(slots.filter(s => s.day === 0)
    .reduce((a, s) => a + s.exp * (s.t + SLOT_MS - Math.max(s.t, now)) / H, 0) / 1000);

return msg;
