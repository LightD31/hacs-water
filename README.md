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

Second flow Node-RED, **indépendant**, pour le pilotage d'une clim réversible
(ou pompe à chaleur air/air) sur le seul surplus solaire, **eau chaude
prioritaire**. Import séparé de `flows-clim.json` (onglet « Climatisation
Solaire »), sans aucune modification de `flows.json`.

### Priorité à l'eau chaude

Aucun couplage direct entre les deux flows : lecture de
`sensor.cumulus_automation` par le flow clim, qui en déduit la part du surplus
à laisser au cumulus. Distinction essentielle, sous peine de compter deux fois
la même énergie :

| Situation du cumulus | Réservation | Raison |
|---|---|---|
| Déjà en chauffe (`cumulus_power ≥ 100 W`) | **0 W** | Consommation déjà déduite du surplus mesuré au compteur réseau |
| Commandé ON, anti-injection ou anti-légionelle en attente | **`CUMULUS_LOAD_W`** | Démarrage imminent, surplus à ne pas préempter |
| Eau sous la cible (`water_temp < reach_for`) | **`CUMULUS_LOAD_W`** | Besoin non couvert, l'eau chaude passe avant le confort |
| Eau à la cible, ou cible couverte par le cumulus solaire amont | **0 W** | Surplus libéré pour le confort |
| Thermostat mécanique ouvert (`thermostat_tripped`) | **0 W** | Aucune consommation possible, surplus inutilisable par le cumulus |
| Automatisation cumulus désactivée, ou cumulus en pause manuelle | **0 W** | Pas de demande |
| `sensor.cumulus_automation` introuvable ou température illisible | **`CUMULUS_LOAD_W`** | Réservation par sécurité, l'eau chaude ne perd jamais son surplus sur une lecture manquante |

Le surplus laissé au confort est exposé en clair :

```
available_w = (surplus réseau + consommation propre de la clim) − réservation cumulus
```

