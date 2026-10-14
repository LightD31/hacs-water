// Spécification du flow « Climatisation Solaire » → flows-clim.json
// Identifiants de l'onglet et de la config du sensor conservés : le sensor HA
// reste le même. Aucun nœud serveur ici : celui de flows.json est partagé.
const TAB_ID = 'c0f10000000000ab';

const ENV = [
    ['CLIM_UNITS', 'climate.salon_room_temperature,climate.daikinap21104_room_temperature,climate.chambre_tom_room_temperature,climate.chambre_didier_room_temperature,climate.chambre_marie_room_temperature', 'str'],
    ['CLIM_UNIT_LABELS', 'Salon,Cuisine,Chambre Tom,Chambre Didier,Chambre Marie', 'str'],
    ['CLIM_PRIORITY_HELPER', 'input_text.clim_priority_order', 'str'],
    ['CLIM_OUTDOOR_SENSOR', 'sensor.exterieur_temperature', 'str'],
    ['CLIM_WEATHER_ENTITY', 'weather.forecast_maison', 'str'],
    ['CLIM_GROUPS', JSON.stringify([
        { name: 'Clim Nord', switch: 'switch.clim_nord', power: 'sensor.clim_nord_power',
            units: ['climate.salon_room_temperature', 'climate.daikinap21104_room_temperature'] },
        { name: 'Clim Sud', switch: 'switch.clim_sud', power: 'sensor.clim_sud_power',
            units: ['climate.chambre_tom_room_temperature', 'climate.chambre_didier_room_temperature',
                'climate.chambre_marie_room_temperature'] },
    ]), 'json'],
    ['CLIM_GROUP_STANDBY_W', '5', 'num'],
    ['CUMULUS_SENSOR', 'sensor.cumulus_automation', 'str'],
    ['SOLAR_SENSOR', 'sensor.pince_amperemetrique_power_a', 'str'],
    ['GRID_SENSOR', 'sensor.pince_amperemetrique_power_b', 'str'],
    ['CLIM_UNIT_W', '500', 'num'],
    ['CLIM_EXPORT_MARGIN_W', '50', 'num'],
    ['CLIM_MAX_UNITS', '5', 'num'],
    ['CLIM_MIN_RUN_MIN', '20', 'num'],
    ['CLIM_MIN_OFF_MIN', '15', 'num'],
    ['CLIM_CONFIRM_MIN', '3', 'num'],
    ['CLIM_STORE_BAND', '1.5', 'num'],
    ['CLIM_COOL_FLOOR', '21', 'num'],
    ['CLIM_HEAT_CEILING', '23', 'num'],
    ['CLIM_OUTDOOR_COOL_MIN', '24', 'num'],
    ['CLIM_OUTDOOR_HEAT_MAX', '17', 'num'],
];

const INFO = `# Climatisation et chauffage gratuits — routeur solaire

Les unités inverter sont modulées par leur consigne pour suivre le surplus,
comme un routeur solaire module une résistance : consigne plus profonde quand
le compteur exporte, relâchée vers le ralenti quand il importe, démarrage ou
arrêt d'une unité seulement aux extrémités.

L'eau chaude passe avant : le flow cumulus compte la consommation que la clim
rendrait (recoverable_w) et démarre quand il veut ; la boucle relâche les
consignes dans la minute.

Puissance de chaque unité apprise sur les compteurs des disjoncteurs.
Saison décidée sur la prévision du jour (weather.get_forecasts).

Sources : nodered/clim/ du dépôt hacs-water, flows-clim.json généré.`;

const UNIT_TRIGGERS = [
    ['Salon change', 'climate.salon_room_temperature'],
    ['Cuisine change', 'climate.daikinap21104_room_temperature'],
    ['Chambre Tom change', 'climate.chambre_tom_room_temperature'],
    ['Chambre Didier change', 'climate.chambre_didier_room_temperature'],
    ['Chambre Marie change', 'climate.chambre_marie_room_temperature'],
];

