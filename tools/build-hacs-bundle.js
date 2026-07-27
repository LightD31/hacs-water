#!/usr/bin/env node
/**
 * Génère le fichier unique livré par HACS.
 *
 * HACS ne télécharge qu'UN fichier par dépôt de plugin, ET enregistre
 * automatiquement une ressource Lovelace pointant dessus :
 *
 *     /hacsfiles/{dépôt}/{filename de hacs.json}?hacstag=…
 *
 * D'où l'échec de l'approche par archive : `filename` valant `hacs-water.zip`,
 * HACS déclarait une archive comme module JavaScript, ressource inutilisable qui
 * écrasait au passage celle de la carte cumulus. Le fichier désigné doit donc
 * être un vrai `.js`, et il doit contenir les deux cartes.
 *
 * Chaque source est encapsulée dans une IIFE : les deux cartes déclarent des
 * constantes de même nom au premier niveau (VERSION, MODES, esc…), une simple
 * concaténation échouerait sur « Identifier already declared ».
 *
 * Usage :
 *   node tools/build-hacs-bundle.js           écrit le fichier
 *   node tools/build-hacs-bundle.js --check   vérifie qu'il est à jour
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'hacs.json'), 'utf8'));
const out = manifest.filename;

if (manifest.zip_release) {
    console.error('hacs.json : zip_release est incompatible avec la ressource '
        + 'Lovelace gérée par HACS (une archive ne se charge pas comme module).');
    process.exit(1);
}
if (typeof out !== 'string' || !out.endsWith('.js')) {
    console.error('hacs.json : filename doit désigner un fichier .js');
    process.exit(1);
}

const CARDS = ['cumulus-solaire-card.js', 'clim-solaire-card.js'];

const parts = CARDS.map((f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    try {
        new Function(src);
    } catch (e) {
        console.error(`${f} : syntaxe invalide — ${e.message}`);
        process.exit(1);
    }
    return `// ===== ${f} ${'='.repeat(Math.max(0, 66 - f.length))}\n`
        + `(() => {\n${src.trimEnd()}\n})();\n`;
});

const bundle = `/**
 * ${out} — fichier généré, ne pas éditer.
 *
 * Regroupe les cartes du dépôt en un seul module, HACS n'en téléchargeant qu'un
 * par dépôt et déclarant automatiquement sa ressource Lovelace.
 * Régénération : node tools/build-hacs-bundle.js
 *
 * Sources : ${CARDS.join(', ')}
 */

${parts.join('\n')}`;

const target = path.join(root, out);
if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current !== bundle) {
        console.error(`${out} n'est pas à jour avec ses sources.`);
        console.error('Régénérer avec : node tools/build-hacs-bundle.js');
        process.exit(1);
    }
    console.log(`${out} à jour (${CARDS.length} cartes)`);
} else {
    fs.writeFileSync(target, bundle);
    console.log(`${out} écrit — ${CARDS.length} cartes, ${bundle.length} octets`);
}
