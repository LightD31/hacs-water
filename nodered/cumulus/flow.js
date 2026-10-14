// Spécification du flow « Cumulus Solaire » → flows.json
// Les identifiants de l'onglet, du serveur et de la config du sensor sont
// conservés d'une version à l'autre : le sensor HA reste le même.
const TAB_ID = 'ea320b91f27070db';

const ENV = [
    ['CUMULUS_LOAD_W', '1200', 'num'],
    ['CUMULUS_SWITCH', 'switch.chauffe_eau_electrique', 'str'],
    ['CUMULUS_POWER', 'sensor.chauffe_eau_electrique_power', 'str'],
    ['WATER_TEMP_SENSOR', 'sensor.temp_chauffe_eau_electrique_temperature', 'str'],
    ['SOLAR_TANK_SENSOR', 'sensor.temp_chauffe_eau_solaire_temperature', 'str'],
    ['SOLAR_SUFFICIENT_MARGIN', '3', 'num'],
    ['SOLAR_SENSOR', 'sensor.pince_amperemetrique_power_a', 'str'],
    ['GRID_SENSOR', 'sensor.pince_amperemetrique_power_b', 'str'],
    ['HOUSE_SENSOR', 'sensor.pince_amperemetrique_power_ab', 'str'],
    ['CLIM_SENSOR', 'sensor.clim_automation', 'str'],
];

const INFO = `# Cumulus solaire — planification au surplus

Contrat Base, export non rémunéré : le bon moment pour chauffer est celui où
le surplus attendu est le plus grand. Chaque besoin (minimum garanti, cible,
anti-légionelle) est réparti sur les meilleurs créneaux Solcast avant son
échéance ; le surplus du dernier créneau retenu devient le seuil de chauffe.

Appris en continu : consommation de fond heure par heure, biais Solcast,
refroidissement du ballon, rendement de chauffe.

Sources : nodered/cumulus/ du dépôt hacs-water, flows.json généré.`;

function spec(h) {
    const G = { trig: 'c4a0000000000a01', pipe: 'c4a0000000000a02', out: 'c4a0000000000a03' };
    const P = (n) => 'c4a00000000000' + String(n).padStart(2, '0');
    const RATE = P(10);

    const triggers = [
        h.trigger(P(1), 'Solaire change', 'sensor.pince_amperemetrique_power_a', 160, 160, G.trig, [RATE]),
        h.trigger(P(2), 'Réseau change', 'sensor.pince_amperemetrique_power_b', 160, 220, G.trig, [RATE]),
        h.trigger(P(3), 'Temp eau change', 'sensor.temp_chauffe_eau_electrique_temperature', 160, 280, G.trig, [RATE]),
        h.trigger(P(4), 'Temp solaire change', 'sensor.temp_chauffe_eau_solaire_temperature', 160, 340, G.trig, [RATE]),
        h.trigger(P(5), 'Interrupteur change', 'switch.chauffe_eau_electrique', 160, 400, G.trig, [RATE]),
        h.trigger(P(6), 'Toggle auto change', 'input_boolean.cumulus_automation_enabled', 160, 460, G.trig, [RATE]),
        h.inject(P(7), 'Tick 1 min', 60, 5, 160, 520, G.trig, [RATE]),
    ];
    const rate = h.rate(RATE, 'Anti-rafale (1 msg / 10 s)', 420, 340, null, [P(11)]);

    const pipe = [
        h.fn(P(11), 'Lire capteurs', '01-lire-capteurs.js', 620, 340, G.pipe, [[P(12)]]),
        h.fn(P(12), 'Apprentissage', '02-apprentissage.js', 820, 340, G.pipe, [[P(13)]]),
        h.fn(P(13), 'Planifier', '03-planifier.js', 1000, 340, G.pipe, [[P(14)]]),
        h.fn(P(14), 'Décider', '04-decider.js', 1170, 340, G.pipe, [[P(15)]]),
        h.fn(P(15), 'Action & historique', '05-action.js', 1360, 340, G.pipe, [[P(20)], [P(30), P(40)]]),
    ];

    const out = [
        h.switchNode(P(20), 'ON ou OFF', 'action',
            [{ t: 'eq', v: 'turn_on', vt: 'str' }, { t: 'eq', v: 'turn_off', vt: 'str' }],
            1600, 240, G.out, [[P(21), P(23)], [P(22), P(23)]], ['turn_on', 'turn_off']),
        h.action(P(21), 'switch.turn_on', 'switch.turn_on', '', 1820, 200, G.out),
        h.action(P(22), 'switch.turn_off', 'switch.turn_off', '', 1820, 260, G.out),
        h.debug(P(23), 'Log action', 1820, 320, G.out),
        h.fn(P(30), 'Build sensor payload', '06-sensor.js', 1610, 400, G.out, [[P(31)]]),
        h.sensor(P(31), 'sensor.cumulus_automation', 'ha_sensor', 1850, 400, G.out),
        h.fn(P(40), 'Alertes ?', '07-alertes.js', 1590, 460, G.out, [[P(41)]]),
        h.action(P(41), 'Notification HA', 'persistent_notification.create',
            '{"title": payload.title, "message": payload.message, "notification_id": payload.notification_id}',
            1840, 480, G.out),
    ];
    const errs = [
        h.catchNode(P(50), 'Erreurs du flow', 1400, 560, [P(51)]),
        h.fn(P(51), 'Gestion erreur', '08-erreur.js', 1600, 560, null, [[P(41)]]),
    ];
    const comments = [
        h.comment(P(60), '📡 Déclencheurs', 'Réévaluation complète à chaque événement, et chaque minute.', 140, 80),
        h.comment(P(61), '🔍 Lecture → apprentissage → plan → décision',
            'Toute la décision vit dans les nœuds function, rejoués tels quels par tests/cumulus-flow-sim.js.', 760, 80),
        h.comment(P(62), '🎯 Action & Sensor', 'Commande de l\'interrupteur, sensor.cumulus_automation, notifications.', 1640, 80),
    ];

    return [
        {
            id: TAB_ID, type: 'tab', label: 'Cumulus Solaire', disabled: false, info: INFO,
            env: ENV.map(([name, value, type]) => ({ name, value, type })),
        },
        h.group(G.trig, '📡 Triggers', '#eaf6ff', '#1f4e79', triggers),
        h.group(G.pipe, '🔍 Lecture, apprentissage & plan', '#fff8e1', '#7f4f00', pipe),
        h.group(G.out, '🎯 Action & Sensor', '#fce4ec', '#880e4f', out),
        ...comments, ...triggers, rate, ...pipe, ...out, ...errs,
        {
            id: h.SERVER, type: 'server', name: 'Home Assistant', addon: true,
            rejectUnauthorizedCerts: true, ha_boolean: [], connectionDelay: false,
            cacheJson: false, heartbeat: false, heartbeatInterval: '', statusSeparator: '',
            enableGlobalContextStore: false,
        },
        h.sensorConfig('ha_sensor', 'Cumulus Automation', 'mdi:water-boiler-auto'),
        {
            id: '91060ee51c11077f', type: 'global-config', env: [],
            modules: { 'node-red-contrib-home-assistant-websocket': '0.80.3' },
        },
    ];
}

module.exports = spec;
module.exports.TAB_ID = TAB_ID;
