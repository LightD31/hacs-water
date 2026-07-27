# Cumulus Solaire Card

Carte Lovelace dédiée à l'automatisation Node-RED **Cumulus Solaire** (V3+). Pensée pour exploiter chaque attribut exposé par `sensor.cumulus_automation` en un seul coup d'œil : état courant, température, fenêtre solaire optimale, anti-injection, anti-Legionella, fraîcheur Solcast.

![preview](docs/preview.png)

## Ce qu'elle affiche

- **Hero** : icône et titre adaptés à l'état, par priorité : automatisation désactivée → pause manuelle → Legionella forcée (thermostat suspect) → Legionella critique → Legionella en attente HC → anti-injection (utile) → Legionella due → Solcast périmé → forçage → chauffe → **solaire amont** (eau déjà fournie à la cible par le cumulus solaire) → cible atteinte → veille. Icône et barre d'accent (haut) en pulsation/shimmer pendant la chauffe active du cumulus.
- **Cadran 270°** de la température de l'eau, avec dégradé bleu → ambre → rouge et repères colorés pour `min_temp`, `forcage_threshold`, `stop_temp` (arrêt du forçage), `reach_for` et le seuil 60°C anti-Legionella (visible uniquement quand pertinent).
- **Courbe Solcast** du jour avec lissage Bézier, bande verte sur la fenêtre optimale (`window_start` / `window_end`, figée pendant un forçage), curseur "maintenant" pointillé. Âge Solcast en rouge si périmé (>6h).
- **Pastilles** : production solaire instantanée, surplus potentiel (anti-injection verte uniquement si utile, `anti_injection_useful`), jours depuis le dernier 60°C, température du **cumulus solaire amont** (`solar_upstream_temp`, teal en cas de couverture déjà de la cible), et « Thermostat coupé » en cas d'ouverture du circuit par le thermostat mécanique.
- **Chemin de décision** (panneau ℹ de la bande stratégie) : 9 priorités du flow affichées en échelle, règles passées ✓, règle décisive →, règles court-circuitées grisées, avec les valeurs comparées (surplus/seuil, temp/cible, solaire amont/seuil, solaire/seuil effectif).

## Pré-requis

Flow Node-RED déployé et exécuté au moins une fois, pour l'exposition de ces attributs sur `sensor.cumulus_automation` :

```
enabled, desired, current_switch,
target_temp, min_temp, reach_for, forcage_threshold,
water_temp, solar_power, potential_surplus,
anti_injection_active, surplus_trigger,
legionella_due, legionella_critical, days_since_high_temp,
solcast_stale, solcast_age_hours, forecast_field,
window_start, window_end, window_avg_w, in_window, is_forcing,
window_skipped_reason, tomorrow_mode
```

Avec le flow **V3** (juin 2026), attributs supplémentaires exploités par la carte (tous
optionnels, retour au comportement précédent en leur absence) :

```
anti_injection_useful, thermostat_tripped,
legionella_critical_pending, legionella_blocked,
manual_hold_active, manual_hold_until,
degraded_sonde, sonde_down_hours,
stop_temp, dt_forcing, tank_volume_l,
effective_trigger
```

Avec le flow **« solaire amont »** (juin 2026), attributs supplémentaires exploités par la carte :

```
solar_upstream_temp, solar_upstream_available,
solar_covers_target, solar_sufficient_threshold, solar_sufficient_margin
```

Pour la courbe Solcast, lecture directe de l'attribut `detailedForecast` du capteur Solcast du jour.

## Cumulus solaire en amont (préchauffe en série)

