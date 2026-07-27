# Changelog

Modifications notables de ce dépôt, listées ci-dessous.

## [v1.14.0] - 2026-07-27

- **Disjoncteurs intelligents exploités : mesure réelle au lieu d'estimation.**
  Nouvelle variable `CLIM_GROUPS` (JSON) décrivant les deux disjoncteurs
  communicants (Clim Nord → Salon, Cuisine ; Clim Sud → les trois chambres),
  leur compteur de puissance et leur interrupteur. La consommation récupérable
  du flow provient désormais de la mesure du groupe dès qu'elle est exploitable,
  c'est-à-dire quand toutes les unités en marche du groupe appartiennent au
  flow ; sinon le compteur mêle récupérable et non-récupérable sans permettre de
  les séparer, et l'estimation `CLIM_LOAD_W` reprend la main pour ce groupe.
  Source exposée par `clim_draw_source`.
- **Veille des disjoncteurs déduite du récupérable** (`CLIM_GROUP_STANDBY_W`,
  défaut 5 W) : elle subsiste après extinction des unités, la compter comme
  récupérable gonflait le budget de surplus.
- **Alimentation surveillée.** Disjoncteur ouvert : unités du groupe écartées
  avec la cause exacte (« disjoncteur Clim Nord coupé ») plutôt qu'un
  « injoignable » générique, l'autre groupe continuant normalement. Le flow ne
  commande jamais les disjoncteurs, couper l'alimentation d'un compresseur en
  marche n'étant pas une façon de moduler une charge.
