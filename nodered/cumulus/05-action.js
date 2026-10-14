// === Action et historique ===
// action = turn_on / turn_off / none. Aucune commande vers un interrupteur
// illisible : elle échouerait et fausserait l'historique.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const now = msg.now;
msg.action = 'none';
if (msg.switchAvailable && msg.desired !== msg.switchState) {
    msg.action = msg.desired === 'on' ? 'turn_on' : 'turn_off';
    setF('lastActionAt', now);
    setF('lastAction', msg.action);
    setF('lastActionReason', msg.reason);
    setF('expectedSwitch', msg.desired);
}
msg.lastActionAt = getF('lastActionAt');
msg.lastAction = getF('lastAction');
msg.lastActionReason = getF('lastActionReason');

// Sortie 1 : commande de l'interrupteur, cible portée par le message (entité
// de l'onglet Env, aucune entité en dur dans les nœuds de service).
// Sortie 2 : synthèse, vers le sensor et les alertes.
const cmd = msg.action === 'none' ? null : {
    action: msg.action,
    reason: msg.reason,
    payload: { target: { entity_id: msg.switchId } }
};
return [cmd, msg];