Cumulus **solaire** plombé **en série, en amont** du cumulus électrique
(eau froide passant d'abord par le ballon solaire, puis par le ballon électrique) :
chauffage électrique inutile dès fourniture de l'eau à la cible par le ballon
solaire.

Lecture de la sonde du ballon solaire (`sensor.temp_cumulus_solaire_temperature`)
par le flow et, à une priorité **inférieure** à l'anti-injection (surplus) et à
l'anti-légionelle, coupure de l'appoint électrique dès que :

```
temp_cumulus_solaire ≥ cible_effective (reach_for) + marge
```

- **Marge** (`solar_sufficient_margin`, défaut **3 °C**) pour la
  stratification du ballon solaire et les pertes en ligne, sans eau tiède
  au robinet. Réglable via la variable d'environnement Node-RED
  `SOLAR_SUFFICIENT_MARGIN`.
- **Anti-injection conservée** : surplus réseau durable, chauffe forcée quand
  même (stockage de l'énergie gratuite), priorité supérieure. Aucun
  plafond logiciel : chauffe au-delà de `reach_for` en cas de surplus actif
  (cumulus en batterie thermique gratuite), jusqu'à coupure du circuit par
  le thermostat mécanique du ballon lui-même.
- **Anti-légionelle conservée** : chauffe forcée en cycle critique. Seuil
  basé sur `reach_for` (relevé à 62 °C en cas de légionelle due), donc pas
  de court-circuit du cycle par la coupure « solaire amont ».
- Sonde solaire indisponible : règle non appliquée, retour au comportement
  habituel du flow.

## Climatisation et chauffage gratuits (`flows-clim.json`)

Second flow Node-RED, **indépendant**, pour le pilotage des cinq unités Daikin
sur le seul surplus solaire, **eau chaude prioritaire**. Import séparé de
`flows-clim.json` (onglet « Climatisation Solaire »), sans aucune modification
de `flows.json`.

### Carte Lovelace dédiée

`clim-solaire-card.js`, pensée pour `sensor.clim_automation` comme la carte
cumulus l'est pour son propre sensor.

- **Hero** : état et raison, icône et couleur par priorité — désactivée →
  import réseau → surplus réservé à l'eau chaude → rafraîchissement / chauffage
  / confort gratuit → temporisation → disjoncteur coupé → pilotage manuel →
  sondes muettes → hors saison → confort assuré → veille. Pulsation de l'icône
  et shimmer de la barre d'accent pendant un cycle actif.
- **Budget de surplus** : barre empilée **eau chaude / clim / libre**, la somme
  valant le surplus potentiel. Les **paliers** y sont marqués en pointillés, un
  par unité finançable, ceux atteints en blanc franc : la raison du nombre
  d'unités en marche se lit d'un coup d'œil. Cerclée de rouge en cas d'import
  réseau, avec la mention du disjoncteur hors tension le cas échéant.
- **Pièces, par priorité** : numéro d'ordre, groupe de disjoncteur, température
  et cible de stockage, sens demandé, et badge d'état (en marche, veille,
  manuel, pause, disjoncteur, temporisation restante). Tap sur une ligne pour
  la fiche de l'unité.
- **Pastilles** : production, surplus potentiel, réservation eau chaude avec son
  seuil, consommation mesurée aux disjoncteurs (part hors flow signalée),
  consommation observée par unité **avec alerte de calibration** si elle
  s'écarte de plus de 25 % de `CLIM_LOAD_W`, kWh du jour, extérieur.
- **Chemin de décision** (bouton ℹ de la bande budget) : les 6 priorités du
  flow, règles passées ✓, règle décisive →, règles court-circuitées grisées.
- **Réglages** repliables : automatisation, mode saison, cibles froid et chaud
  (avec leur cible de stockage en sous-titre), seuil par unité. Envoi différé de
  250 ms sur les sliders.

```yaml
type: custom:clim-solaire-card
entity: sensor.clim_automation
```

| Clé | Type | Défaut | Description |
|---|---|---|---|
| `entity` | string | **requis** | Sensor produit par le flow clim |
| `show_units` | bool | `true` | Liste des pièces |
| `show_settings` | string/bool | `'collapsible'` | `'collapsible'` · `'expanded'` · `false` |
| `controls` | object | (voir ci-dessous) | Helpers pilotés, `false` masque une ligne |

| Clé `controls` | Type | Helper par défaut |
|---|---|---|
| `enabled` | toggle | `input_boolean.clim_automation_enabled` |
| `season` | select | `input_select.clim_season_mode` (optionnel) |
| `target_cool` | slider | `input_number.clim_target_cool` |
| `target_heat` | slider | `input_number.clim_target_heat` |
| `surplus_trigger` | slider | `input_number.clim_surplus_trigger` (optionnel) |

Éditeur visuel disponible, les helpers optionnels absents masquant simplement
leur ligne. Exemples dans `dashboard-clim-snippet.yaml`.

> **Ressource Lovelace** : HACS ne télécharge **qu'un seul fichier** par dépôt
> de plugin, et déclare automatiquement une ressource pointant dessus. Les deux
> cartes sont donc réunies dans `hacs-water.js`, fichier généré : **une seule
> ressource, gérée par HACS**, aucune déclaration manuelle. Les deux cartes
> apparaissent ensuite dans le sélecteur.

### Import dans Node-RED

**Prérequis : le flow « Cumulus Solaire V3 » (`flows.json`) doit être déployé.**
`flows-clim.json` en dépend deux fois : il lit `sensor.cumulus_automation`, et
il **réutilise son nœud serveur Home Assistant** (`1a7a75b5.c29f2a`) au lieu
d'en redéfinir un.

Import par **menu ≡ → Import → sélection du fichier `flows-clim.json`**, puis
Deploy. Aucune boîte de dialogue de conflit ne doit apparaître : le fichier ne
contient aucun identifiant déjà présent.

> Si Node-RED propose « Import copy » / « Replace », c'est qu'un onglet
> « Climatisation Solaire » d'une tentative précédente traîne encore. Le
> supprimer d'abord (onglet → menu → Delete), puis réimporter.

Nœud serveur non redéfini **volontairement** : le redéfinir provoquait une
collision d'identifiants, Node-RED renumérotait alors tout le flow et créait un
**second nœud serveur sans jeton d'accès**, rendant invalides tous les nœuds qui
le référencent — `sensor.clim_automation` en tête. Symptôme : erreur de
validation sur ce nœud alors que sa configuration paraît correcte, et un
doublon « Home Assistant » dans la barre latérale *Nœuds de configuration*.

Serveur Home Assistant portant un autre identifiant que `1a7a75b5.c29f2a` :
ouvrir n'importe quel nœud du flow, sélectionner le bon serveur, Node-RED
proposant alors de l'appliquer à tous les nœuds concernés.

### Priorité à l'eau chaude, jusqu'à la cible du cumulus

Aucun couplage direct entre les deux flows : lecture de
`sensor.cumulus_automation` par le flow clim, qui en déduit la part du surplus
à laisser au cumulus. L'eau chaude garde la priorité **jusqu'à la cible du flow
cumulus** (`reach_for`), c'est-à-dire la température qu'il cherche réellement à
atteindre. Elle est relevée d'elle-même à 62 °C pendant un cycle anti-légionelle
dû : la priorité suit, sans réglage.

Suivre la cible plutôt qu'un seuil fixe évite un piège : réserver jusqu'à une
température que le ballon **n'atteint jamais** (thermostat mécanique réglé plus
bas, par exemple) gèlerait la réservation en permanence et le confort gratuit ne
tournerait jamais. `HOT_WATER_PRIORITY_TEMP` permet malgré tout d'imposer un
seuil fixe, à ne retenir que s'il est réellement atteignable ; `0` (défaut) suit
la cible. L'attribut `hot_water_priority_temp` indique le seuil appliqué, et
`hot_water_priority_follows_target` s'il est asservi ou forcé.

