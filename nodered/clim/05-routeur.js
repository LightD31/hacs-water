// === Routeur solaire : la consigne des unités suit le surplus ===
//
// Priorité de la décision, de haut en bas :
//   1. Automatisation désactivée          → aucune commande
//   2. Unité hors périmètre (allumée à la main, pause 45 min, disjoncteur
//      coupé, injoignable)               → jamais touchée
//   3. Besoin disparu                     → arrêt (après le min-run)
//   4. Boucle de puissance sur le compteur :
//        écart = export lissé − marge + tolérance d'import
//      > 0 : consigne plus profonde (+ de puissance) sur l'unité la plus
//            prioritaire, puis démarrage de la suivante
//      < 0 : consigne relâchée vers le ralenti sur les moins prioritaires,
//            puis arrêt de la moins prioritaire une fois toutes au ralenti
//   5. Anti court-cycle par unité         → min-run / min-off
//
// L'eau chaude passe avant : le flow cumulus compte recoverable_w dans son
// surplus et démarre quand il veut ; le compteur bascule en import, la boucle
// relâche les consignes dans la minute. Aucune réservation à deviner ici.
//
// Tolérance d'import (input_number.clim_import_allowance) : appliquée seulement
// si une pièce pilotée est HORS de sa cible de confort. Le stockage (pièce déjà
// dans sa cible, surplus mis en réserve dans les murs) reste au seul surplus.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const now = msg.now;
const DEAD_W = 100;               // zone morte autour de la cible d'export
const STEP_UP_MS = 3 * 60000;     // une consigne plus profonde toutes les 3 min par unité
const STEP_DOWN_MS = 2 * 60000;   // relâchement plus réactif (chaque minute importée se paie)
const SETTLE_MS = 90 * 1000;      // délai global après toute modification (réponse de l'inverter)
const W_PER_DEG = 250;            // ordre de grandeur : W rendus par °C de consigne relâché
const START_FRACTION = 0.6;       // part de la puissance apprise exigée pour démarrer
const SHED_MS = 5 * 60000;        // import persistant, toutes unités au ralenti → arrêt
const IDLE_STOP_MS = 15 * 60000;  // ralenti prolongé sans surplus → arrêt

const path = [];
const step = (id, label, status, detail) => path.push({ id, label, status, detail: detail || null });
const toward = (from, to, deg) => (to > from ? Math.min(to, from + deg) : Math.max(to, from - deg));
const snap = (v, u) => {
    const s = u.spStep || 0.5;
    return Math.max(u.spMin, Math.min(u.spMax, Math.round(v / s) * s));
};
const spAt = (u) => getF('spAt:' + u.id) || 0;

for (const u of msg.units) { u.desired = null; u.desiredReason = null; u.targetSp = null; }

// --- 1. Automatisation désactivée ---
if (!msg.enabled) {
    for (const u of msg.units) { u.desired = 'skip'; u.desiredReason = 'automatisation désactivée'; }
    step('enabled', 'Automatisation active', 'hit', 'désactivée');
    setF('pendingStart', null);
    setF('pendingShedSince', null);
    msg.state = 'Désactivé';
    msg.reason = 'Automatisation désactivée, aucune commande envoyée';
    msg.decisionPath = path;
    msg.routerAction = 'none';
    return msg;
}
step('enabled', 'Automatisation active', 'pass');

// --- 2. Hors périmètre ---
let outCount = 0;
for (const u of msg.units) {
    if (u.manualControl) { u.desired = 'skip'; u.desiredReason = 'pilotée à la main, non modifiée'; }
    else if (u.breakerOn === false) { u.desired = 'skip'; u.desiredReason = 'disjoncteur ' + (u.group || '?') + ' coupé'; }
    else if (!u.available) { u.desired = 'skip'; u.desiredReason = 'injoignable, aucune commande'; }
    else if (u.holdActive && !u.on) { u.desired = 'skip'; u.desiredReason = 'pause après intervention manuelle'; }
    if (u.desired === 'skip') outCount++;
}
step('scope', 'Unités dans le périmètre', 'pass',
    outCount ? outCount + ' hors périmètre' : null);

