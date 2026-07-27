#!/bin/sh
# Extrait la section du CHANGELOG correspondant à un tag, pour les notes de
# release.  Usage : ./tools/changelog-section.sh v1.15.0
set -e
cd "$(dirname "$0")/.."
TAG="${1:?tag attendu, ex. v1.15.0}"
awk -v tag="$TAG" '
    $0 ~ "^## \\[" tag "\\]" { found = 1; next }
    found && /^## \[/        { exit }
    found                    { print }
' CHANGELOG.md | sed '/^$/{ 1d; }'