| Situation du cumulus | Réservation |
|---|---|
| Déjà en chauffe (`cumulus_power ≥ 100 W`) | **0 W** — consommation déjà déduite du surplus mesuré au compteur |
| Commandé ON, anti-injection, anti-légionelle en attente | **`CUMULUS_LOAD_W`** — démarrage imminent |
| Eau sous la cible (`water_temp < reach_for`) | **`CUMULUS_LOAD_W`** — priorité eau chaude |
| Eau à la cible, ou cible couverte par le cumulus solaire amont | **0 W** — surplus libéré |
| Thermostat mécanique ouvert (`thermostat_tripped`) | **0 W** — aucune consommation possible, surplus inutilisable |
| Automatisation cumulus désactivée, ou cumulus en pause manuelle | **0 W** — pas de demande |
| Sensor introuvable, température ou cible illisible | **`CUMULUS_LOAD_W`** — réservation par sécurité |

```
available_w = (surplus réseau + conso des unités pilotées) − réservation cumulus
```

La priorité reste effective **en cours de cycle** : dès que le cumulus redemande
de l'énergie, `available_w` chute et la clim est délestée, au besoin sans
attendre la temporisation anti court-cycle.

### Allocation par paliers, une unité à la fois

Un palier = `CLIM_LOAD_W` (800 W) de surplus disponible. Les unités sont
servies dans l'ordre de `CLIM_UNITS` (priorité décroissante) et délestées dans
l'ordre inverse, **une seule** ajoutée ou retirée par palier confirmé
(`CLIM_HYST_MIN`, 5 min) : montée progressive, sans à-coup sur les compresseurs.

| `available_w` | Unités en marche |
|---|---|
| ≤ 800 W | aucune |
| 800 → 1 600 W | Salon |
| 1 600 → 2 400 W | Salon + Cuisine |
| 2 400 → 3 200 W | Salon + Cuisine + Chambre Tom |

(seuil de montée strict : `available_w > n × CLIM_LOAD_W` pour passer à
*n* unités ; seuil de descente à `CLIM_STOP_RATIO` près, soit 75 %.)

Ordre par défaut : Salon → Cuisine → Chambre Tom → Chambre Didier →
Chambre Marie. Plafond réglable par `CLIM_MAX_UNITS`.

