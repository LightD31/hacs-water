// === Émission des commandes, une par unité à changer ===
// Sortie 1 : un message par unité, cible portée par payload.target.entity_id
// (aucune entité en dur dans les nœuds de service).
//   service = 'start'    → set_hvac_mode puis set_temperature (chaînés)
//   service = 'setpoint' → set_temperature seul (modulation du routeur)
//   service = 'stop'     → turn_off
// Sortie 2 : le message de synthèse, vers le sensor et les alertes.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const SP_TOL = 0.2;
const now = msg.now;
const cmds = [];

for (const u of msg.units) {
    u.action = 'none';
    const K = ':' + u.id;
    if (u.desired === 'skip') continue;

    if (u.desired === 'on' && !u.on) {
        u.action = 'start';
        setF('lastOnAt' + K, now);
        setF('owned' + K, true);
        u.owned = true;
    } else if (u.desired === 'off' && u.on) {
        if (!u.owned) continue;              // le flow n'éteint que ce qu'il a allumé
        u.action = 'stop';
        setF('lastOffAt' + K, now);
        setF('owned' + K, false);
        setF('expectedSp' + K, null);
        u.owned = false;
    } else if (u.desired === 'on' && u.on && u.owned) {
        if (u.needMode !== 'none' && u.hvacMode !== u.needMode) {
            u.action = 'start';              // bascule de sens : mode + consigne
            u.desiredReason = (u.desiredReason || '') + ' · réalignement mode ' + u.needMode;
        } else if (u.targetSp != null
            && (u.spChanged || u.setpoint == null || Math.abs(u.setpoint - u.targetSp) > SP_TOL)) {
            u.action = 'setpoint';
        }
    }
    if (u.action === 'none') continue;

    setF('lastActionAt' + K, now);
    if (u.action === 'stop') {
        setF('expectedHvac' + K, 'off');
    } else {
        setF('expectedHvac' + K, u.needMode);
        setF('expectedSp' + K, u.targetSp);
        setF('spAt:' + u.id, now);
    }
    setF('lastActionReason' + K, u.desiredReason);
    cmds.push({
        service: u.action === 'stop' ? 'stop' : u.action === 'setpoint' ? 'setpoint' : 'start',
        unit: u.label,
        unitId: u.id,
        hvacModeCmd: u.needMode,
        tempCmd: u.targetSp,
        reason: u.label + ' → '
            + (u.action === 'stop' ? 'arrêt' : u.action === 'setpoint' ? 'consigne ' + u.targetSp + ' °C'
                : u.needMode + ' ' + u.targetSp + ' °C')
            + ' : ' + u.desiredReason,
        payload: { target: { entity_id: u.id } }
    });
}

msg.actions = msg.units.filter(u => u.action !== 'none')
    .map(u => ({ unit: u.label, action: u.action, setpoint: u.action === 'stop' ? null : u.targetSp }));
msg.actionCount = msg.actions.length;

// Historique global (affichage), hors simple modulation de consigne
const majors = msg.actions.filter(a => a.action !== 'setpoint');
if (majors.length > 0) {
    setF('lastActionAt', now);
    setF('lastActionSummary', majors.map(a => a.unit + ' ' + a.action).join(', '));
    setF('lastActionReason', msg.reason);
}
msg.lastActionAt = getF('lastActionAt');
msg.lastActionSummary = getF('lastActionSummary');
msg.lastActionReason = getF('lastActionReason');

return [cmds.length ? cmds : null, msg];
