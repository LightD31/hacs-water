# Changelog

Toutes les modifications notables pour ce dépôt sont listées ci-dessous.

## [v1.11.3] - 2026-07-12

- **Anti-injection : plus de plafond logiciel sur la température.**
  `antiInjUseful` ne s'arrêtait plus qu'à `reach_for` (la cible normale), ce
  qui limitait l'intérêt de l'anti-injection à absorber le surplus au même
  niveau que le chauffage habituel — sans réellement stocker l'énergie
  gratuite en trop. Désormais, tant que le surplus est actif
  (`antiInjActive`), le forçage continue au-delà de `reach_for` : le cumulus
  devient une batterie thermique gratuite, jusqu'à ce que le thermostat
  mécanique du ballon coupe lui-même le circuit (seul plafond restant).
- Fichiers modifiés : `flows.json`, `README.md`, `CHANGELOG.md`.

## [v1.11.2] - 2026-07-06

- **Anti-légionelle critique : ne plus abandonner quand le thermostat semble
  coupé.** Auparavant, si `thermostatTripped` était détecté pendant un cycle
  critique, le flow désactivait `legionellaCritical` (aucune action) et se
  contentait de notifier. Le relais reste désormais forcé ON malgré la
  détection — au pire sans effet si le thermostat mécanique coupe réellement
  avant 62 °C, mais sans renoncer à la tentative. `legionellaBlocked` sert
  uniquement à l'affichage/notification (« anti-légionelle forcé malgré
  thermostat coupé »), plus à bloquer l'action.
- **Carte** : libellé hero et table des couleurs mis à jour (« Legionella
  forcée (thermostat suspect) » au lieu de « Legionella bloquée »). Bump carte
  v1.11.2.
- **Anti-injection : même correctif.** `antiInjUseful` ne dégage plus sur
  `thermostatTripped` non plus. `thermostatTripped` est une lecture
  instantanée (le thermostat mécanique peut simplement être en creux de son
  propre cycle d'hystérésis) ; désactiver l'anti-injection dessus pouvait
  faire couper le relais par une priorité inférieure et manquer l'absorption
  du surplus dès que le thermostat referme le circuit de lui-même. Seule la
  cible atteinte (`temp >= reach_for`) arrête encore le forçage.
- Fichiers modifiés : `flows.json`, `cumulus-solaire-card.js`, `README.md`,
  `CHANGELOG.md`.

## [v1.11.1] - 2026-06-23

- **Correctif : fausse « commande manuelle » à chaque reboot HA.** Au démarrage
  de Home Assistant, `switch.cumulus` passe par `unavailable`/`unknown` (ou est
  momentanément absent du registre d'états). Le flow comparait cet état
  transitoire à l'état attendu persistant et déclenchait une fausse intervention
  manuelle → pause de 45 min. La détection ignore désormais les états non
  exploitables : « Lire capteurs » expose `switchAvailable` et se replie sur le
  dernier état connu (plus de coercition vers `'off'`) ; la détection manuelle et
  la commande du relais sont conditionnées à un état lisible. Nouvel attribut
  `switch_available`.
- Fichiers modifiés : `flows.json`, `CHANGELOG.md`.

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