Le **délestage respecte strictement la priorité** : une unité plus prioritaire
n'est jamais coupée parce qu'une moins prioritaire est encore retenue par son
`min-run` (les unités ne démarrant pas ensemble, leurs temporisations
n'expirent pas ensemble). Le délestage attend, `shed_deferred` le signale, et
l'unité visée est nommée par `shed_blocked_by`.

### Disjoncteurs intelligents : mesure réelle et alimentation

Les cinq unités sont réparties sur deux disjoncteurs communicants, déclarés en
JSON dans `CLIM_GROUPS` :

| Groupe | Disjoncteur | Compteur | Pièces |
|---|---|---|---|
| Clim Nord | `switch.clim_avant` | `sensor.clim_avant_power` | Salon, Cuisine |
| Clim Sud | `switch.clim_sud` | `sensor.clim_sud_power` | Chambre Tom, Chambre Didier, Chambre Marie |

Deux apports par rapport à une simple estimation :

- **Consommation récupérable mesurée.** « Récupérable » = ce que le flow rendrait
  au réseau en éteignant ce qu'il a allumé. La mesure d'un groupe n'est
  exploitable que si **toutes** ses unités en marche appartiennent au flow ;
  sinon le compteur agrège du récupérable et du non-récupérable sans permettre
  de les séparer, et l'estimation `CLIM_LOAD_W` reprend la main pour ce groupe.
  Source indiquée par `clim_draw_source` (`mesure` / `estimation` / `mixte`).
  La veille du disjoncteur (`CLIM_GROUP_STANDBY_W`, défaut 5 W) est retirée :
  elle subsiste après extinction, elle n'est pas récupérable.
- **État d'alimentation.** Disjoncteur ouvert → unités du groupe écartées avec la
  cause exacte (« disjoncteur Clim Nord coupé ») au lieu d'un « injoignable »
  générique, et notification si du surplus reste inexploité. L'autre groupe
  continue normalement. Le flow **ne commande jamais les disjoncteurs** :
  couper l'alimentation d'un compresseur en marche n'est pas une façon de
  moduler une charge.

`CLIM_GROUPS` vide ou invalide : repli complet sur l'estimation par unité,
aucun disjoncteur supposé coupé.

#### Calibrer `CLIM_LOAD_W`

`CLIM_LOAD_W` est le **coût d'un palier**, c'est-à-dire la consommation prêtée à
une unité *pas encore démarrée*. Les unités inverter modulant beaucoup (relevé :
250 W pour une chambre en rafraîchissement proche de sa consigne, contre 800 W
par défaut), la valeur juste s'observe :

1. laisser tourner un cycle ;
2. lire l'attribut `observed_draw_per_unit_w` du sensor (mesure des groupes,
   veille déduite, divisée par le nombre d'unités en marche) ;
3. reporter le **maximum observé** dans `CLIM_LOAD_W`.

Trop haut, le flow est conservateur et laisse du surplus inexploité ; trop bas,
il démarre une unité de trop, ce que le garde-fou import réseau corrige en
2 min. Une fois les unités en marche, le budget s'appuie de toute façon sur la
mesure et non sur cette estimation.

### Garde-fou import réseau

`available_w > 0` **ne signifie pas** qu'on n'importe rien : c'est le surplus
qu'on aurait toutes unités du flow arrêtées. Avec 3 unités et 800 W
disponibles, on tire 1 600 W du réseau. Le seul juge est donc le compteur :
import réseau confirmé pendant 2 min → délestage d'une unité par minute,
`min-run` ignoré, jusqu'à l'arrêt de l'import. C'est aussi ce qui rend la
priorité eau chaude effective **en cours de cycle** : le cumulus qui redémarre
fait basculer le compteur en import.

### Priorité de la décision

1. **Automatisation désactivée** → aucune commande.
2. **Unité hors périmètre** (allumée à la main, pause 45 min, injoignable) → jamais touchée.
3. **Besoin de confort disparu** → libération immédiate, sans attendre le surplus.
4. **Eau chaude prioritaire** → réservation retirée du surplus.
5. **Palier de surplus** → ±1 unité par palier confirmé.
6. **Anti court-cycle par unité** → `CLIM_MIN_RUN_MIN` / `CLIM_MIN_OFF_MIN`.

### Cohabitation avec l'usage manuel

Les deux garde-fous s'appliquent **par unité**, pour que la chambre allumée à
la main ne bloque pas le salon :

- **Propriété du pilotage** : une unité allumée hors du flow n'est **jamais**
  coupée par lui (`owned = false`), et sa consommation n'est pas comptée comme
  récupérable dans le budget (elle ne sera pas rendue).
- **Pause manuelle** : tout changement de mode non commandé par le flow suspend
  l'automatisation 45 min **sur cette unité seulement**. Le surplus n'est pas
  gaspillé pour autant : une autre pièce en demande prend le relais.
- **Unités partielles** : aucune commande si l'unité n'expose pas le mode
  demandé (`hvac_modes` sans `cool`/`heat`), avec notification.

### Confort et stockage du gratuit

Cibles communes à la maison (helpers HA), température propre à chaque pièce lue
sur l'attribut `current_temperature` de l'unité — **aucune sonde externe
nécessaire**. Dépassement volontaire de la cible (`CLIM_STORE_BAND`, défaut
1,5 °C) pour stocker le gratuit dans l'inertie du bâtiment, borné par
`CLIM_COOL_FLOOR` / `CLIM_HEAT_CEILING`. Consigne envoyée à l'unité = cible de
stockage, son propre thermostat assurant la modulation.

Sens de fonctionnement en mode `auto` : froid au-dessus de
`CLIM_OUTDOOR_COOL_MIN` (24 °C), chaud en dessous de `CLIM_OUTDOOR_HEAT_MAX`
(17 °C), rien entre les deux. Sens latché par unité pendant un cycle. Sonde
extérieure absente (`CLIM_OUTDOOR_SENSOR` vide, cas par défaut) : l'écart
intérieur tranche seul.

### Entités et constantes (onglet Env du flow)

| Variable | Défaut | Rôle |
|---|---|---|
| `CLIM_UNITS` | les 5 `climate.*` | Liste **ordonnée** des unités, priorité décroissante |
| `CLIM_UNIT_LABELS` | `Salon,Cuisine,Chambre Tom,…` | Libellés d'affichage, même ordre |
| `CLIM_OUTDOOR_SENSOR` | *(vide)* | Sonde extérieure, optionnelle |
| `CLIM_GROUPS` | 2 disjoncteurs | Groupes de disjoncteurs (JSON) : disjoncteur, compteur, pièces |
| `CLIM_GROUP_STANDBY_W` | `5` | Veille d'un disjoncteur, retirée du récupérable |
| `CUMULUS_SENSOR` | `sensor.cumulus_automation` | Sensor du flow eau chaude |
| `SOLAR_SENSOR` / `GRID_SENSOR` | `sensor.powermeter_power_a` / `_b` | Production solaire / échange réseau |
| `CLIM_LOAD_W` | `800` | Coût d'un palier, à calibrer sur `observed_draw_per_unit_w` |
| `CUMULUS_LOAD_W` | `1200` | Puissance du cumulus (montant réservé) |
| `HOT_WATER_PRIORITY_TEMP` | `0` | Seuil fixe de priorité eau chaude ; `0` suit la cible du cumulus |
| `CLIM_MAX_UNITS` | `5` | Plafond d'unités simultanées |
| `CLIM_MIN_RUN_MIN` / `CLIM_MIN_OFF_MIN` | `20` / `15` | Protection compresseur (min) |
| `CLIM_HYST_MIN` | `5` | Confirmation d'un palier (min) |
| `CLIM_STOP_RATIO` | `0.75` | Seuil d'arrêt en fraction du seuil de démarrage |
| `CLIM_STORE_BAND` | `1.5` | Dépassement de cible pour le stockage (°C) |
| `CLIM_COOL_FLOOR` / `CLIM_HEAT_CEILING` | `21` / `23` | Bornes absolues de confort (°C) |
| `CLIM_OUTDOOR_COOL_MIN` / `CLIM_OUTDOOR_HEAT_MAX` | `24` / `17` | Bascule de saison en mode auto (°C) |

Les nœuds `climate.*` ne fixent **aucune entité** : la cible est portée par
`payload.target.entity_id`, une seule liste `CLIM_UNITS` à modifier pour
changer d'unités. Seuls les triggers « … change » portent les entités en dur,
pour la réaction instantanée ; le tick d'une minute assure la réévaluation
dans tous les cas.

### Helpers Home Assistant

```yaml
input_boolean:
  clim_automation_enabled:
    name: Climatisation automatique
    icon: mdi:air-conditioner

input_number:
  clim_target_cool:
    name: Cible rafraîchissement
    min: 18
    max: 32
    step: 0.5
    unit_of_measurement: "°C"
  clim_target_heat:
    name: Cible chauffage
    min: 12
    max: 26
    step: 0.5
    unit_of_measurement: "°C"
  clim_surplus_trigger:      # optionnel, défaut CLIM_LOAD_W
    name: Seuil de surplus par unité
    min: 0
    max: 3000
    step: 50
    unit_of_measurement: W

input_select:                # optionnel, défaut auto
  clim_season_mode:
    name: Mode saison clim
    options: [auto, froid, chaud, arrêt]
```

### Sensor produit

`sensor.clim_automation`, état lisible (« Rafraîchissement gratuit », « Veille
(eau chaude prioritaire) », « Arrêt différé (anti court-cycle) »…) et attributs
pour le dashboard : `available_w`, `cumulus_reserve_w`,
`cumulus_reserve_reason`, `hot_water_priority`, `hot_water_priority_temp`,
`preempted_by_hot_water`, `target_count`, `tier_candidate`, `fundable_units`,
`grid_importing`, `hard_stop`, `shed_deferred`, `shed_blocked_by`,
`active_units`, `clim_draw_recoverable`, `clim_draw_source`,
`clim_power_total_measured`, `observed_draw_per_unit_w`, `clim_kwh_today`, plus
deux tableaux : `units` (température, groupe, alimentation, mode demandé,
consigne de stockage, propriété, temporisations restantes) et `groups`
(disjoncteur, état, puissance mesurée). Exemples de cartes dans
`dashboard-clim-snippet.yaml`.

Notifications HA : plus aucune température de pièce (≥ 2 h), unité injoignable
(≥ 1 h), `sensor.cumulus_automation` introuvable, mode demandé absent de
`hvac_modes`, disjoncteur coupé alors que du surplus reste disponible.

### Débogage

#### Lire le bon signal

Deux symptômes visuellement proches, causes sans rapport :

| Symptôme | Nature | Où chercher |
|---|---|---|
| **Triangle rouge** sur le nœud, avant Deploy | Configuration invalide dans l'éditeur (champ requis vide, nœud de config introuvable) | Ouvrir le nœud, le champ fautif est encadré de rouge |
| **Carré rouge + « validation error at: <heure> »** sous le nœud | Statut d'exécution : le **message reçu** est refusé, à chaque message | Barre latérale Debug, et journal Node-RED |

Le second cas ne se corrige pas dans la configuration du nœud : c'est le
contenu du message qu'il faut regarder.

#### Contrainte des attributs du nœud sensor

Le nœud `ha-sensor` valide chaque message. Les valeurs d'attribut acceptées
sont **chaîne, nombre, booléen, objet, tableau** — **jamais `null`**. Un seul
attribut nul fait échouer le message **entier** : statut « validation error »,
entité jamais mise à jour, et rien d'autre pour l'expliquer.

C'est le piège principal ici, les valeurs absentes étant normales (sonde
extérieure non configurée, aucune unité en marche, unité injoignable). Le nœud
« Build sensor payload » **retire donc les clés nulles** avant d'émettre : côté
Home Assistant, un attribut absent vaut « inconnu ». Le scénario 34 de la
simulation verrouille cette contrainte sur sept situations.

