// === Besoin de confort, sens et plage de consigne, pièce par pièce ===
// Pour chaque pièce : faut-il refroidir / chauffer, et entre quelles consignes
// le routeur peut moduler la puissance de l'unité.
//   deep  : consigne de stockage (cible ∓ CLIM_STORE_BAND, bornée par
//           CLIM_COOL_FLOOR / CLIM_HEAT_CEILING) → puissance maximale
//   idle  : consigne au-delà de la température de la pièce → compresseur
//           au ralenti, l'unité ne consomme presque plus
// Le routeur fait glisser la consigne entre les deux pour suivre le surplus,
// comme un routeur solaire module une résistance.
//
// Saison (mode auto) : prévision du jour si disponible (maxi ≥ seuil froid,
// mini ≤ seuil chaud), sinon température extérieure, sinon l'écart intérieur
// tranche seul. Sens latché par unité pendant un cycle.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const seasonOff = msg.seasonMode === 'arret';
const fc = msg.forecast;
const outdoor = msg.outdoorAvailable ? msg.outdoorTemp : null;

let hotDay, coldDay;
if (fc && fc.todayMax != null && fc.todayMin != null) {
    hotDay = fc.todayMax >= msg.outdoorCoolMin;
    coldDay = fc.todayMin <= msg.outdoorHeatMax;
    msg.seasonBasis = 'prévision ' + fc.todayMin + '–' + fc.todayMax + ' °C';
} else if (outdoor != null) {
    hotDay = outdoor >= msg.outdoorCoolMin;
    coldDay = outdoor <= msg.outdoorHeatMax;
    msg.seasonBasis = 'extérieur ' + outdoor + ' °C (' + msg.outdoorSource + ')';
} else {
    hotDay = coldDay = true;
    msg.seasonBasis = 'aucune donnée extérieure';
}
const canCool = !seasonOff && (msg.seasonMode === 'froid' || (msg.seasonMode === 'auto' && hotDay));
const canHeat = !seasonOff && (msg.seasonMode === 'chaud' || (msg.seasonMode === 'auto' && coldDay));
msg.canCool = canCool;
msg.canHeat = canHeat;

const coolStore = Math.max(msg.targetCool - msg.storeBand, msg.coolFloor);
const heatStore = Math.min(msg.targetHeat + msg.storeBand, msg.heatCeiling);
msg.coolStore = Math.round(coolStore * 10) / 10;
msg.heatStore = Math.round(heatStore * 10) / 10;

const snap = (v, u) => {
    const s = u.spStep || 0.5;
    return Math.max(u.spMin, Math.min(u.spMax, Math.round(v / s) * s));
};

for (const u of msg.units) {
    u.needMode = 'none';
    u.comfortNeed = false;
    u.needReason = null;
    u.deepSp = null;
    u.idleSp = null;

    if (!u.available) { u.needReason = 'Unité injoignable'; setF('modeLatch:' + u.id, null); continue; }
    if (!u.tempAvailable) { u.needReason = 'Température de la pièce illisible'; setF('modeLatch:' + u.id, null); continue; }
    if (seasonOff) { u.needReason = 'Mode saison sur arrêt'; setF('modeLatch:' + u.id, null); continue; }

    const t = u.current;
    const latch = getF('modeLatch:' + u.id);
    const running = u.on && u.owned;
    let mode = 'none';
    if (canCool && t > msg.targetCool) mode = 'cool';
    else if (canHeat && t < msg.targetHeat) mode = 'heat';
    else if (canCool && t > coolStore && (latch === 'cool' || !canHeat)) mode = 'cool';      // stockage de fraîcheur
    else if (canHeat && t < heatStore && (latch === 'heat' || !canCool)) mode = 'heat';      // stockage de chaleur
    // Un cycle en cours garde son sens jusqu'au bout du stockage
    if (running && latch && mode !== latch) {
        if (latch === 'cool' && canCool && t > coolStore) mode = 'cool';
        if (latch === 'heat' && canHeat && t < heatStore) mode = 'heat';
    }

    u.modeSupported = mode === 'none' || u.modes.length === 0 || u.modes.indexOf(mode) !== -1;
    if (mode !== 'none' && !u.modeSupported) {
        u.needReason = 'Mode ' + mode + ' non exposé par l\'unité (' + u.modes.join(', ') + ')';
        setF('modeLatch:' + u.id, null);
        continue;
    }

    if (mode === 'cool') {
        u.comfortNeed = t > msg.targetCool;
        u.deepSp = snap(coolStore, u);
        // Au-dessus de la pièce : le compresseur ralentit puis s'arrête
        u.idleSp = snap(Math.max(msg.targetCool, t + 1), u);
        u.needReason = u.comfortNeed
            ? t + ' °C, au-dessus de la cible froid ' + msg.targetCool + ' °C'
            : 'Stockage de fraîcheur jusqu\'à ' + msg.coolStore + ' °C';
    } else if (mode === 'heat') {
        u.comfortNeed = t < msg.targetHeat;
        u.deepSp = snap(heatStore, u);
        u.idleSp = snap(Math.min(msg.targetHeat, t - 1), u);
        u.needReason = u.comfortNeed
            ? t + ' °C, sous la cible chaud ' + msg.targetHeat + ' °C'
            : 'Stockage de chaleur jusqu\'à ' + msg.heatStore + ' °C';
    } else if (!canCool && !canHeat) {
        u.needReason = 'Saison neutre (' + msg.seasonBasis + ')';
    } else {
        u.needReason = 'Confort assuré (' + t + ' °C)';
    }
    u.needMode = mode;
    setF('modeLatch:' + u.id, mode === 'none' ? null : mode);
}

msg.needCount = msg.units.filter(u => u.needMode !== 'none').length;
return msg;
