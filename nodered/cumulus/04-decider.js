// === Décision : échelle de priorités, de haut en bas ===
//   1. Automatisation désactivée        → aucune commande
//   2. Pause manuelle (45 min)           → aucune commande
//   3. Interrupteur illisible            → aucune commande
//   4. Sonde du ballon HS                → stockage gratuit seulement
//   5. Anti-légionelle échue             → chauffe immédiate
//   6. Plans (minimum, légionelle, confort, stockage)
//                                         → chauffe si le surplus lissé atteint
//                                           le seuil d'un des plans
//   7. Anti court-cycle du relais        → état maintenu le temps du minimum
// Chaque étape est publiée dans decision_path, la carte affiche le chemin.

const STORE = 'file';
function getF(k) { try { return flow.get(k, STORE); } catch (e) { return flow.get(k); } }
function setF(k, v) { try { flow.set(k, v, STORE); } catch (e) { flow.set(k, v); } }

const now = msg.now;
const MANUAL_HOLD_MS = 45 * 60000;
const HA_LAG_GRACE_MS = 90 * 1000;
const MIN_ON_MS = 5 * 60000;
const MIN_OFF_MS = 3 * 60000;
const HYST_W = 150;               // tolérance à l'arrêt, sous le seuil

const path = [];
const step = (id, label, status, detail) => path.push({ id, label, status, detail: detail || null });
let decided = false;
const decide = (desired, state, reason, ruleId) => {
    msg.desired = desired;
    msg.state = state;
    msg.reason = reason;
    msg.rule = ruleId;
    decided = true;
};
const on = msg.switchState === 'on';

// --- Détection d'une commande manuelle ---
// Interrupteur changé hors du flow (HA, bouton physique) : pause 45 min.
// Ignorée tant que l'état est illisible (reboot HA).
let expected = getF('expectedSwitch');
if (expected == null && msg.switchAvailable) { expected = msg.switchState; setF('expectedSwitch', expected); }
const lastActionAt = getF('lastActionAt') || 0;
let holdUntil = getF('manualHoldUntil') || 0;
if (msg.switchAvailable && expected != null && msg.switchState !== expected
    && now - lastActionAt > HA_LAG_GRACE_MS) {
    holdUntil = now + MANUAL_HOLD_MS;
    setF('manualHoldUntil', holdUntil);
    setF('expectedSwitch', msg.switchState);
    node.warn('Commande manuelle détectée → pause automatisation 45 min');
}
msg.manualHoldActive = now < holdUntil;
msg.manualHoldUntil = msg.manualHoldActive ? holdUntil : null;
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

// 1. Automatisation
if (!msg.enabled) {
    step('enabled', 'Automatisation active', 'hit', 'désactivée');
    decide(msg.switchState, 'Désactivé', 'Automatisation désactivée, aucune commande envoyée', 'enabled');
} else step('enabled', 'Automatisation active', 'pass');

// 2. Pause manuelle
if (!decided) {
    if (msg.manualHoldActive) {
        step('manual', 'Pas de commande manuelle', 'hit', 'reprise à ' + hhmm(holdUntil));
        decide(msg.switchState, 'Pause (commande manuelle)',
            'Intervention manuelle détectée, reprise à ' + hhmm(holdUntil), 'manual');
    } else step('manual', 'Pas de commande manuelle', 'pass');
}

// 3. Interrupteur
if (!decided) {
    if (!msg.switchAvailable) {
        step('switch', 'Interrupteur joignable', 'hit', 'état illisible');
        decide(msg.switchState, 'Interrupteur injoignable',
            'État de l\'interrupteur illisible, aucune commande', 'switch');
    } else step('switch', 'Interrupteur joignable', 'pass');
}

// Comparaison d'un plan au surplus lissé, avec tolérance à l'arrêt
// Thermostat mécanique ouvert, relais fermé : la résistance absorbera le surplus
// dès que le thermostat refermera, sans rien coûter d'ici là. Son tirage
// nominal est compté pour ne pas faire battre le relais.
const virtual = on && msg.thermostatTripped ? msg.loadW : 0;
const surplusFor = (p) => (p.basis === 'own' ? msg.surplusAvgOwn : msg.surplusAvgClim) + virtual;
// Seuil nul : le plan chauffe sans condition de surplus, mais seulement quand
// le créneau courant est retenu (la nuit, le surplus mesuré est négatif).
// Chauffe engagée : seuil du créneau suivant du plan, moins une tolérance.
const thresholdUsed = (p) => (on
    ? Math.min(p.threshold, p.thresholdOn != null ? p.thresholdOn : p.threshold) - HYST_W
    : p.threshold);
const satisfied = (p) => {
    if (p.threshold <= 0) return p.nowPicked === true;
    return surplusFor(p) >= thresholdUsed(p);
};