#### Voir passer les messages

1. **Barre latérale Debug** (icône insecte). Sélecteur du haut sur
   « all nodes » plutôt que « selected nodes », sinon les erreurs des autres
   nœuds n'apparaissent pas.
2. **Nœud debug temporaire** sur la sortie de « Build sensor payload », réglé
   sur *complete msg object* : le payload exact envoyé au sensor devient
   visible, attribut par attribut.
3. **Nœud catch** déjà présent dans le flow : il attrape les erreurs de tous les
   nœuds de l'onglet et les remonte en notification Home Assistant
   (`clim_flow_error`), avec le nom du nœud fautif et le message d'origine,
   anti-spam d'un quart d'heure.
4. **Journal de l'add-on** : Home Assistant → Paramètres → Modules
   complémentaires → Node-RED → onglet *Journal*. C'est là qu'atterrissent les
   erreurs de module, les piles d'appel et les `node.warn` du flow.
5. **Console du navigateur** (F12) pour les erreurs propres à l'éditeur.

#### Isoler

Le flow se coupe proprement en tronçons, chaque nœud `function` étant autonome :

- Désactiver l'onglet entier (menu de l'onglet → *Disable*), puis réactiver et
  observer un tronçon à la fois.
- Débrancher le fil vers le nœud sensor : erreurs disparues, le problème est
  dans le payload et non dans la décision.
