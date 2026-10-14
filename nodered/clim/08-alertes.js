// === Alertes HA (persistent_notification) ===
// Une notification par épisode, anti-spam par contexte persistant.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const out = [];
const now = msg.now;

// 1. Plus aucune température de pièce depuis ≥ 2 h
if ((msg.noTempHours || 0) >= 2) {
    if (!getF('notifNoTemp')) {
        setF('notifNoTemp', true);
        out.push({ payload: {
            notification_id: 'clim_sondes_hs',
            title: 'Clim : plus aucune température de pièce',
            message: 'Aucune unité ne remonte de current_temperature depuis ' + msg.noTempHours
                + ' h. Confort gratuit suspendu (pas de pilotage à l\'aveugle).'
        }});
    }
} else if (msg.anyTempAvailable) {
    setF('notifNoTemp', false);
}

// 2. Unités injoignables depuis ≥ 1 h
const down = (msg.units || []).filter(u => u.available === false && u.breakerOn !== false);
if (down.length > 0) {
    let since = getF('unitsDownSince');
    if (!since) { since = now; setF('unitsDownSince', now); }
    if (now - since > 3600 * 1000) {
        const key = down.map(u => u.id).sort().join(',');
        if (getF('notifUnitsDownKey') !== key) {
            setF('notifUnitsDownKey', key);
            out.push({ payload: {
                notification_id: 'clim_unites_injoignables',
                title: 'Clim : unité(s) injoignable(s)',
                message: down.map(u => u.label).join(', ')
                    + ' indisponible(s) depuis plus d\'une heure, aucune commande envoyée.'
            }});
        }
    }
} else {
    setF('unitsDownSince', null);
    setF('notifUnitsDownKey', null);
}

// 3. Unité en demande mais mode absent de ses hvac_modes (erreur de config)
const unsupported = (msg.units || []).filter(u => u.modeSupported === false);
if (unsupported.length > 0) {
    const key = unsupported.map(u => u.id).sort().join(',');
    if (getF('notifUnsupportedKey') !== key) {
        setF('notifUnsupportedKey', key);
        out.push({ payload: {
            notification_id: 'clim_mode_non_supporte',
            title: 'Clim : mode non exposé par une unité',
            message: unsupported.map(u => u.label + ' (' + u.modes.join(', ') + ')').join(' · ')
                + '. Aucune commande envoyée à ces unités.'
        }});
    }
} else {
    setF('notifUnsupportedKey', null);
}

// 4. Disjoncteur ouvert alors que des pièces de ce groupe auraient du surplus
//    à exploiter. Le besoin des pièces n'est pas testable (entités injoignables
//    disjoncteur coupé) : le signal utile est l'export perdu.
const cutGroups = (msg.groups || []).filter(gr => gr.breakerKnown && !gr.breakerOn);
if (cutGroups.length > 0 && msg.enabled && msg.exportAvg > 500) {
    const key = cutGroups.map(gr => gr.name).sort().join(',');
    if (getF('notifBreakerKey') !== key) {
        setF('notifBreakerKey', key);
        out.push({ payload: {
            notification_id: 'clim_disjoncteur_coupe',
            title: 'Clim : disjoncteur coupé, confort gratuit indisponible',
            message: 'Disjoncteur ' + key + ' hors tension alors que ' + msg.exportAvg
                + ' W partent au réseau. Pièces de ce groupe hors du confort gratuit.'
        }});
    }
} else {
    setF('notifBreakerKey', null);
}

if (out.length === 0) return null;
return [out];
