// === Détection du pilotage manuel, unité par unité ===
//  - PROPRIÉTÉ : une unité allumée hors du flow n'est jamais touchée par lui
//    (owned = false). Le confort demandé explicitement passe avant l'économie.
//  - REPRISE EN MAIN : mode OU consigne changés hors du flow sur une unité
//    qu'il pilote → elle lui est retirée, pause de 45 min sur CETTE unité.
//    Le flow modulant lui-même la consigne, il mémorise celle qu'il a envoyée
//    pour ne pas prendre ses propres réglages pour ceux de l'utilisateur.
// États illisibles (reboot HA) ignorés.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const MANUAL_HOLD_MS = 45 * 60 * 1000;
const HA_LAG_GRACE_MS = 90 * 1000;
const SP_TOL = 0.3;
const now = msg.now;

for (const u of msg.units) {
    const K = ':' + u.id;
    let expected = getF('expectedHvac' + K);
    if (expected == null && u.available) {
        expected = u.hvacMode;
        setF('expectedHvac' + K, expected);
    }
    const prevActionAt = getF('lastActionAt' + K) || 0;
    let holdUntil = getF('holdUntil' + K) || 0;
    let owned = getF('owned' + K) === true;
    const expSp = getF('expectedSp' + K);
    const settled = now - prevActionAt > HA_LAG_GRACE_MS;

    const modeChanged = u.available && expected != null && u.hvacMode !== expected;
    const spChanged = u.available && owned && u.on && expSp != null && u.setpoint != null
        && Math.abs(u.setpoint - expSp) > SP_TOL;
    if (settled && (modeChanged || spChanged)) {
        holdUntil = now + MANUAL_HOLD_MS;
        setF('holdUntil' + K, holdUntil);
        setF('expectedHvac' + K, u.hvacMode);
        setF('expectedSp' + K, null);
        owned = false;
        setF('owned' + K, false);
        node.warn('Pilotage manuel détecté sur ' + u.label
            + (spChanged && !modeChanged ? ' (consigne ' + u.setpoint + ' °C)' : '') + ' → pause 45 min');
    }

    if (!u.on && owned) {
        owned = false;
        setF('owned' + K, false);
    }

    u.owned = owned;
    u.holdActive = now < holdUntil;
    u.holdUntil = holdUntil > now ? holdUntil : null;
    u.manualControl = u.on && !owned;
    u.commandedSp = owned ? expSp : null;
    const lastOnAt = getF('lastOnAt' + K) || 0;
    const lastOffAt = getF('lastOffAt' + K) || 0;
    u.minRunOk = now - lastOnAt >= msg.minRunMs;
    u.minOffOk = now - lastOffAt >= msg.minOffMs;
    u.minRunLeftMin = u.on ? Math.max(0, Math.ceil((msg.minRunMs - (now - lastOnAt)) / 60000)) : 0;
    u.minOffLeftMin = !u.on ? Math.max(0, Math.ceil((msg.minOffMs - (now - lastOffAt)) / 60000)) : 0;
}

msg.manualCount = msg.units.filter(u => u.manualControl).length;
msg.holdCount = msg.units.filter(u => u.holdActive).length;
return msg;