- Injecter à la main : un nœud `inject` branché sur « Lire capteurs & unités »
  déclenche un cycle complet immédiatement, sans attendre le tick d'une minute.

#### Rejouer hors de Home Assistant

La simulation exécute les corps réels des nœuds `function` sur un registre
d'états factice, sans rien déployer :

```
node tests/clim-flow-sim.js
```

Pour reproduire une situation précise, ajouter un scénario dans
`tests/clim-flow-sim.js` : `states({ ... })` décrit les entités, `surplusBase`
l'export disponible avant clim et cumulus, et le compteur réseau se recalcule
seul à chaque tick. C'est le moyen le plus rapide de vérifier une hypothèse sur
la décision sans toucher à l'installation.

### Simulation

Harnais exécutant les corps réels des nœuds `function` du flow, sur horloge
accélérée et registre d'états HA factice, avec bouclage physique du compteur
réseau (une unité qui démarre réduit l'export, comme sur l'installation) :

```
node tests/clim-flow-sim.js
```

33 scénarios, 161 assertions : réservation dans chaque situation du cumulus,
seuil 60 °C, montée et délestage en paliers, ordre de priorité au délestage,
garde-fou import réseau, mesure par disjoncteur et repli sur estimation,
disjoncteur coupé, calibration sur unités inverter à 250 W, pilotage manuel par
unité, pause 45 min, temporisations compresseur, mode non supporté, unité
injoignable, stockage, réalignement de consigne. Les compteurs de groupe font
partie du bouclage physique du harnais. Toute la décision vivant dans les nœuds
`function`, le harnais rejoue le pipeline réel sans logique dupliquée.

