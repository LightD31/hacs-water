// === Alertes HA (persistent_notification) ===
// Une notification par épisode, anti-spam via contexte persistant.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const out = [];
const now = msg.now;
const DAY_MS = 24 * 3600 * 1000;

// 1. Sonde HS depuis ≥ 2 h
if ((msg.sondeDownHours || 0) >= 2) {
    if (!getF('notifSondeDown')) {
        setF('notifSondeDown', true);
        out.push({ payload: {
            notification_id: 'cumulus_sonde_hs',
            title: 'Cumulus : sonde température HS',
            message: 'Sonde indisponible depuis ' + msg.sondeDownHours
                + ' h. Seul le surplus quasi gratuit chauffe l\'eau, aucun minimum garanti.'
        }});
    }
} else if (msg.tempAvailable) {
    setF('notifSondeDown', false);
}

// 2. Cycle anti-légionelle forcé malgré un thermostat mécanique ouvert
if (msg.legionellaBlocked) {
    const last = getF('notifLegioBlockedAt') || 0;
    if (now - last > DAY_MS) {
        setF('notifLegioBlockedAt', now);
        out.push({ payload: {
            notification_id: 'cumulus_legio_blocked',
            title: 'Cumulus : anti-légionelle bloquée par le thermostat',
            message: msg.daysSinceHighTemp + ' j sans 60 °C. Relais fermé mais le thermostat '
                + 'mécanique coupe avant 60 °C (eau à ' + msg.temp + ' °C). Réglage du '
                + 'thermostat à vérifier.'
        }});
    }
}

// 3. Prévision Solcast inexploitable depuis ≥ 12 h : le plan tourne en repli
if (msg.solcastStale && (msg.solcastAgeHours == null || msg.solcastAgeHours >= 12)) {
    const last = getF('notifSolcastAt') || 0;
    if (now - last > DAY_MS) {
        setF('notifSolcastAt', now);
        out.push({ payload: {
            notification_id: 'cumulus_solcast',
            title: 'Cumulus : prévision Solcast inexploitable',
            message: 'Aucune prévision récente ('
                + (msg.solcastAgeHours == null ? 'absente' : msg.solcastAgeHours + ' h')
                + '). Planification en repli : chauffe dès 50 % de part solaire.'
        }});
    }
}

if (out.length === 0) return null;
return [out];