// --- 3. Besoin disparu ---
const running = [];
let released = 0;
for (const u of msg.units) {
    if (u.desired || !u.owned || !u.on) continue;
    if (u.needMode === 'none') {
        if (u.minRunOk) {
            u.desired = 'off';
            u.desiredReason = u.needReason || 'plus de besoin';
            released++;
        } else {
            // Min-run : l'unité reste allumée, consigne au ralenti
            u.desired = 'on';
            u.targetSp = u.commandedSp != null ? u.commandedSp : u.setpoint;
            u.desiredReason = (u.needReason || 'plus de besoin') + ', arrêt dans ' + u.minRunLeftMin + ' min';
        }
    } else {
        running.push(u);
    }
}
step('release', 'Besoin toujours présent', 'pass', released ? released + ' unité(s) libérée(s)' : null);

// Consigne courante de chaque unité pilotée
for (const u of running) {
    let sp = u.commandedSp != null ? u.commandedSp : (u.setpoint != null ? u.setpoint : u.deepSp);
    // Bornes recalculées à chaque tick (cible changée, pièce qui évolue)
    const lo = Math.min(u.deepSp, u.idleSp), hi = Math.max(u.deepSp, u.idleSp);
    u.targetSp = snap(Math.max(lo, Math.min(hi, sp)), u);
    u.atDeep = u.targetSp === u.deepSp;
    u.atIdle = u.targetSp === u.idleSp;
}

// --- 4. Boucle de puissance ---
const anyComfortRunning = running.some(u => u.comfortNeed);
const eligible = msg.units.filter(u => !u.desired && !u.on && u.needMode !== 'none'
    && u.available && u.modeSupported && !u.holdActive)
    .sort((a, b) => a.priority - b.priority);
const nextUnit = eligible.find(u => u.minOffOk) || null;
const allowanceFor = (comfort) => (comfort ? msg.importAllowance : 0);
// Tolérance active si une pièce pilotée est hors de sa cible, ou pour démarrer
// la prochaine pièce hors de sa cible une fois les autres à pleine puissance.
const allowComfort = anyComfortRunning
    || (!!nextUnit && nextUnit.comfortNeed && running.every(u => u.atDeep));
msg.allowanceActive = allowComfort && msg.importAllowance > 0;
msg.errorW = Math.round(msg.exportAvg - msg.exportMargin + allowanceFor(allowComfort));
const lastChange = getF('lastChangeAt') || 0;
const settled = now - lastChange >= SETTLE_MS;
let action = 'hold';
let actionDetail = null;

