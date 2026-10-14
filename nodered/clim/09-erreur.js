// === Gestion des erreurs du flow (nœud catch) ===

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const src = (msg.error && msg.error.source) || {};
// Nœuds de commande repérés par leur nom : un identifiant en dur ne survit pas
// à un réimport avec renumérotation.
const SERVICE_NODES = ['climate.set_hvac_mode', 'climate.set_temperature', 'climate.turn_off'];

// Commande échouée : l'historique optimiste est faux pour CETTE unité → purge,
// sinon l'anti court-cycle et la détection de pilotage manuel dérivent.
const failedId = msg.payload?.target?.entity_id || msg.unitId;
if (SERVICE_NODES.indexOf(src.name) !== -1 && failedId) {
    const K = ':' + failedId;
    setF('lastActionAt' + K, 0);
    setF('expectedHvac' + K, null);
    setF('expectedSp' + K, null);
    setF('owned' + K, false);
    node.warn('Commande clim échouée sur ' + failedId + ', état du flow purgé');
}

const now = Date.now();
const last = getF('lastErrorNotifAt') || 0;
if (now - last < 15 * 60 * 1000) return null;
setF('lastErrorNotifAt', now);

msg.payload = {
    notification_id: 'clim_flow_error',
    title: 'Clim : erreur dans le flow',
    message: (src.name || src.id || '?') + ' : '
        + (msg.error && msg.error.message ? msg.error.message : 'erreur inconnue')
        + (failedId ? ' (' + failedId + ')' : '')
};
return msg;
