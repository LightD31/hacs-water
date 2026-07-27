# Changelog

Modifications notables de ce dépôt, listées ci-dessous.

## [v1.12.0] - 2026-07-27

- **Nouveau flow : climatisation et chauffage gratuits, eau chaude
  prioritaire.** Fichier `flows-clim.json`, onglet Node-RED « Climatisation
  Solaire », indépendant de `flows.json` (aucune modification de ce dernier).
  Pilotage d'une clim réversible sur le seul surplus solaire, avec priorité
  absolue à l'eau chaude sanitaire.
- **Réservation du surplus au cumulus.** Lecture de
  `sensor.cumulus_automation` par le flow clim, sans couplage direct entre les
  deux automatisations. Distinction du cumulus **déjà en chauffe**
  (consommation déjà déduite du surplus mesuré, aucune réservation) et du
  cumulus **en attente avec besoin non couvert** (`CUMULUS_LOAD_W` réservés,
  sinon la clim mangerait le surplus qui doit lui permettre de démarrer).
  Réservation par sécurité en cas de sensor introuvable ou de température
  d'eau illisible. Reliquat exposé en clair : `available_w`.
- **Priorité effective en cours de cycle.** Retour d'un besoin d'eau chaude →
  `available_w` négatif → arrêt de la clim, au besoin en court-circuitant la
  temporisation anti court-cycle (`hard_stop` après 2 min d'import réseau
  franc).
- **Confort borné et stockage du gratuit.** Dépassement volontaire de la cible
  (`CLIM_STORE_BAND`, défaut 1,5 °C) pour stocker l'énergie gratuite dans
  l'inertie du bâtiment, borné par `CLIM_COOL_FLOOR` / `CLIM_HEAT_CEILING`.
  Sens froid/chaud déduit de la température extérieure en mode auto, latché
  pendant un cycle.
