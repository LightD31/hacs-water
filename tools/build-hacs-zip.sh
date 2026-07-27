#!/bin/sh
# Construit l'archive attendue par HACS.
#
# hacs.json déclare `zip_release: true` et `filename: hacs-water.zip` : HACS ne
# télécharge qu'UN fichier par dépôt de plugin (il s'arrête au premier trouvé),
# l'archive est donc le seul moyen d'y livrer les deux cartes. L'asset attaché à
# la release doit porter EXACTEMENT ce nom, sinon HACS ne trouve rien.
#
# Contenu extrait tel quel dans /config/www/community/hacs-water/ : les fichiers
# sont donc placés à la racine de l'archive, sans dossier intermédiaire (-j).
set -e
cd "$(dirname "$0")/.."

OUT=hacs-water.zip
CARDS="cumulus-solaire-card.js clim-solaire-card.js"

for f in $CARDS; do
    [ -f "$f" ] || { echo "manquant : $f" >&2; exit 1; }
    node --check "$f" || { echo "syntaxe invalide : $f" >&2; exit 1; }
done

rm -f "$OUT"
zip -j -q "$OUT" $CARDS
echo "archive : $OUT"
unzip -l "$OUT"
