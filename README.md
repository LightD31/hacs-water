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