- **Cohabitation avec l'usage manuel.** Clim allumée à la main jamais coupée
  par le flow (`clim_owned`), et pause de 45 min sur toute intervention
  manuelle détectée, comme dans le flow cumulus. Protection compresseur
  (20 min de marche minimum, 15 min d'arrêt minimum).
- **Sensor `sensor.clim_automation`** et notifications HA (sonde intérieure HS,
  entité clim injoignable, sensor cumulus introuvable). Cartes d'exemple dans
  `dashboard-clim-snippet.yaml`, en cartes HA natives.
- **Garde-fou unités partielles.** Aucune commande envoyée si l'unité n'expose
  pas le mode demandé (`hvac_modes` sans `cool`/`heat`), attribut
  `mode_supported` et raison explicite plutôt qu'un échec de service en boucle.
- **Simulation** : `tests/clim-flow-sim.js`, exécution des corps réels des
  nœuds `function` sur horloge accélérée et registre d'états HA factice.
  18 scénarios, 76 assertions, `node tests/clim-flow-sim.js`.
- **Carte** : inchangée, aucun bump (le flow clim expose son propre sensor).
- Fichiers ajoutés : `flows-clim.json`, `dashboard-clim-snippet.yaml`,
  `tests/clim-flow-sim.js`. Fichiers modifiés : `README.md`, `CHANGELOG.md`.

## [v1.11.4] - 2026-07-15

- **Style : phrases nominales, sans tiret cadratin.** Reformulation de
  `README.md`, `CHANGELOG.md`, ainsi que des libellés et messages de
  `flows.json` (commentaires de nœuds, notifications, raisons affichées) et
  `cumulus-solaire-card.js` (titres d'état, descriptions des sliders, textes
  de la bande stratégie), ton neutre et factuel. Tirets cadratins remplacés
  par virgule, deux-points ou parenthèses selon le contexte. Aucun changement
  de comportement fonctionnel.
- **Carte** : bump v1.11.4.
- Fichiers modifiés : `README.md`, `CHANGELOG.md`, `flows.json`,
  `cumulus-solaire-card.js`.

## [v1.11.3] - 2026-07-12

- **Anti-injection : suppression du plafond logiciel sur la température.**
  Auparavant, arrêt de `antiInjUseful` dès `reach_for` (cible normale), donc
  absorption du surplus au même niveau que le chauffage habituel, sans
  stockage réel de l'énergie gratuite en trop. Désormais, forçage au-delà de
  `reach_for` en cas de surplus actif (`antiInjActive`) : cumulus en batterie
  thermique gratuite, jusqu'à coupure du circuit par le thermostat mécanique
  du ballon (seul plafond restant).
- Fichiers modifiés : `flows.json`, `README.md`, `CHANGELOG.md`.

## [v1.11.2] - 2026-07-06

- **Anti-légionelle critique : abandon supprimé en cas de thermostat
  probablement coupé.** Auparavant, en cas de détection de `thermostatTripped`
  pendant un cycle critique, désactivation de `legionellaCritical` par le
  flow (aucune action) et simple notification. Désormais, relais forcé ON
  malgré la détection, sans effet au pire en cas de coupure réelle par le
  thermostat mécanique avant 62 °C, mais sans abandon de la tentative.
  `legionellaBlocked` réservé à l'affichage et à la notification
  (« anti-légionelle forcé malgré thermostat coupé »), plus de blocage de
  l'action.
- **Carte** : libellé hero et table des couleurs mis à jour (« Legionella
  forcée (thermostat suspect) » au lieu de « Legionella bloquée »). Bump carte
  v1.11.2.
- **Anti-injection : même correctif.** Suppression de la désactivation de
  `antiInjUseful` sur `thermostatTripped` également, lecture instantanée
  (thermostat mécanique éventuellement en creux de son propre cycle
  d'hystérésis) dont la prise en compte risquait une coupure du relais par
  une priorité inférieure et un manque d'absorption du surplus à la
  fermeture du circuit par le thermostat lui-même. Seul arrêt du forçage
  restant : cible atteinte (`temp >= reach_for`).
- Fichiers modifiés : `flows.json`, `cumulus-solaire-card.js`, `README.md`,
  `CHANGELOG.md`.

## [v1.11.1] - 2026-06-23

- **Correctif : fausse « commande manuelle » à chaque reboot HA.** Au démarrage
  de Home Assistant, passage de `switch.cumulus` par `unavailable`/`unknown`
  (ou absence momentanée du registre d'états). Auparavant, comparaison de cet
  état transitoire à l'état attendu persistant par le flow, avec déclenchement
  d'une fausse intervention manuelle → pause de 45 min. Désormais, états non
  exploitables ignorés par la détection : `switchAvailable` exposé par
  « Lire capteurs », avec repli sur le dernier état connu (plus de coercition
  vers `'off'`) ; détection manuelle et commande du relais conditionnées à un
  état lisible. Nouvel attribut `switch_available`.
- Fichiers modifiés : `flows.json`, `CHANGELOG.md`.

## [v1.11.0] - 2026-06-22

- **Cumulus solaire en amont (préchauffe en série).** Lecture de
  `sensor.temp_cumulus_solaire_temperature` par le flow, avec coupure de
  l'appoint électrique dès fourniture de l'eau à la cible par le ballon
  solaire (`reach_for` + marge, défaut 3 °C, réglable via
  `SOLAR_SUFFICIENT_MARGIN`). Nouvelle priorité « 6. Cumulus solaire couvre ? »
  placée **sous** l'anti-injection et l'anti-légionelle, prioritaires ;
  forçage et chauffe solaire renumérotés 7→9.
- **Carte** : nouvel état hero « Solaire amont », pastille température du ballon
  solaire, étape « Cumulus solaire » dans le chemin de décision, message dédié
  dans la bande stratégie. Nouveaux attributs : `solar_upstream_temp`,
  `solar_upstream_available`, `solar_covers_target`, `solar_sufficient_threshold`,
  `solar_sufficient_margin`. Bump carte v1.11.0.
- **Maintenance** : `flows.json` reformaté en JSON indenté pour des diffs
  lisibles.
- Fichiers modifiés : `flows.json`, `cumulus-solaire-card.js`, `README.md`.

## [v1.9.3] - 2026-06-12

- Maintenance : `chore(release): v1.9.3`, publication de la release v1.9.3.
- Fichiers modifiés: `README.md`, `cumulus-solaire-card.js`.
- Release publique: https://github.com/LightD31/hacs-water/releases/tag/v1.9.3

<!-- Historique des versions précédentes (conserver pour référence) -->

## [v1.9.2]

- Voir les tags Git pour l'historique complet.