## Installation via HACS (custom repository)

1. HACS → Frontend → menu ⋮ en haut à droite → **Custom repositories**.
2. URL : `https://github.com/LightD31/hacs-water`, catégorie **Lovelace**.
3. Installation de **Cumulus & Clim Solaire Cards** depuis la liste.
4. Rechargement du navigateur (Ctrl+F5).

La ressource Lovelace est **gérée par HACS**, rien à déclarer à la main. Les
deux cartes sont livrées dans un fichier unique et apparaissent toutes deux dans
le sélecteur de cartes. Les bannières `CUMULUS-SOLAIRE-CARD` et
`CLIM-SOLAIRE-CARD` dans la console du navigateur confirment le chargement.

### Pourquoi un fichier unique

HACS ne télécharge qu'un fichier par dépôt de plugin — son gestionnaire retourne
dès le premier trouvé — **et** enregistre une ressource Lovelace construite sur
le `filename` de `hacs.json` :

```
/hacsfiles/hacs-water/{filename}?hacstag=…
```

Une livraison par archive (`zip_release`) échoue donc doublement : HACS déclare
l'archive elle-même comme module JavaScript, ressource inutilisable, et écrase
au passage celle qui fonctionnait. `filename` doit désigner un vrai `.js`, d'où
`hacs-water.js`, regroupant les deux cartes.

Chaque source est encapsulée dans une IIFE lors de la génération : les deux
cartes déclarent des constantes de même nom au premier niveau (`VERSION`,
`MODES`, `esc`…), une concaténation brute échouerait sur « Identifier already
declared ».

### Publication d'une release

```
git tag v1.18.0 && git push origin v1.18.0
```

Le workflow (`.github/workflows/release.yml`) rejoue la simulation et les
contrôles d'intégrité, vérifie que `hacs-water.js` est à jour avec ses sources,
crée la release avec les notes tirées de la section correspondante du CHANGELOG
et y attache le fichier. Une release publiée à la main déclenche le même
workflow, qui se contente alors d'attacher le fichier sans toucher aux notes.

Régénération locale après modification d'une carte :

```
node tools/build-hacs-bundle.js
```

Le fichier généré est versionné, et la CI échoue s'il diverge de ses sources.

### Contrôles automatiques

`.github/workflows/ci.yml`, sur chaque push et chaque PR :

- `node tests/clim-flow-sim.js` — 35 scénarios, 180 assertions ;
- `node tools/validate-repo.js` — invariants du dépôt, chacun correspondant à un
  défaut réellement rencontré : **`filename` désignant un `.js` et non une
  archive** (une archive déclarée comme ressource Lovelace cassait les deux
  cartes), intégrité des deux graphes Node-RED, **absence de collision
  d'identifiants entre les deux flows** (cause du nœud serveur dupliqué à
  l'import), nœuds `climate` sans entité en dur, cartes enregistrées et
  déclarées, fichier livré contenant bien toutes les cartes et à jour avec
  elles ;
- vérification que le fichier livré est à jour.

## Installation manuelle

1. Copie de `cumulus-solaire-card.js` dans `/config/www/` (ou un sous-dossier).
2. Ajout de la ressource Lovelace : Settings → Dashboards → menu ⋮ → **Resources** → **Add resource**.
   - URL : `/local/cumulus-solaire-card.js`
   - Type : `JavaScript Module`
3. Rechargement du navigateur.

## Utilisation

Configuration minimale :

```yaml
type: custom:cumulus-solaire-card
entity: sensor.cumulus_automation
```

Avec capteur Solcast personnalisé :

```yaml
type: custom:cumulus-solaire-card
entity: sensor.cumulus_automation
forecast_entity: sensor.solcast_pv_forecast_previsions_pour_aujourd_hui
```

## Options de configuration