- **Calibration de `CLIM_LOAD_W` outillée.** Relevé sur l'installation : une
  unité en rafraîchissement proche de sa consigne tire ~250 W, contre 800 W
  supposés. Nouvel attribut `observed_draw_per_unit_w` (mesure des groupes,
  veille déduite, divisée par le nombre d'unités en marche) pour reporter la
  valeur réelle dans `CLIM_LOAD_W`. Défaut laissé à 800 W, direction prudente :
  trop bas, une unité de trop démarre, et seul le garde-fou import réseau la
  rattrape.
- **Correctif : l'alerte disjoncteur coupé ne pouvait jamais se déclencher.**
  Sa condition exigeait qu'une pièce du groupe soit en demande, alors qu'un
  disjoncteur ouvert rend les entités injoignables, donc sans besoin
  exprimable. Condition remplacée par le signal réellement utile : du surplus
  reste disponible alors que le groupe est hors tension.
- **Triggers supplémentaires** sur `switch.clim_avant` et `switch.clim_sud`,
  pour une réaction immédiate à une coupure.
- **Sensor** : attributs `clim_draw_recoverable` (ex-`clim_draw_estimated`),
  `clim_draw_source`, `clim_power_total_measured`, `observed_draw_per_unit_w`,
  tableau `groups`, et `group` / `breaker_on` par unité.
- **Simulation** : compteurs de groupe intégrés au bouclage physique (veille de
  5 W comprise), consommation par unité réglable pour simuler la modulation
  inverter. 33 scénarios, 161 assertions.
- **Carte** : inchangée, aucun bump.
- Fichiers modifiés : `flows-clim.json`, `dashboard-clim-snippet.yaml`,
  `tests/clim-flow-sim.js`, `README.md`, `CHANGELOG.md`.

## [v1.13.0] - 2026-07-27

- **Flow climatisation adapté à l'installation réelle : cinq unités Daikin.**
  Auparavant une seule entité `climate.clim` supposée. Désormais liste
  **ordonnée** `CLIM_UNITS` (Salon, Cuisine, Chambre Tom, Chambre Didier,
  Chambre Marie), servie par priorité décroissante et délestée dans l'ordre
  inverse. Température de chaque pièce lue sur l'attribut
  `current_temperature` de l'unité, plus aucune sonde externe requise
  (`CLIM_INDOOR_SENSOR` supprimée).
- **Priorité eau chaude portée à 60 °C.** Réservation du surplus au cumulus
  tant que l'eau n'a pas atteint `HOT_WATER_PRIORITY_TEMP` (défaut **60 °C**,
  température de référence anti-légionelle) et non plus la seule cible de
  confort `reach_for` : ballon pleinement chargé et compteur de jours sans
  60 °C remis à zéro avant tout usage du surplus pour le confort. Seuil relevé
  automatiquement si `reach_for` le dépasse (62 °C en cycle légionelle dû).
  Nouvel attribut `hot_water_priority_temp`.
- **Allocation par paliers.** Un palier = `CLIM_LOAD_W` de surplus disponible,
  ±1 unité par palier confirmé (`CLIM_HYST_MIN`), plafond `CLIM_MAX_UNITS`.
  Montée progressive plutôt que démarrage groupé, hors de portée du surplus
  d'une installation domestique avec cinq unités.
- **Correctif : le délestage inversait la priorité.** Les unités ne démarrant
  pas simultanément, leurs `min-run` n'expirent pas simultanément : le filtrage
  des candidats au délestage pouvait couper le Salon (priorité 1) parce que la
  Chambre Tom (priorité 3), démarrée plus tard, était encore retenue. Désormais
  parcours en ordre strict de priorité, interrompu à la première unité bloquée
  (report signalé par `shed_deferred` / `shed_blocked_by`) plutôt que reporté
  sur une pièce plus prioritaire.
- **Correctif : `available_w > 0` ne garantissait pas l'absence d'import
  réseau.** `available_w` est le surplus disponible toutes unités du flow
  arrêtées : avec 3 unités et 800 W disponibles, 1 600 W étaient tirés du réseau
  sans déclencher le garde-fou. Celui-ci s'appuie désormais sur le compteur
  réseau lui-même (`grid_importing`), avec délestage d'une unité par minute,
  `min-run` ignoré, jusqu'à l'arrêt de l'import. C'est aussi ce qui rend la
  priorité eau chaude effective en cours de cycle.
- **Correctif : cible de délestage non latchée.** Une réduction confirmée mais
  bloquée par un `min-run` relançait l'hystérésis au tick suivant, faisant
  osciller `target_count` sans jamais aboutir. Cible désormais latchée jusqu'à
  application ou retour du budget.
- **Cohabitation manuelle, par unité.** Propriété du pilotage (`owned`) et pause
  de 45 min appliquées unité par unité : la chambre allumée à la main ne bloque
  plus le salon, et son relais n'est jamais coupé. Sa consommation n'est pas
  comptée comme récupérable dans le budget, puisqu'elle ne sera pas rendue. Une
  unité en pause laisse le surplus à une autre pièce en demande.
- **Commandes à cible dynamique.** Les nœuds `climate.*` ne fixent plus aucune
  entité : la cible est portée par `payload.target.entity_id`, une seule liste
  `CLIM_UNITS` à modifier pour changer d'unités.
- **Sensor enrichi** : tableau `units` détaillant chaque pièce (température,
  mode demandé, consigne de stockage, propriété, temporisations restantes), plus
  `target_count`, `tier_candidate`, `fundable_units`, `grid_importing`,
  `shed_deferred`, `shed_blocked_by`, `active_units`. Notification
  supplémentaire pour unité injoignable.
- **Simulation** : bouclage physique du compteur réseau (une unité qui démarre
  réduit l'export, comme sur l'installation), sans quoi chaque palier franchi
  en faisait démarrer un autre sur un surplus fantôme. 28 scénarios,
  134 assertions. Toute la décision vivant dans les nœuds `function`, le
  harnais rejoue le pipeline réel sans arbre reproduit à la main.
- **Carte** : inchangée, aucun bump.
- Fichiers modifiés : `flows-clim.json`, `dashboard-clim-snippet.yaml`,
  `tests/clim-flow-sim.js`, `README.md`, `CHANGELOG.md`.

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
