#!/usr/bin/env node
/**
 * Génère les deux flows Node-RED importables à partir de leurs sources.
 *
 *   nodered/cumulus/flow.js   →  flows.json
 *   nodered/clim/flow.js      →  flows-clim.json
 *
 * Le corps de chaque nœud `function` vit dans son propre fichier .js
 * (nodered/<flow>/NN-nom.js) : lisible, diffable, et exécuté tel quel par les
 * simulations de tests/. Le JSON livré n'est qu'un produit de génération.
 *
 * Usage :
 *   node tools/build-flows.js           écrit les deux flows
 *   node tools/build-flows.js --check   vérifie qu'ils sont à jour
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SERVER = '1a7a75b5.c29f2a';

/** Aides de construction passées aux specs. */
function helpers(dir, tabId) {
    const src = (file) => fs.readFileSync(path.join(dir, file), 'utf8').trimEnd() + '\n';
    const base = (id, type, name, x, y, g) => {
        const n = { id, type, z: tabId };
        if (g) n.g = g;
        n.name = name;
        return Object.assign(n, { x, y });
    };
    return {
        SERVER,
        src,
        trigger: (id, name, entity, x, y, g, wires) => Object.assign(base(id, 'server-state-changed', name, x, y, g), {
            server: SERVER, version: 6, outputs: 1, exposeAsEntityConfig: '',
            entities: { entity: [entity], substring: [], regex: [] },
            outputInitially: false, stateType: 'str', ifState: '', ifStateType: 'str',
            outputOnlyOnStateChange: true, for: '0', forType: 'num', forUnits: 'seconds',
            ignorePrevStateNull: false, ignorePrevStateUnknown: false,
            ignorePrevStateUnavailable: false, ignoreCurrentStateUnknown: false,
            ignoreCurrentStateUnavailable: false, outputProperties: [], wires: [wires],
        }),
        inject: (id, name, repeat, onceDelay, x, y, g, wires, topic) => Object.assign(base(id, 'inject', name, x, y, g), {
            props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }], repeat: String(repeat), crontab: '',
            once: true, onceDelay: String(onceDelay), topic: topic || '', payload: '',
            payloadType: 'date', wires: [wires],
        }),
        rate: (id, name, x, y, g, wires) => Object.assign(base(id, 'delay', name, x, y, g), {
            pauseType: 'rate', timeout: '5', timeoutUnits: 'seconds', rate: '1',
            nbRateUnits: '10', rateUnits: 'second', randomFirst: '1', randomLast: '5',
            randomUnits: 'seconds', drop: true, allowrate: false, outputs: 1, wires: [wires],
        }),
        fn: (id, name, file, x, y, g, wires) => Object.assign(base(id, 'function', name, x, y, g), {
            func: src(file), outputs: wires.length, timeout: 0, noerr: 0,
            initialize: '', finalize: '', libs: [], wires,
        }),
        switchNode: (id, name, property, rules, x, y, g, wires, labels) => Object.assign(base(id, 'switch', name, x, y, g), {
            property, propertyType: 'msg', rules, checkall: 'false', repair: false,
            outputs: rules.length, wires, outputLabels: labels,
        }),
        action: (id, name, action, data, x, y, g, wires, extra) => Object.assign(base(id, 'api-call-service', name, x, y, g), {
            server: SERVER, version: 7, debugenabled: false, action,
            floorId: [], areaId: [], deviceId: [], entityId: [], labelId: [],
            data: data || '', dataType: 'jsonata', mergeContext: '', mustacheAltTags: false,
            outputProperties: [], queue: 'none', blockInputOverrides: false,
            domain: action.split('.')[0], service: action.split('.')[1],
            wires: [wires || []],
        }, extra || {}),
        debug: (id, name, x, y, g) => Object.assign(base(id, 'debug', name, x, y, g), {
            active: true, tosidebar: true, console: false, tostatus: true,
            complete: 'reason', targetType: 'msg', statusVal: 'reason', statusType: 'msg', wires: [],
        }),
        sensor: (id, name, configId, x, y, g) => Object.assign(base(id, 'ha-sensor', name, x, y, g), {
            entityConfig: configId, version: 0, state: 'payload.state', stateType: 'msg',
            attributes: [{ property: 'attributes', value: 'payload.attributes', valueType: 'msg' }],
            inputOverride: 'allow', outputProperties: [], wires: [[]],
        }),
        sensorConfig: (id, entityName, icon) => ({
            id, type: 'ha-entity-config', server: SERVER, deviceConfig: '',
            name: 'sensor config for sensor.' + entityName.toLowerCase().replace(/ /g, '_'),
            version: 6, entityType: 'sensor',
            haConfig: [
                { property: 'name', value: entityName }, { property: 'icon', value: icon },
                { property: 'entity_picture', value: '' }, { property: 'entity_category', value: '' },
                { property: 'device_class', value: '' }, { property: 'unit_of_measurement', value: '' },
                { property: 'state_class', value: '' },
            ],
            resend: true, debugEnabled: false,
        }),
        catchNode: (id, name, x, y, wires) => Object.assign(base(id, 'catch', name, x, y), {
            scope: null, uncaught: false, wires: [wires],
        }),
        comment: (id, name, info, x, y) => Object.assign(base(id, 'comment', name, x, y), { info, wires: [] }),
        group: (id, name, fill, color, nodes) => {
            // Boîte englobante calculée à partir des nœuds membres
            const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
            const x0 = Math.min(...xs) - 120, y0 = Math.min(...ys) - 40;
            return {
                id, type: 'group', z: tabId, name,
                style: { label: true, fill, color },
                nodes: nodes.map(n => n.id),
                x: x0, y: y0,
                w: Math.max(...xs) - x0 + 120, h: Math.max(...ys) - y0 + 40,
            };
        },
    };
}

const FLOWS = [
    { dir: 'nodered/cumulus', out: 'flows.json' },
    { dir: 'nodered/clim', out: 'flows-clim.json' },
];

let stale = 0;
for (const f of FLOWS) {
    const dir = path.join(root, f.dir);
    const spec = require(path.join(dir, 'flow.js'));
    const nodes = spec(helpers(dir, spec.TAB_ID));
    const json = JSON.stringify(nodes, null, 4) + '\n';
    const target = path.join(root, f.out);
    if (process.argv.includes('--check')) {
        const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
        if (current !== json) {
            console.error(`${f.out} n'est pas à jour avec ${f.dir}/`);
            stale++;
        } else {
            console.log(`${f.out} à jour (${nodes.length} nœuds)`);
        }
    } else {
        fs.writeFileSync(target, json);
        console.log(`${f.out} écrit (${nodes.length} nœuds)`);
    }
}
if (stale) {
    console.error('Régénérer avec : node tools/build-flows.js');
    process.exit(1);
}
