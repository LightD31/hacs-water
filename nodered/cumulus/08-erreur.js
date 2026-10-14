// === Gestion des erreurs du flow (nœud catch) ===

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const src = (msg.error && msg.error.source) || {};
// Nœuds de commande de l'interrupteur, repérés par leur nom : un identifiant
// en dur ne survit pas à un réimport avec renumérotation.
const SWITCH_NODES = ['switch.turn_on', 'switch.turn_off'];

// Commande échouée : l'historique optimiste est faux → purge, sinon la période
// de grâce et la détection manuelle dérivent.
if (SWITCH_NODES.indexOf(src.name) !== -1) {
    setF('lastAction', null);
    setF('lastActionAt', 0);
    setF('expectedSwitch', null);
}

// Anti-spam : 1 notification max / 15 min
const now = Date.now();
const last = getF('lastErrorNotifAt') || 0;
if (now - last < 15 * 60 * 1000) return null;
setF('lastErrorNotifAt', now);

msg.payload = {
    notification_id: 'cumulus_flow_error',
    title: 'Cumulus : erreur dans le flow',
    message: (src.name || src.id || '?') + ' : '
        + (msg.error && msg.error.message ? msg.error.message : 'erreur inconnue')
};
return msg;