if (msg.errorW > DEAD_W) {
    setF('pendingShedSince', null);
    // a) Puissance supplémentaire sur une unité déjà en marche, la plus prioritaire d'abord
    const deepen = running.slice().sort((a, b) => a.priority - b.priority)
        .find(u => !u.atDeep && now - spAt(u) >= STEP_UP_MS);
    const saturated = running.every(u => u.atDeep);
    if (deepen && settled) {
        deepen.targetSp = snap(toward(deepen.targetSp, deepen.deepSp, 0.5), deepen);
        deepen.spChanged = true;
        action = 'deepen';
        actionDetail = deepen.label + ' → ' + deepen.targetSp + ' °C';
        setF('pendingStart', null);
    } else if (saturated && nextUnit && running.length < msg.maxUnits) {
        // b) Démarrage de la suivante, si l'écart couvre sa puissance de démarrage
        const err = msg.errorW;
        const needW = Math.round(START_FRACTION * nextUnit.learnedW);
        nextUnit.startNeedW = needW;
        if (err >= needW) {
            const p = getF('pendingStart');
            if (p && p.id === nextUnit.id) {
                if (now - p.since >= msg.confirmMs && settled) {
                    nextUnit.desired = 'on';
                    nextUnit.startNow = true;
                    nextUnit.desiredReason = 'surplus ' + msg.exportAvg + ' W ≥ ' + needW + ' W de démarrage';
                    // Consigne de départ : cible de confort si besoin, sinon stockage doux
                    const start = nextUnit.comfortNeed
                        ? (nextUnit.needMode === 'cool' ? msg.targetCool : msg.targetHeat)
                        : (nextUnit.needMode === 'cool' ? nextUnit.current - 1 : nextUnit.current + 1);
                    const lo = Math.min(nextUnit.deepSp, nextUnit.idleSp), hi = Math.max(nextUnit.deepSp, nextUnit.idleSp);
                    nextUnit.targetSp = snap(Math.max(lo, Math.min(hi, start)), nextUnit);
                    action = 'start';
                    actionDetail = nextUnit.label;
                    setF('pendingStart', null);
                } else {
                    action = 'start_pending';
                    actionDetail = nextUnit.label + ' dans '
                        + Math.max(1, Math.ceil((msg.confirmMs - (now - p.since)) / 60000)) + ' min';
                }
            } else {
                setF('pendingStart', { id: nextUnit.id, since: now });
                action = 'start_pending';
                actionDetail = nextUnit.label + ' dans ' + Math.ceil(msg.confirmMs / 60000) + ' min';
            }
        } else {
            setF('pendingStart', null);
            action = 'hold';
            actionDetail = 'écart ' + err + ' W < ' + needW + ' W pour démarrer ' + nextUnit.label;
        }
    } else {
        if (!deepen) setF('pendingStart', null);
        actionDetail = saturated ? (nextUnit ? 'plafond d\'unités' : 'aucune autre pièce en demande')
            : 'stabilisation';
    }
} else if (msg.errorW < -DEAD_W) {
    setF('pendingStart', null);
    // a) Relâchement des consignes, moins prioritaires d'abord, proportionnel à l'écart
    let remaining = -msg.errorW;
    const relaxed = [];
    for (const u of running.slice().sort((a, b) => b.priority - a.priority)) {
        if (remaining <= 0) break;
        if (u.atIdle || now - spAt(u) < STEP_DOWN_MS) continue;
        const deg = Math.min(2, Math.max(0.5, Math.ceil(remaining / W_PER_DEG) * 0.5));
        const before = u.targetSp;
        u.targetSp = snap(toward(u.targetSp, u.idleSp, deg), u);
        if (u.targetSp !== before) {
            u.spChanged = true;
            remaining -= Math.abs(u.targetSp - before) * W_PER_DEG;
            relaxed.push(u.label + ' → ' + u.targetSp + ' °C');
        }
    }
    if (relaxed.length) {
        action = 'relax';
        actionDetail = relaxed.join(', ');
        setF('pendingShedSince', null);
    } else if (running.length && running.every(u => u.atIdle)) {
        // b) Toutes au ralenti et l'import persiste : arrêt de la moins prioritaire
        let since = getF('pendingShedSince');
        if (!since) { since = now; setF('pendingShedSince', now); }
        const victim = running.slice().sort((a, b) => b.priority - a.priority)[0];
        if (now - since >= SHED_MS) {
            if (victim.minRunOk) {
                victim.desired = 'off';
                victim.desiredReason = 'import persistant, consigne déjà au ralenti';
                action = 'stop';
                actionDetail = victim.label;
                setF('pendingShedSince', null);
            } else {
                action = 'stop_pending';
                actionDetail = victim.label + ', anti court-cycle ' + victim.minRunLeftMin + ' min';
            }
        } else {
            action = 'stop_pending';
            actionDetail = victim.label + ' dans ' + Math.ceil((SHED_MS - (now - since)) / 60000) + ' min';
        }
    } else {
        actionDetail = 'consignes en cours de relâchement';
    }
} else {
    setF('pendingStart', null);
    setF('pendingShedSince', null);
    actionDetail = 'surplus équilibré';
}