function spec(h) {
    const G = { trig: 'c1f2000000000a01', pipe: 'c1f2000000000a02', out: 'c1f2000000000a03', fc: 'c1f2000000000a04' };
    const P = (n) => 'c1f20000000000' + String(n).padStart(2, '0');
    const RATE = P(20);

    const triggers = [
        h.trigger(P(1), 'Solaire change', 'sensor.pince_amperemetrique_power_a', 170, 160, G.trig, [RATE]),
        h.trigger(P(2), 'Réseau change', 'sensor.pince_amperemetrique_power_b', 170, 210, G.trig, [RATE]),
        h.trigger(P(3), 'Toggle auto change', 'input_boolean.clim_automation_enabled', 170, 260, G.trig, [RATE]),
        h.trigger(P(4), 'Cumulus change', 'sensor.cumulus_automation', 170, 310, G.trig, [RATE]),
        h.trigger(P(5), 'Disj. Nord change', 'switch.clim_nord', 170, 360, G.trig, [RATE]),
        h.trigger(P(6), 'Disj. Sud change', 'switch.clim_sud', 170, 410, G.trig, [RATE]),
        h.trigger(P(7), 'Ordre priorité change', 'input_text.clim_priority_order', 170, 460, G.trig, [RATE]),
        ...UNIT_TRIGGERS.map(([name, id], i) => h.trigger(P(8 + i), name, id, 170, 510 + i * 50, G.trig, [RATE])),
        h.inject(P(15), 'Tick 1 min', 60, 8, 170, 760, G.trig, [RATE]),
    ];
    const rate = h.rate(RATE, 'Anti-rafale (1 msg / 10 s)', 420, 460, null, [P(21)]);

    const pipe = [
        h.fn(P(21), 'Lire capteurs & unités', '01-lire-capteurs.js', 640, 460, G.pipe, [[P(22)]]),
        h.fn(P(22), 'Détect. pilotage manuel', '02-manuel.js', 860, 460, G.pipe, [[P(23)]]),
        h.fn(P(23), 'Bilan & apprentissage', '03-bilan.js', 1060, 460, G.pipe, [[P(24)]]),
        h.fn(P(24), 'Besoin confort par pièce', '04-confort.js', 1260, 460, G.pipe, [[P(25)]]),
        h.fn(P(25), 'Routeur solaire', '05-routeur.js', 1450, 460, G.pipe, [[P(26)]]),
        h.fn(P(26), 'Émettre les commandes', '06-commandes.js', 1640, 460, G.pipe,
            [[P(30)], [P(40), P(42)]]),
    ];

    const out = [
        h.switchNode(P(30), 'Démarrage / consigne / arrêt', 'service',
            [{ t: 'eq', v: 'start', vt: 'str' }, { t: 'eq', v: 'setpoint', vt: 'str' }, { t: 'eq', v: 'stop', vt: 'str' }],
            1900, 340, G.out, [[P(31), P(34)], [P(32), P(34)], [P(33), P(34)]], ['start', 'setpoint', 'stop']),
        h.action(P(31), 'climate.set_hvac_mode', 'climate.set_hvac_mode', '{"hvac_mode": hvacModeCmd}',
            2150, 300, G.out, [P(32)]),
        h.action(P(32), 'climate.set_temperature', 'climate.set_temperature', '{"temperature": tempCmd}',
            2400, 340, G.out),
        h.action(P(33), 'climate.turn_off', 'climate.turn_off', '', 2150, 400, G.out),
        h.debug(P(34), 'Log commande', 2150, 460, G.out),
        h.fn(P(40), 'Build sensor payload', '07-sensor.js', 1910, 540, G.out, [[P(41)]]),
        h.sensor(P(41), 'sensor.clim_automation', 'ha_sensor_clim', 2160, 540, G.out),
        h.fn(P(42), 'Alertes ?', '08-alertes.js', 1890, 600, G.out, [[P(43)]]),
        h.action(P(43), 'Notification HA', 'persistent_notification.create',
            '{"title": payload.title, "message": payload.message, "notification_id": payload.notification_id}',
            2160, 620, G.out),
    ];

    const forecast = [
        h.inject(P(50), 'Toutes les heures', 3600, 15, 170, 880, G.fc, [P(51)]),
        h.fn(P(51), 'Demande prévision', '10-prevision-demande.js', 400, 880, G.fc, [[P(52)]]),
        h.action(P(52), 'weather.get_forecasts', 'weather.get_forecasts', '', 640, 880, G.fc, [P(53)], {
            outputProperties: [{ property: 'payload', propertyType: 'msg', value: '', valueType: 'results' }],
        }),
        h.fn(P(53), 'Mémoriser prévision', '11-prevision.js', 880, 880, G.fc, [[]]),
    ];

    const errs = [
        h.catchNode(P(60), 'Erreurs du flow', 1700, 700, [P(61)]),
        h.fn(P(61), 'Gestion erreur', '09-erreur.js', 1900, 700, null, [[P(43)]]),
    ];
    const comments = [
        h.comment(P(70), '📡 Déclencheurs', 'Réévaluation à chaque événement, et chaque minute.', 150, 80),
        h.comment(P(71), '🔍 Lecture → manuel → bilan → confort → routeur',
            'Toute la décision vit dans les nœuds function, rejoués tels quels par tests/clim-flow-sim.js.', 1000, 80),
        h.comment(P(72), '🎯 Actions & Sensor', 'Une commande par unité, cible portée par payload.target.', 1950, 80),
        h.comment(P(73), '🌤️ Prévision', 'Extrêmes du jour et de demain, pour la saison en mode auto.', 170, 830),
    ];

    return [
        {
            id: TAB_ID, type: 'tab', label: 'Climatisation Solaire', disabled: false, info: INFO,
            env: ENV.map(([name, value, type]) => ({ name, value, type })),
        },
        h.group(G.trig, '📡 Triggers', '#eaf6ff', '#1f4e79', triggers),
        h.group(G.pipe, '🔍 Lecture, bilan & routeur', '#fff8e1', '#7f4f00', pipe),
        h.group(G.out, '🎯 Actions & Sensor', '#fce4ec', '#880e4f', out),
        h.group(G.fc, '🌤️ Prévision météo', '#e8f5e9', '#1b5e20', forecast),
        ...comments, ...triggers, rate, ...pipe, ...out, ...forecast, ...errs,
        h.sensorConfig('ha_sensor_clim', 'Clim Automation', 'mdi:air-conditioner'),
    ];
}

module.exports = spec;
module.exports.TAB_ID = TAB_ID;
