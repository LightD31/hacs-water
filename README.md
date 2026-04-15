# Cumulus Solaire Card

Carte Lovelace dédiée à l'automatisation Node-RED **Cumulus Solaire v4**. Pensée pour exploiter chaque attribut exposé par `sensor.cumulus_automation` en un seul coup d'œil — état courant, température, fenêtre solaire optimale, anti-injection, anti-Legionella, fraîcheur Solcast.

![preview](docs/preview.png)

## Ce qu'elle affiche

- **Hero** — icône + titre adaptés à l'état avec priorité : automatisation désactivée → Legionella critique → anti-injection → Legionella due → Solcast périmé → forçage → chauffe → cible atteinte → veille. L'icône pulse et la barre d'accent en haut shimmer quand le cumulus chauffe activement.
- **Cadran 270°** de la température de l'eau, avec dégradé bleu → ambre → rouge et repères colorés pour `min_temp`, `forcage_threshold`, `reach_for` et le seuil 60°C anti-Legionella (visible uniquement quand pertinent).
- **Courbe Solcast** du jour avec lissage Bézier, bande verte sur la fenêtre optimale (`window_start` / `window_end`), curseur "maintenant" pointillé. L'âge Solcast s'affiche en rouge si périmé (>6h).
- **Pastilles** : production solaire instantanée, surplus potentiel (avec bascule visuelle quand anti-injection active), jours depuis le dernier 60°C, fraîcheur Solcast.

## Pré-requis

Le flow Node-RED v4 doit être déployé et avoir tourné au moins une fois pour exposer ces attributs sur `sensor.cumulus_automation` :

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

Pour la courbe Solcast, l'attribut `detailedForecast` du capteur Solcast aujourd'hui est lu directement.

## Installation via HACS (custom repository)

1. HACS → Frontend → menu ⋮ en haut à droite → **Custom repositories**.
2. URL : `https://github.com/USER/cumulus-solaire-card`, catégorie **Lovelace**.
3. Installer **Cumulus Solaire Card** depuis la liste.
4. Recharger le navigateur (Ctrl+F5). HACS ajoute automatiquement la ressource Lovelace.

## Installation manuelle

1. Copier `cumulus-solaire-card.js` dans `/config/www/` (ou un sous-dossier).
2. Ajouter la ressource Lovelace : Settings → Dashboards → menu ⋮ → **Resources** → **Add resource**.
   - URL : `/local/cumulus-solaire-card.js`
   - Type : `JavaScript Module`
3. Recharger le navigateur.

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
| `entity` | string | **requis** | L'entité produite par le flow Node-RED v4 |
| `forecast_entity` | string | `sensor.solcast_pv_forecast_previsions_pour_aujourd_hui` | Capteur Solcast pour la courbe du jour. Doit exposer `detailedForecast` en attribut. |
| `show_settings` | string/bool | `'collapsible'` | `'collapsible'` (défaut, repliable, fermé au départ) · `'expanded'` (toujours ouvert) · `false` (masqué) |
| `controls` | object | (voir ci-dessous) | Mapping des helpers HA contrôlés par les sliders et le toggle |

Le champ Solcast affiché (`pv_estimate`, `pv_estimate10`, `pv_estimate90`) suit l'attribut `forecast_field` exposé par le sensor cumulus, donc le sélecteur Solcast reste maître.

### Panneau réglages

Le panneau "Réglages" (icône ⚙ en bas de la carte, repliable) expose six contrôles, chacun pilotant un helper HA :

| Clé `controls` | Type | Helper par défaut | Notes |
|---|---|---|---|
| `enabled` | toggle | `input_boolean.cumulus_automation_enabled` | Active/désactive l'automatisation entière |
| `target` | slider | `input_number.cumulus_target_temp` | Cible normale (°C) |
| `min` | slider | `input_number.cumulus_min_temp` | Seuil bas, déclenche le forçage (°C) |
| `solar_trigger` | slider | `input_number.cumulus_solar_trigger` | Seuil de production solaire (W). Affiche la valeur effective si modulée par `tomorrow_mode`. |
| `surplus_trigger` | slider | `input_number.cumulus_surplus_trigger` | Seuil anti-injection (W) |
| `efficiency` | slider | `input_number.cumulus_efficiency` | Rendement du chauffage (0–1 ou 0–100 %) |

Les sliders lisent automatiquement `min`, `max`, `step`, `unit_of_measurement` depuis l'helper HA — pas besoin de les redéfinir dans la carte. Les changements sont envoyés à HA après 250 ms de pause (debounce), pour éviter de spammer le bus pendant qu'on déplace le curseur.

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

Pour qu'il soit toujours déplié (carte plus grande mais tout visible) :

```yaml
show_settings: expanded
```

## Comportement des couleurs

Toutes les couleurs d'état suivent une palette cohérente :

| État | Couleur | Quand |
|---|---|---|
| 🦠 Legionella critique | Rouge `#e53935` | `legionella_critical = true` |
| ⚡ Anti-injection | Vert `#43a047` | `anti_injection_active = true` |
| ⚠️ Legionella due | Orange `#fb8c00` | `legionella_due = true` (et eau < cible) |
| 📡 Solcast périmé | Gris `#757575` | `solcast_stale = true` (sans forçage) |
| 🔥 Forçage | Orange `#fb8c00` | `is_forcing = true` |
| 💧 Chauffe | Vert `#43a047` | `desired = on` (autres cas) |
| ✅ Cible atteinte | Bleu `#1e88e5` | `water_temp >= reach_for` |
| 💤 Veille | Bleu `#1e88e5` | par défaut |
| 🤖 Désactivée | Gris `#9e9e9e` | `enabled = false` |

L'icône pulse et la barre d'accent shimmer quand un état "actif" est en cours (anti-injection, Legionella critique, forçage, chauffe).

## Interaction

Tap sur la carte → ouvre la pop-up "more-info" de `sensor.cumulus_automation` (tous les attributs visibles).

## Compatibilité

- Home Assistant 2023.1+
- Aucune dépendance externe (utilise `ha-icon` fourni par HA)
- Responsive : empile dial + courbe verticalement sous 520px

## Licence

MIT
