# Changelog

Toutes les modifications notables pour ce dépôt sont listées ci-dessous.

## [v1.11.0] - 2026-06-22

- **Cumulus solaire en amont (préchauffe en série).** Le flow lit
  `sensor.temp_cumulus_solaire_temperature` et coupe l'appoint électrique quand
  le ballon solaire fournit déjà l'eau à la cible (`reach_for` + marge, défaut
  3 °C, réglable via `SOLAR_SUFFICIENT_MARGIN`). Nouvelle priorité « 6. Cumulus
  solaire couvre ? » placée **sous** l'anti-injection et l'anti-légionelle, qui
  restent prioritaires ; forçage et chauffe solaire renumérotés 7→9.
- **Carte** : nouvel état hero « Solaire amont », pastille température du ballon
  solaire, étape « Cumulus solaire » dans le chemin de décision, message dédié
  dans la bande stratégie. Nouveaux attributs : `solar_upstream_temp`,
  `solar_upstream_available`, `solar_covers_target`, `solar_sufficient_threshold`,
  `solar_sufficient_margin`. Bump carte v1.11.0.
- **Maintenance** : `flows.json` reformaté en JSON indenté pour des diffs
  lisibles.
- Fichiers modifiés : `flows.json`, `cumulus-solaire-card.js`, `README.md`.

## [v1.9.3] - 2026-06-12

- Maintenance: `chore(release): v1.9.3` — publication de la release v1.9.3.
- Fichiers modifiés: `README.md`, `cumulus-solaire-card.js`.
- Release publique: https://github.com/LightD31/hacs-water/releases/tag/v1.9.3

<!-- Historique des versions précédentes (conserver pour référence) -->

## [v1.9.2]

- Voir les tags Git pour l'historique complet.
