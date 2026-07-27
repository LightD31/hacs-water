#!/usr/bin/env node
/**
 * Contrôles d'intégrité du dépôt, exécutés en CI et avant publication.
 *
 * Chacun correspond à un défaut réellement rencontré : ils sont là pour qu'il
 * ne revienne pas silencieusement.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const ko = (m) => { console.log('  ✗ ' + m); failures++; };
const section = (m) => console.log('\n' + m);

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

// --- 1. Manifeste HACS ------------------------------------------------------
section('Manifeste HACS');
const hacs = readJson('hacs.json');
if (hacs.zip_release === true) ok('zip_release actif');
else ko('zip_release absent : HACS ne téléchargerait qu\'une seule carte');
if (typeof hacs.filename === 'string' && hacs.filename.endsWith('.zip')) {
    ok(`filename = ${hacs.filename}`);
} else {
    ko('filename doit être une archive .zip quand zip_release est actif');
}

// --- 2. Flows : intégrité du graphe ----------------------------------------
for (const file of ['flows.json', 'flows-clim.json']) {
    section(`Graphe ${file}`);
    const nodes = readJson(file);
    const ids = new Set();
    let dup = 0;
    for (const n of nodes) {
        if (ids.has(n.id)) dup++;
        ids.add(n.id);
    }
    dup === 0 ? ok('identifiants uniques') : ko(`${dup} identifiant(s) dupliqué(s)`);

    let dangling = 0;
    for (const n of nodes) {
        for (const ws of n.wires || []) {
            for (const w of ws) if (!ids.has(w)) dangling++;
        }
        if (n.g && !ids.has(n.g)) dangling++;
        if (n.type === 'group') for (const m of n.nodes || []) if (!ids.has(m)) dangling++;
    }
    dangling === 0 ? ok('wires et groupes résolus') : ko(`${dangling} référence(s) pendante(s)`);

    for (const n of nodes) {
        if ((n.type === 'server' || n.type === 'ha-entity-config') && n.z) {
            ko(`${n.type} ${n.id} porte un z, ce n'est pas un nœud d'onglet`);
        }
    }
}

// --- 3. Pas de collision d'identifiants entre les deux flows ----------------
// Défaut v1.14.1 : flows-clim.json redéfinissait le nœud serveur avec l'id de
// flows.json. À l'import, Node-RED renumérotait tout le flow et créait un
// second serveur sans jeton, invalidant sensor.clim_automation.
section('Cohabitation des deux flows');
const cumulusIds = new Set(readJson('flows.json').map((n) => n.id));
const climNodes = readJson('flows-clim.json');
const climIds = new Set(climNodes.map((n) => n.id));
const collisions = [...climIds].filter((id) => cumulusIds.has(id));
collisions.length === 0
    ? ok('aucun identifiant partagé, import sans conflit')
    : ko(`collision(s) : ${collisions.join(', ')} — Node-RED dupliquerait le nœud serveur`);

const externalServers = new Set(
    climNodes.filter((n) => n.server).map((n) => n.server));
const unresolved = [...externalServers].filter((s) => !climIds.has(s) && !cumulusIds.has(s));
unresolved.length === 0
    ? ok('références serveur résolues par flows.json')
    : ko(`serveur introuvable : ${unresolved.join(', ')}`);

// --- 4. Commandes clim à cible dynamique -----------------------------------
section('Nœuds de service du flow clim');
const hardcoded = climNodes.filter(
    (n) => n.type === 'api-call-service' && n.domain === 'climate'
        && Array.isArray(n.entityId) && n.entityId.length > 0);
hardcoded.length === 0
    ? ok('aucune entité en dur, cible portée par payload.target')
    : ko(`${hardcoded.length} nœud(s) climate avec entité en dur`);

// --- 5. Cartes : syntaxe et enregistrement ---------------------------------
section('Cartes Lovelace');
for (const card of fs.readdirSync(root).filter((f) => f.endsWith('-card.js'))) {
    const src = fs.readFileSync(path.join(root, card), 'utf8');
    try {
        new Function(src);
        ok(`${card} : syntaxe`);
    } catch (e) {
        ko(`${card} : ${e.message}`);
    }
    if (src.includes('customElements.define')) ok(`${card} : élément enregistré`);
    else ko(`${card} : aucun customElements.define`);
    if (src.includes('window.customCards')) ok(`${card} : déclarée dans le sélecteur`);
    else ko(`${card} : absente de window.customCards`);
}

// --- 6. L'archive livre bien toutes les cartes -----------------------------
section('Contenu de l\'archive HACS');
const cards = fs.readdirSync(root).filter((f) => f.endsWith('-card.js')).sort();
const script = fs.readFileSync(path.join(root, 'tools/build-hacs-zip.sh'), 'utf8');
const missing = cards.filter((c) => !script.includes(c));
missing.length === 0
    ? ok(`${cards.length} carte(s) archivée(s) : ${cards.join(', ')}`)
    : ko(`carte(s) absente(s) du script d'archive : ${missing.join(', ')}`);

console.log('\n' + (failures ? `${failures} contrôle(s) en échec` : 'tous les contrôles passent'));
process.exit(failures ? 1 : 0);