// Unité au ralenti depuis IDLE_STOP_MS sans que le surplus la relance : elle ne
// sert plus à rien, arrêt de la moins prioritaire (une par tick, après min-run).
for (const u of running) {
    if (u.targetSp === u.idleSp) { if (!getF('idleSince:' + u.id)) setF('idleSince:' + u.id, now); }
    else setF('idleSince:' + u.id, null);
}
if (action === 'hold' || action === 'stop_pending') {
    const idleVictim = running.slice().sort((a, b) => b.priority - a.priority)
        .find(u => !u.desired && u.targetSp === u.idleSp && u.minRunOk
            && now - (getF('idleSince:' + u.id) || now) >= IDLE_STOP_MS);
    if (idleVictim) {
        idleVictim.desired = 'off';
        idleVictim.desiredReason = 'au ralenti depuis ' + Math.round(IDLE_STOP_MS / 60000)
            + ' min, surplus absent';
        setF('idleSince:' + idleVictim.id, null);
        action = 'stop';
        actionDetail = idleVictim.label + ' (ralenti prolongé)';
    }
}
msg.routerAction = action;
msg.routerDetail = actionDetail;
step('router', 'Boucle de puissance', action === 'hold' ? 'pass' : 'hit',
    'écart ' + msg.errorW + ' W · ' + (actionDetail || action));

// Unités conservées, unités restantes
for (const u of running) {
    if (!u.desired) { u.desired = 'on'; u.desiredReason = u.needReason; }
}
for (const u of msg.units) {
    if (!u.desired) {
        u.desired = 'off';
        if (!u.desiredReason) {
            u.desiredReason = u.needMode === 'none' ? u.needReason
                : (u.on ? 'en attente' : (u.minOffOk ? 'en attente de surplus'
                    : 'anti court-cycle, ' + u.minOffLeftMin + ' min'));
        }
    }
}
const anyChange = msg.units.some(u => u.spChanged || u.startNow
    || (u.desired === 'off' && u.on && u.owned));
if (anyChange) setF('lastChangeAt', now);

// --- Synthèse ---
const onUnits = msg.units.filter(u => u.desired === 'on');
msg.activeLabels = onUnits.map(u => u.label);
msg.activeCount = onUnits.length;
const modes = onUnits.map(u => u.needMode);
const cumulusHeating = (msg.cumulus.draw > 0 || msg.cumulus.desired === 'on') && !msg.cumulus.storageOnly;
msg.cumulusHeating = cumulusHeating;

if (msg.activeCount > 0) {
    const cooling = modes.indexOf('cool') !== -1, heating = modes.indexOf('heat') !== -1;
    msg.state = (cooling && heating) ? 'Confort gratuit' : cooling ? 'Rafraîchissement gratuit' : 'Chauffage gratuit';
    const throttled = action === 'relax' || action === 'stop_pending'
        || (running.length > 0 && running.every(u => u.targetSp === u.idleSp));
    if (throttled) msg.state = cumulusHeating ? 'Ralenti (eau chaude prioritaire)' : 'Ralenti (surplus en baisse)';
    msg.reason = msg.activeLabels.join(', ') + ' · ' + (msg.recoverable || 0) + ' W · écart '
        + msg.errorW + ' W' + (actionDetail ? ' · ' + actionDetail : '')
        + (cumulusHeating ? ' · cumulus en chauffe, prioritaire' : '');
} else if (msg.manualCount > 0 && msg.needCount === 0) {
    msg.state = 'Pilotage manuel';
    msg.reason = msg.units.filter(u => u.manualControl).map(u => u.label).join(', ')
        + ' pilotée(s) à la main, non modifiée(s)';
} else if (msg.needCount === 0) {
    msg.state = msg.seasonMode === 'arret' ? 'Mode saison arrêté'
        : (!msg.canCool && !msg.canHeat) ? 'Hors saison' : 'Confort atteint';
    msg.reason = 'Aucune pièce en demande (' + msg.seasonBasis + ')';
} else if (action === 'start_pending') {
    msg.state = 'Démarrage différé';
    msg.reason = 'Surplus en cours de confirmation : ' + actionDetail;
} else if (cumulusHeating) {
    msg.state = 'Veille (eau chaude prioritaire)';
    msg.reason = 'Le cumulus chauffe sur le surplus, ' + msg.needCount + ' pièce(s) en attente';
} else {
    msg.state = 'Veille (surplus insuffisant)';
    msg.reason = 'Export ' + msg.exportAvg + ' W'
        + (nextUnit ? ', ' + Math.round(START_FRACTION * nextUnit.learnedW) + ' W pour démarrer ' + nextUnit.label : '');
}

msg.decisionPath = path;
return msg;
