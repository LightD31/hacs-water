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
// HACS ne télécharge qu'un fichier par dépôt ET déclare automatiquement une
// ressource Lovelace pointant dessus. Le fichier désigné doit donc être un vrai
// module JavaScript : une archive y était enregistrée telle quelle et cassait
// les deux cartes (v1.17.0).
section('Manifeste HACS');
const hacs = readJson('hacs.json');
if (hacs.zip_release) {
    ko('zip_release actif : HACS déclarerait l\'archive comme ressource Lovelace');
} else {
    ok('pas de zip_release');
}
if (typeof hacs.filename === 'string' && hacs.filename.endsWith('.js')) {
    ok(`filename = ${hacs.filename}`);
} else {
    ko('filename doit désigner un fichier .js, il devient l\'URL de la ressource');
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
const cards = fs.readdirSync(root).filter((f) => f.endsWith('-card.js')).sort();
for (const card of cards) {
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

// --- 6. Le fichier livré contient bien toutes les cartes -------------------
section('Fichier livré à HACS');
const bundlePath = path.join(root, hacs.filename || '');
if (!hacs.filename || !fs.existsSync(bundlePath)) {
    ko(`${hacs.filename} absent du dépôt`);
} else {
    const bundle = fs.readFileSync(bundlePath, 'utf8');
    try {
        new Function(bundle);
        ok(`${hacs.filename} : syntaxe`);
    } catch (e) {
        ko(`${hacs.filename} : ${e.message}`);
    }
    for (const card of cards) {
        const tag = card.replace(/\.js$/, '');
        bundle.includes(`'${tag}'`)
            ? ok(`${tag} présente dans le fichier livré`)
            : ko(`${tag} absente du fichier livré`);
    }
    // Régénération et comparaison : le fichier généré ne doit pas dériver.
    const { execFileSync } = require('child_process');
    try {
        execFileSync(process.execPath,
            [path.join(root, 'tools/build-hacs-bundle.js'), '--check'],
            { stdio: 'pipe' });
        ok('fichier livré à jour avec ses sources');
    } catch (e) {
        ko('fichier livré désynchronisé : node tools/build-hacs-bundle.js');
    }
}

console.log('\n' + (failures ? `${failures} contrôle(s) en échec` : 'tous les contrôles passent'));
process.exit(failures ? 1 : 0);