La priorité reste effective **en cours de cycle** : dès que le cumulus
redemande de l'énergie, `available_w` passe en négatif et la clim s'arrête,
au besoin en court-circuitant la temporisation anti court-cycle (`hard_stop`
après 2 min d'import réseau franc).

### Arbre de décision (priorité ↓)

1. **Automatisation active ?** (`input_boolean.clim_automation_enabled`), sinon maintien sans commande.
2. **Pilotage manuel ?** Clim allumée hors automatisation, ou intervention manuelle détectée (pause de 45 min).
3. **Sonde intérieure OK ?** Sinon arrêt, pas de pilotage à l'aveugle.
4. **Besoin de confort ?** Écart à la cible et sens autorisé par la saison.
5. **Surplus libre après eau chaude ?** Hystérésis de 5 min, seuil d'arrêt à 75 % du seuil de démarrage.
6. **Démarrage / arrêt autorisé ?** Protection compresseur (20 min de marche minimum, 15 min d'arrêt minimum).

### Deux garde-fous de cohabitation

- **Propriété du pilotage** : une clim allumée à la main n'est **jamais** coupée
  par le flow (`clim_owned = false`). Le confort demandé explicitement passe
  avant l'économie.
- **Pause manuelle** : tout changement d'état non commandé par le flow suspend
  l'automatisation 45 min, comme dans le flow cumulus.

### Stockage de l'énergie gratuite

Même principe que le cumulus en batterie thermique : dépassement volontaire de
la cible de confort (`CLIM_STORE_BAND`, défaut 1,5 °C) pour stocker le gratuit
dans l'inertie du bâtiment, borné par `CLIM_COOL_FLOOR` / `CLIM_HEAT_CEILING`
pour éviter l'inconfort inverse. Consigne envoyée à l'unité = cible de
stockage, son propre thermostat assurant la modulation.

Sens de fonctionnement en mode `auto` : froid au-dessus de
`CLIM_OUTDOOR_COOL_MIN` (24 °C), chaud en dessous de `CLIM_OUTDOOR_HEAT_MAX`
(17 °C), rien entre les deux (saison neutre). Sens latché pendant un cycle,
pas de bascule froid ↔ chaud en cours de route. Sonde extérieure absente :
l'écart intérieur tranche seul.

### Entités et constantes (onglet Env du flow)

| Variable | Défaut | Rôle |
|---|---|---|
| `CLIM_ENTITY` | `climate.clim` | Entité climatisation pilotée |
| `CLIM_INDOOR_SENSOR` | `sensor.temp_salon_temperature` | Sonde intérieure (obligatoire) |
| `CLIM_OUTDOOR_SENSOR` | `sensor.temp_exterieur_temperature` | Sonde extérieure (optionnelle) |
| `CLIM_POWER_SENSOR` | `sensor.clim_power` | Consommation de la clim |
| `CUMULUS_SENSOR` | `sensor.cumulus_automation` | Sensor du flow eau chaude |
| `SOLAR_SENSOR` / `GRID_SENSOR` | `sensor.powermeter_power_a` / `_b` | Production solaire / échange réseau |
| `CLIM_LOAD_W` | `800` | Puissance électrique de la clim (seuil de démarrage par défaut) |
| `CUMULUS_LOAD_W` | `1200` | Puissance du cumulus (montant réservé) |
| `CLIM_MIN_RUN_MIN` / `CLIM_MIN_OFF_MIN` | `20` / `15` | Protection compresseur (min) |
| `CLIM_HYST_MIN` | `5` | Durée de confirmation du surplus (min) |
| `CLIM_STOP_RATIO` | `0.75` | Seuil d'arrêt en fraction du seuil de démarrage |
| `CLIM_STORE_BAND` | `1.5` | Dépassement de cible pour le stockage (°C) |
| `CLIM_COOL_FLOOR` / `CLIM_HEAT_CEILING` | `21` / `23` | Bornes absolues de confort (°C) |
| `CLIM_OUTDOOR_COOL_MIN` / `CLIM_OUTDOOR_HEAT_MAX` | `24` / `17` | Bascule de saison en mode auto (°C) |

Changement de `CLIM_ENTITY` : penser aux trois nœuds `climate.*` du groupe
« Action & Sensor » et au trigger « Clim change », dont l'entité est en dur
(la commande et la réaction instantanée en dépendent ; le tick d'une minute
continue d'assurer la réévaluation dans tous les cas).

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
    name: Seuil de surplus clim
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
pour le dashboard, dont `available_w`, `cumulus_reserve_w`,
`cumulus_reserve_reason`, `hot_water_priority`, `preempted_by_hot_water`,
`need_mode`, `store_target`, `surplus_trigger`, `stop_trigger`,
`min_run_left_min`, `min_off_left_min`, `clim_owned`, `manual_control`,
`clim_kwh_today`. Exemples de cartes dans `dashboard-clim-snippet.yaml`.

Notifications HA en cas de sonde intérieure HS (≥ 2 h), d'entité clim
injoignable (≥ 1 h), de `sensor.cumulus_automation` introuvable, ou de mode
demandé absent de l'unité (`mode_supported`, cas des unités n'exposant que
`heat_cool`).

### Simulation

Harnais de simulation des nœuds `function` du flow, horloge accélérée et
registre d'états HA factice :

```
node tests/clim-flow-sim.js
```

18 scénarios, 76 assertions : réservation du surplus dans chaque situation du
cumulus, préemption en cours de cycle, hystérésis, anti court-cycle, pilotage
manuel, sonde HS, saison neutre, stockage, mode non supporté. L'arbre de
décision y est reproduit à la main, à répercuter en cas de modification des
nœuds `switch` dans Node-RED.

## Installation via HACS (custom repository)

1. HACS → Frontend → menu ⋮ en haut à droite → **Custom repositories**.
2. URL : `https://github.com/USER/cumulus-solaire-card`, catégorie **Lovelace**.
3. Installation de **Cumulus Solaire Card** depuis la liste.
4. Rechargement du navigateur (Ctrl+F5). Ajout automatique de la ressource Lovelace par HACS.

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