| Clé | Type | Défaut | Description |
|---|---|---|---|
| `entity` | string | **requis** | L'entité produite par le flow Node-RED |
| `forecast_entity` | string | `sensor.solcast_pv_forecast_previsions_pour_aujourd_hui` | Capteur Solcast pour la courbe du jour, avec attribut `detailedForecast` requis. |
| `show_settings` | string/bool | `'collapsible'` | `'collapsible'` (défaut, repliable, fermé au départ) · `'expanded'` (toujours ouvert) · `false` (masqué) |
| `controls` | object | (voir ci-dessous) | Mapping des helpers HA contrôlés par les sliders et le toggle |

Champ Solcast affiché (`pv_estimate`, `pv_estimate10`, `pv_estimate90`) aligné sur l'attribut `forecast_field` exposé par le sensor cumulus, sélecteur Solcast maître.

### Panneau réglages

Panneau « Réglages » (icône ⚙ en bas de la carte, repliable) : six contrôles, chacun pilotant un helper HA :

| Clé `controls` | Type | Helper par défaut | Notes |
|---|---|---|---|
| `enabled` | toggle | `input_boolean.cumulus_automation_enabled` | Activation/désactivation de l'automatisation entière |
| `target` | slider | `input_number.cumulus_target_temp` | Cible normale (°C) |
| `min` | slider | `input_number.cumulus_min_temp` | Seuil bas, déclenchement du forçage (°C) |
| `solar_trigger` | slider | `input_number.cumulus_solar_trigger` | Seuil de production solaire (W), avec valeur effective affichée si modulée par `tomorrow_mode` |
| `surplus_trigger` | slider | `input_number.cumulus_surplus_trigger` | Seuil anti-injection (W) |
| `efficiency` | slider | `input_number.cumulus_efficiency` | Rendement du chauffage (0–1 ou 0–100 %) |
| `tank` | slider | `input_number.cumulus_tank_volume` | Volume du ballon (L). Optionnel, ligne masquée en l'absence de l'helper. |

Chaque slider avec courte description de son **impact réel** sur la décision
(ex. « Plancher absolu, avec forçage dans la meilleure fenêtre solaire en dessous »).

Lecture automatique de `min`, `max`, `step`, `unit_of_measurement` depuis l'helper HA par les sliders, pas besoin de les redéfinir dans la carte. Envoi des changements à HA après 250 ms de pause (debounce), pour éviter de spammer le bus pendant le déplacement du curseur.

Pour pointer un slider sur un helper différent :

```yaml
type: custom:cumulus-solaire-card
entity: sensor.cumulus_automation
controls:
  target: input_number.mon_autre_helper
  efficiency: false   # masque cette ligne
```

Pour masquer entièrement le panneau :

```yaml
show_settings: false
```

Pour un panneau toujours déplié (carte plus grande mais tout visible) :

```yaml
show_settings: expanded
```

## Comportement des couleurs

Palette cohérente pour toutes les couleurs d'état :

| État | Couleur | Quand |
|---|---|---|
| ✋ Pause manuelle | Violet `#8e24aa` | `manual_hold_active = true` |
| 🛑 Legionella forcée (thermostat suspect) | Rouge `#e53935` | `legionella_blocked = true` (thermostat mécanique probablement coupé avant 62°C, relais forcé quand même) |
| 🦠 Legionella critique | Rouge `#e53935` | `legionella_critical = true` |
| ⏳ Legionella en attente | Orange `#fb8c00` | `legionella_critical_pending = true` (chauffe planifiée aux heures creuses) |
| ⚡ Anti-injection | Vert `#43a047` | `anti_injection_useful = true` (fallback : `anti_injection_active`) |
| ⚠️ Legionella due | Orange `#fb8c00` | `legionella_due = true` (et eau < cible) |
| 📡 Solcast périmé | Gris `#757575` | `solcast_stale = true` (sans forçage) |
| 🔥 Forçage | Orange `#fb8c00` | `is_forcing = true` |
| 💧 Chauffe | Vert `#43a047` | `desired = on` (autres cas) |
| ☀️ Solaire amont | Teal `#26a69a` | `solar_covers_target = true` (cumulus solaire fournissant déjà l'eau à la cible) |
| ✅ Cible atteinte | Bleu `#1e88e5` | `water_temp >= reach_for` |
| 💤 Veille | Bleu `#1e88e5` | par défaut |
| 🤖 Désactivée | Gris `#9e9e9e` | `enabled = false` |

Pulsation de l'icône et shimmer de la barre d'accent pendant un état « actif » (anti-injection, Legionella critique, forçage, chauffe).

## Interaction

Tap sur la carte → pop-up « more-info » de `sensor.cumulus_automation` (tous les attributs visibles).

## Compatibilité

- Home Assistant 2023.1+
- Aucune dépendance externe (`ha-icon` fourni par HA)
- Responsive : empilement vertical dial + courbe sous 520 px

## Licence

MIT