// 4. Sonde HS : sans température, seul le stockage gratuit reste sûr
msg.degradedSonde = !msg.tempAvailable;
if (!decided) {
    if (msg.degradedSonde) {
        const st = msg.plans.find(p => p.id === 'storage');
        const ok = satisfied(st);
        step('sensor', 'Sonde du ballon', 'hit', 'HS depuis ' + msg.sondeDownHours + ' h');
        decide(ok ? 'on' : 'off', ok ? 'Chauffage (stockage, sonde HS)' : 'Veille (sonde HS)',
            ok ? 'Sonde HS, surplus quasi gratuit ' + msg.surplusAvgOwn + ' W ≥ ' + st.threshold + ' W'
                : 'Sonde HS, seul le surplus quasi gratuit est utilisé', 'sensor');
    } else step('sensor', 'Sonde du ballon', 'pass', msg.temp + ' °C');
}

// 5. Anti-légionelle échue
msg.legionellaCritical = msg.legionellaOverdue && msg.tempAvailable && msg.temp < 61;
msg.legionellaBlocked = msg.legionellaCritical && msg.thermostatTripped;
if (!decided) {
    if (msg.legionellaCritical) {
        step('legionella_overdue', 'Légionelle à jour', 'hit',
            msg.daysSinceHighTemp + ' j sans 60 °C');
        decide('on', 'Chauffage (anti-légionelle)',
            msg.daysSinceHighTemp + ' j sans 60 °C, échéance dépassée : chauffe immédiate', 'legionella_overdue');
    } else step('legionella_overdue', 'Légionelle à jour', 'pass',
        msg.legionellaDue ? 'cycle dû, planifié' : msg.daysSinceHighTemp + ' j');
}

// 6. Plans
msg.planEval = msg.plans.map(p => ({
    id: p.id, threshold: p.threshold, surplus: surplusFor(p), ok: satisfied(p)
}));
if (!decided) {
    const hit = msg.plans.find(p => satisfied(p));
    for (const p of msg.plans) {
        const s = surplusFor(p);
        const detail = s + ' / ' + (p.threshold > 0 ? thresholdUsed(p) + ' W' : 'immédiat');
        if (decided) { step('plan_' + p.id, p.label, 'skip', detail); continue; }
        if (p === hit) {
            step('plan_' + p.id, p.label, 'hit', detail);
            const why = p.threshold <= 0
                ? (p.id === 'floor' ? 'eau sous le minimum, chauffe immédiate'
                    : 'échéance proche, plus de meilleur créneau')
                : 'surplus ' + s + ' W ≥ seuil ' + thresholdUsed(p) + ' W'
                    + (on && thresholdUsed(p) < p.threshold ? ' (maintien)' : '');
            const states = {
                floor: 'Chauffage (minimum garanti)',
                legionella: 'Chauffage (anti-légionelle)',
                comfort: 'Chauffage (solaire)',
                storage: 'Chauffage (stockage gratuit)'
            };
            decide('on', states[p.id], p.label + ' : ' + why, 'plan_' + p.id);
        } else {
            step('plan_' + p.id, p.label, 'pass', detail);
        }
    }
    if (!decided) {
        // Rien à faire maintenant : expliquer ce qu'on attend
        const pending = msg.plans.filter(p => p.id !== 'storage');
        if (pending.length === 0) {
            const why = msg.solarCoversTarget
                ? 'Ballon solaire amont à ' + msg.solarTankTemp + ' °C, appoint inutile'
                : 'Eau à ' + msg.temp + ' °C, cible ' + msg.target + ' °C atteinte';
            decide('off', msg.solarCoversTarget ? 'Solaire amont suffisant' : 'Cible atteinte', why, 'idle');
        } else {
            const p = pending.slice().sort((a, b) => a.threshold - b.threshold)[0];
            const next = p.firstSlot && p.firstSlot > now ? ', prochain créneau ' + hhmm(p.firstSlot) : '';
            decide('off', 'Veille (attente soleil)',
                p.label + ' : surplus ' + surplusFor(p) + ' W < seuil ' + p.threshold + ' W' + next, 'wait');
        }
    }
}

// 7. Anti court-cycle du relais
msg.shortCycleHold = false;
if (msg.enabled && !msg.manualHoldActive && msg.switchAvailable && msg.desired !== msg.switchState
    && msg.rule !== 'legionella_overdue' && !(msg.rule === 'plan_floor' && msg.temp <= msg.minT)) {
    const lastAt = getF('lastActionAt') || 0;
    const minMs = on ? MIN_ON_MS : MIN_OFF_MS;
    if (now - lastAt < minMs) {
        const left = Math.ceil((minMs - (now - lastAt)) / 60000);
        step('short_cycle', 'Anti court-cycle', 'hit', left + ' min');
        msg.shortCycleHold = true;
        msg.reason = msg.reason + ' (appliqué dans ' + left + ' min, anti court-cycle)';
        msg.desired = msg.switchState;
    }
}

msg.decisionPath = path;
return msg;
