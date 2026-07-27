#!/bin/sh
# Construit l'archive attendue par HACS.
#
# HACS ne télécharge qu'UN fichier par dépôt de plugin : son gestionnaire
# s'arrête au premier trouvé, quelle que soit l'organisation du dépôt. L'archive
# est donc le seul moyen d'y livrer les deux cartes (hacs.json : zip_release).
#
# Le nom vient de `filename` dans hacs.json : l'asset de la release doit porter
# EXACTEMENT ce nom, sinon HACS ne trouve rien. Le lire ici plutôt que le
# recopier évite que les deux dérivent.
#
# Contenu extrait tel quel dans /config/www/community/hacs-water/, les fichiers
# sont donc à la racine de l'archive, sans dossier intermédiaire (-j).
set -e
cd "$(dirname "$0")/.."

CARDS="cumulus-solaire-card.js clim-solaire-card.js"

OUT=$(node -e '
const m = require("./hacs.json");
if (m.zip_release !== true) {
    console.error("hacs.json : zip_release doit être à true"); process.exit(1);
}
if (!/\.zip$/.test(m.filename || "")) {
    console.error("hacs.json : filename doit être une archive .zip"); process.exit(1);
}
process.stdout.write(m.filename);
')

for f in $CARDS; do
    [ -f "$f" ] || { echo "carte manquante : $f" >&2; exit 1; }
    node --check "$f" || { echo "syntaxe invalide : $f" >&2; exit 1; }
done

rm -f "$OUT"
zip -j -q "$OUT" $CARDS
echo "archive : $OUT"
unzip -l "$OUT"
