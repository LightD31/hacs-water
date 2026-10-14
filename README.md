# Cumulus & Clim Solaire

Deux flows Node-RED qui pilotent le cumulus et les climatisations sur le surplus
solaire, et deux cartes Lovelace qui les rendent lisibles.

- **`flows.json` — Cumulus Solaire** : planification de la chauffe sur la
  prévision Solcast, au meilleur surplus attendu, avec minimum garanti et
  anti-légionelle à échéance.
- **`flows-clim.json` — Climatisation Solaire** : routeur solaire qui module la
  consigne des unités inverter pour suivre le surplus, eau chaude prioritaire.
- **`cumulus-solaire-card` / `clim-solaire-card`** : livrées ensemble par HACS
  dans `hacs-water.js`.

![preview](docs/preview.png)

## Principe : contrat Base, export non rémunéré

Un kWh exporté ne rapporte rien, un kWh soutiré coûte le même prix à toute
heure. Les deux flows en tirent la même règle : **consommer le surplus quand il
existe, et seulement la part du réseau qui ne peut pas être évitée**.

Ordre de priorité du surplus, d'un flow à l'autre :

1. **Eau chaude jusqu'à sa cible** — le cumulus compte la consommation que la
   clim rendrait (`recoverable_w`) dans son propre surplus et démarre sans
   attendre ; la clim relâche ses consignes dans la minute.
2. **Confort** des pièces (froid ou chaud), puis **stockage** dans les murs
   (consigne au-delà de la cible tant qu'il reste du surplus).
3. **Stockage d'eau chaude** au-delà de la cible — il passe après le confort :
   la clim compte sa consommation comme disponible et la lui reprend.

Les deux flows ne se parlent qu'à travers leurs sensors Home Assistant. La
simulation couplée (`tests/coupled-flows-sim.js`) vérifie que les deux boucles
tiennent cet ordre sur une journée entière sans se renvoyer la balle.

## Flow cumulus (`flows.json`) — planification au surplus

### Ce qui change par rapport aux seuils fixes

Jusqu'en v1.21, le cumulus attendait 1 250 W de surplus pendant 5 min. Avec une
production de crête autour de 1,5 à 2 kW, ce seuil n'était presque jamais tenu :
du 10 au 13 octobre 2026, l'eau est passée de 55 °C (samedi soir) à 39 °C
(mardi midi) en exportant 400 à 950 W pendant des heures, avant une remise à
niveau en grande partie au réseau le mardi.

Rejeu de ces trois jours (mesures réelles à 5 min, production Solcast supposée
exacte) à travers le nouveau flow : **5,6 kWh chauffés à 81 % solaire**, eau
jamais sous 50,9 °C, sans rattrapage au réseau. Ce rejeu est indicatif : une
vraie prévision se trompe, d'où l'apprentissage du biais Solcast.

### Comment il décide

Chaque besoin a une **échéance**, et son énergie est répartie sur les créneaux
Solcast de 30 min restants avant elle, en prenant d'abord ceux au plus fort
**surplus attendu** (production × biais appris − consommation de fond apprise
à cette heure-là). Le surplus attendu du dernier créneau retenu devient le
**seuil** du besoin : chauffer dès que le surplus mesuré l'atteint vaut le plan.

| Besoin | Cible | Échéance | Particularité |
|---|---|---|---|
| **Minimum garanti** | `min_temp` + 2 °C | moment où le refroidissement appris atteindrait `min_temp` | prévision pessimiste (p10) ; réseau accepté si aucun créneau ne suffit |
| **Anti-légionelle** | 61 °C | 10e jour sans 60 °C (cycle dû dès le 7e) | va chercher le meilleur soleil d'ici l'échéance ; échue, chauffe immédiate |
| **Cible de confort** | `target_temp` | fin de la prévision (demain soir) | **au soleil seulement** : créneaux d'au moins 15 % de part solaire |
| **Stockage gratuit** | — | — | surplus ≥ 90 % du tirage, sans plafond logiciel (le thermostat coupe) |

Conséquences :

- besoin faible et beau temps devant : seuil haut, la chauffe attend le pic ;
- besoin fort ou ciel bouché : seuil bas, chauffe avec une part de réseau, la
  seule qui n'aurait pas pu être évitée plus tard ;
- jamais de chauffe au réseau seul pour le confort : à prix constant, la faire
  plus tard coûte pareil et perd moins de chaleur ; seuls le minimum et
  l'anti-légionelle peuvent l'imposer, au plus près de leur échéance ;
- le refroidissement est pris en compte : attendre coûte des degrés, donc de
  l'énergie.

Une chauffe engagée se poursuit tant que le surplus reste au niveau du créneau
suivant du plan (moins 150 W), pour ne pas hacher la chauffe à mesure que le
besoin restant fond. Anti court-cycle du relais : 5 min allumé, 3 min éteint.

### Appris en continu

| Grandeur | Mesure | Mémoire |
|---|---|---|
| Consommation de fond, **heure par heure** | maison − cumulus − clim | ≈ 1 h d'observation par case (quelques jours) |
| **Biais Solcast** | production mesurée / prévue sur le créneau courant | 45 min pour aujourd'hui, ≈ 3 jours de soleil pour demain |
| **Refroidissement** du ballon (pertes + puisages) | °C perdus par heure sans chauffe | ≈ 2 jours |
| **Rendement** de chauffe | °C gagnés × volume / kWh consommés, par session | remplace `input_number.cumulus_efficiency` après 3 sessions |

Le surplus comparé aux seuils est lissé sur 3 min : un nuage ou une bouilloire
ne déclenchent rien, sans les 5 min d'hystérésis d'avant.

### Échelle de décision

1. Automatisation désactivée → aucune commande.
2. Pause manuelle (interrupteur actionné hors du flow) → 45 min sans commande.
3. Interrupteur illisible → aucune commande.
4. Sonde du ballon HS → stockage gratuit seulement, notification après 2 h.
5. Anti-légionelle échue → chauffe immédiate (thermostat qui coupe avant
   60 °C : notification).
6. Plans : minimum, anti-légionelle, confort, stockage — le premier satisfait
   allume.
7. Anti court-cycle du relais.

Chaque étape est publiée dans `decision_path`, que la carte affiche telle quelle.

### Ballon solaire amont

Ballon **solaire** plombé en série en amont du ballon électrique : dès que sa
sonde (`SOLAR_TANK_SENSOR`) atteint `target_temp` + `SOLAR_SUFFICIENT_MARGIN`
(3 °C par défaut), les plans de minimum et de confort s'effacent. L'anti-
légionelle et le stockage gratuit restent actifs.

### Entités (onglet Env du flow)

| Variable | Défaut |
|---|---|
| `CUMULUS_LOAD_W` | `1200` |
| `CUMULUS_SWITCH` | `switch.chauffe_eau_electrique` |
| `CUMULUS_POWER` | `sensor.chauffe_eau_electrique_power` |
| `WATER_TEMP_SENSOR` | `sensor.temp_chauffe_eau_electrique_temperature` |
| `SOLAR_TANK_SENSOR` | `sensor.temp_chauffe_eau_solaire_temperature` |
| `SOLAR_SUFFICIENT_MARGIN` | `3` |
| `SOLAR_SENSOR` / `GRID_SENSOR` / `HOUSE_SENSOR` | `sensor.pince_amperemetrique_power_a` / `_b` / `_ab` |
| `CLIM_SENSOR` | `sensor.clim_automation` (absent : 0 W récupérable) |

Helpers : `input_boolean.cumulus_automation_enabled`,
`input_number.cumulus_target_temp`, `input_number.cumulus_min_temp`,
`input_number.cumulus_efficiency` (valeur de départ),
`input_number.cumulus_tank_volume` (optionnel, 200 L). Les anciens
`input_number.cumulus_solar_trigger` et `input_number.cumulus_surplus_trigger`
ne sont plus lus et peuvent être supprimés.

### Sensor produit

`sensor.cumulus_automation`, attributs principaux : `rule` (règle décisive),
`decision_path`, `plans` (seuil, énergie, part réseau prévue, échéance de
chaque besoin), `lead_plan`, `lead_threshold_w`, `planned_slots` (créneaux du
besoin qui mène), `surplus_avg_w`, `base_profile` (24 valeurs),
`solcast_bias_today` / `_long`, `decay_c_per_h`, `efficiency` /
`efficiency_source`, `heat_kwh_today`, `solar_share_today`,
`legionella_deadline`, plus les températures, cibles et mesures habituelles.

Notifications : sonde HS (≥ 2 h), anti-légionelle bloquée par le thermostat,
Solcast inexploitable (≥ 12 h).

## Carte cumulus

- **Hero** : icône et titre selon la règle décisive du flow (désactivé, pause
  manuelle, légionelle, minimum garanti, chauffe solaire, stockage gratuit,
  attente du soleil, solaire amont, cible atteinte…). Pulsation pendant une
  chauffe.
- **Bande stratégie** : le besoin qui mène, son seuil, la part réseau prévue et
  l'heure du premier créneau ; dépliée, le chemin de décision du flow puis le
  détail de chaque plan et des valeurs apprises.
- **Cadran 270°** de la température de l'eau, repères `min_temp`, `stop_temp`,
  `reach_for` et 60 °C quand l'anti-légionelle est due.
- **Courbe Solcast** du jour et de demain, **créneaux retenus par le plan** en
  bandes vertes (le créneau en cours plus soutenu), curseur « maintenant ».
- **Pastilles** : production, surplus, jours depuis le dernier 60 °C, ballon
  solaire amont, **part solaire de la chauffe du jour**, thermostat coupé.

La carte reste compatible avec l'ancien flow : en l'absence de `rule`, elle
reprend l'affichage par fenêtre et seuils fixes.

## Import dans Node-RED

Les deux fichiers sont **générés** depuis `nodered/` (`node tools/build-flows.js`) :
chaque nœud `function` y a son propre fichier source, rejoué tel quel par les
simulations. Ne pas éditer les JSON à la main.

### Mise à jour depuis une version à seuils fixes ou à paliers

1. Supprimer l'onglet existant (onglet → menu → *Delete*), **sans** toucher au
   nœud serveur Home Assistant ni aux configurations de sensor. Un import
   « Replace » sans suppression laisserait les anciens nœuds orphelins dans
   l'onglet.
2. Importer (menu ≡ → *Import*). Node-RED signale les nœuds de configuration
   déjà présents (serveur, configuration du sensor) : **ne pas remplacer le
   nœud serveur**, qui porte le jeton d'accès ; la configuration du sensor peut
   être remplacée, elle est identique.
3. *Deploy*.

Les identifiants des onglets et des sensors sont conservés : les entités
`sensor.cumulus_automation` et `sensor.clim_automation` restent les mêmes, et le
contexte persistant (dernier 60 °C, détection manuelle) est repris. Les valeurs
apprises démarrent de leurs défauts et convergent en quelques jours.

### Ordre et dépendances

**Le flow cumulus (`flows.json`) s'importe en premier.** `flows-clim.json` en
dépend deux fois : il lit `sensor.cumulus_automation`, et il **réutilise son
nœud serveur Home Assistant** (`1a7a75b5.c29f2a`) au lieu d'en redéfinir un. Le
flow cumulus lit à son tour `sensor.clim_automation` s'il existe (absent : la
clim compte pour 0 W).

Nœud serveur non redéfini **volontairement** : le redéfinir provoquait une
collision d'identifiants, Node-RED renumérotait alors tout le flow et créait un
**second nœud serveur sans jeton d'accès**, rendant invalides tous les nœuds qui
le référencent — `sensor.clim_automation` en tête. Symptôme : erreur de
validation sur ce nœud alors que sa configuration paraît correcte, et un
doublon « Home Assistant » dans la barre latérale *Nœuds de configuration*.

Serveur Home Assistant portant un autre identifiant que `1a7a75b5.c29f2a` :
ouvrir n'importe quel nœud du flow, sélectionner le bon serveur, Node-RED
proposant alors de l'appliquer à tous les nœuds concernés.

## Flow clim (`flows-clim.json`) — routeur solaire

### Principe

Les cinq unités Daikin sont **inverter** : leur puissance varie de 150 à
1 000 W selon l'écart entre la pièce et la consigne. Plutôt que de les allumer
par paliers de puissance fixe (800 W supposés, 300 à 600 W mesurés en réalité),
le flow **module la consigne** pour suivre le surplus, comme un routeur solaire
module une résistance :

```
écart = export lissé (60 s) − marge (50 W) + tolérance d'import
```

- **écart > +100 W** : consigne plus profonde de 0,5 °C sur l'unité en marche
  la plus prioritaire (une fois toutes les 3 min par unité), jusqu'à sa
  consigne de stockage ; toutes au plus profond, **démarrage** de la pièce
  suivante si l'écart couvre 60 % de sa puissance apprise, confirmé 3 min.
- **écart < −100 W** : consigne **relâchée** vers le ralenti (au-delà de la
  température de la pièce), sur les moins prioritaires d'abord, de 0,5 à 2 °C
  selon l'écart, toutes les 2 min par unité ; toutes au ralenti et import
  persistant 5 min, **arrêt** de la moins prioritaire.
- Unité au ralenti depuis 15 min sans que le surplus la relance : arrêt.
- Pièce revenue sous sa cible de stockage : arrêt après le min-run.

Le compresseur n'est presque jamais coupé : moins de démarrages, et un surplus
suivi au plus près (≈ 90 % du surplus consommé, import quasi nul en
simulation).

### Tolérance d'import

`input_number.clim_import_allowance` (0 W par défaut) : import réseau toléré
**tant qu'une pièce pilotée est hors de sa cible de confort**, pour rafraîchir
une chambre à 27 °C avec un surplus un peu court. Le **stockage** (pièce déjà
dans sa cible) reste au seul surplus. Remplace l'ancien
`input_number.clim_surplus_trigger`, qui n'est plus lu.

### Puissance apprise

Quand une unité tourne seule sur son disjoncteur, la mesure du groupe est la
sienne : sa puissance typique est apprise (moyenne sur 30 min), et sert au
seuil de démarrage. Plusieurs unités sur un groupe : la mesure est partagée au
prorata de leurs puissances apprises. `CLIM_UNIT_W` (500 W) ne sert qu'au
départ.

### Saison sur la prévision

En mode `auto`, le sens autorisé se décide sur la **prévision du jour**
(`weather.get_forecasts` toutes les heures sur `CLIM_WEATHER_ENTITY`) : froid si
le maximum atteint `CLIM_OUTDOOR_COOL_MIN` (24 °C), chaud si le minimum descend
sous `CLIM_OUTDOOR_HEAT_MAX` (17 °C), les deux en demi-saison (l'écart
intérieur tranche). Sans prévision : sonde extérieure, puis température de
l'entité météo, puis l'écart intérieur seul.

### Cohabitation avec l'usage manuel

- **Propriété** : une unité allumée hors du flow n'est jamais touchée, et sa
  consommation n'est pas comptée comme récupérable.
- **Reprise en main** : mode **ou consigne** changés à la main sur une unité
  pilotée → elle sort du périmètre, pause de 45 min sur cette unité. Le flow
  mémorise les consignes qu'il envoie pour ne pas confondre sa modulation avec
  un réglage de l'utilisateur.
- **Unités partielles** : aucune commande si `hvac_modes` n'expose pas le mode
  demandé, avec notification.

### Entités et constantes (onglet Env du flow)

| Variable | Défaut | Rôle |
|---|---|---|
| `CLIM_UNITS` | les 5 `climate.*` | Liste **ordonnée** des unités, priorité décroissante |
| `CLIM_UNIT_LABELS` | `Salon,Cuisine,Chambre Tom,…` | Libellés, même ordre |
| `CLIM_PRIORITY_HELPER` | `input_text.clim_priority_order` | Ordre de service, écrit par la carte |
| `CLIM_OUTDOOR_SENSOR` | `sensor.exterieur_temperature` | Sonde extérieure, optionnelle |
| `CLIM_WEATHER_ENTITY` | `weather.forecast_maison` | Prévision journalière (`none` : désactivée) |
| `CLIM_GROUPS` | 2 disjoncteurs | Groupes (JSON) : disjoncteur, compteur, pièces |
| `CLIM_GROUP_STANDBY_W` | `5` | Veille d'un disjoncteur, retirée des mesures |
| `CUMULUS_SENSOR` | `sensor.cumulus_automation` | Sensor du flow eau chaude |
| `SOLAR_SENSOR` / `GRID_SENSOR` | `sensor.pince_amperemetrique_power_a` / `_b` | Production / échange réseau |
| `CLIM_UNIT_W` | `500` | Puissance supposée avant apprentissage |
| `CLIM_EXPORT_MARGIN_W` | `50` | Export visé par la boucle |
| `CLIM_MAX_UNITS` | `5` | Plafond d'unités simultanées |
| `CLIM_MIN_RUN_MIN` / `CLIM_MIN_OFF_MIN` | `20` / `15` | Protection compresseur (min) |
| `CLIM_CONFIRM_MIN` | `3` | Confirmation d'un démarrage (min) |
| `CLIM_STORE_BAND` | `1.5` | Dépassement de cible pour le stockage (°C) |
| `CLIM_COOL_FLOOR` / `CLIM_HEAT_CEILING` | `21` / `23` | Bornes absolues de confort (°C) |
| `CLIM_OUTDOOR_COOL_MIN` / `CLIM_OUTDOOR_HEAT_MAX` | `24` / `17` | Bascule de saison (°C) |

Les nœuds `climate.*` ne fixent aucune entité : la cible est portée par
`payload.target.entity_id`.

### Helpers Home Assistant

`input_boolean.clim_automation_enabled`, `input_number.clim_target_cool`,
`input_number.clim_target_heat`, et optionnels :
`input_number.clim_import_allowance` (0 à 1 500 W),
`input_select.clim_season_mode` (`auto`, `froid`, `chaud`, `arrêt`),
`input_text.clim_priority_order` (écrit par le bouton ⇅ de la carte). Tous se
créent dans **Paramètres → Appareils et services → Entrées**.

### Sensor produit

`sensor.clim_automation`, état lisible (« Rafraîchissement gratuit »,
« Ralenti (eau chaude prioritaire) », « Démarrage différé »…), attributs
principaux : `router_action`, `router_detail`, `error_w`, `export_avg_w`,
`allowance_active`, `recoverable_w` (lu par le flow cumulus),
`clim_power_total_w`, `cumulus_heating`, `season_basis`, `forecast_today_*`,
`clim_kwh_today`, `clim_solar_share_today`, `decision_path`, et `units` :
consigne courante, consigne visée, bornes de modulation (`deep_setpoint` /
`idle_setpoint`), puissance instantanée et apprise, propriété, temporisations.

Notifications : plus aucune température de pièce (≥ 2 h), unité injoignable
(≥ 1 h), mode absent de `hvac_modes`, disjoncteur coupé alors que plus de
500 W partent au réseau.

## Carte clim

`clim-solaire-card.js`, pensée pour `sensor.clim_automation` comme la carte
cumulus l'est pour son propre sensor.

- **Hero** : état et raison, icône et couleur selon le routeur — désactivée →
  ralenti (eau chaude prioritaire, ou surplus en baisse) → rafraîchissement /
  chauffage / confort gratuit → disjoncteur coupé → pilotage manuel → sondes
  muettes → démarrage en confirmation → hors saison → confort assuré → veille.
  Pulsation de l'icône pendant un cycle actif.
- **Budget de surplus** : barre empilée **eau chaude / clim / export**, cerclée
  de rouge en cas d'import ; légende avec l'**écart** que la boucle corrige et
  son action en cours (consigne approfondie, relâchée, démarrage…), la
  tolérance d'import quand elle s'applique, et les disjoncteurs hors tension.
- **Pièces, par priorité** : numéro d'ordre, groupe, température, **consigne
  visée et puissance instantanée**, sens demandé, badge d'état (en marche,
  veille, manuel, pause, disjoncteur, temporisation restante). Tap sur une
  ligne pour la fiche de l'unité.
- **Réordonnancement des priorités** : bouton ⇅ dans l'en-tête de la liste, puis
  flèches par pièce. L'ordre est écrit dans `input_text.clim_priority_order` et
  **repris immédiatement par le flow**. Le premier servi est le dernier relâché.
  Le bouton n'apparaît que si le helper existe.
- **Pastilles** : production, consommation des unités (part pilotée à la main
  signalée), kWh du jour et leur part solaire, température extérieure et sa
  source, prévision du jour.
- **Chemin de décision** (bouton ℹ de la bande budget), publié par le flow.
- **Réglages** repliables : automatisation, mode saison, cibles froid et chaud
  (avec leur cible de stockage en sous-titre), tolérance d'import. Valeur des
  sliders envoyée au relâché. Couper l'automatisation demande confirmation.

La carte reste compatible avec l'ancien flow à paliers (en l'absence de
`router_action`).

```yaml
type: custom:clim-solaire-card
entity: sensor.clim_automation
```

| Clé | Type | Défaut | Description |
|---|---|---|---|
| `entity` | string | **requis** | Sensor produit par le flow clim |
| `show_units` | bool | `true` | Liste des pièces |
| `show_settings` | string/bool | `'collapsible'` | `'collapsible'` · `'expanded'` · `false` |
| `lock` | bool | `true` | Réglages et réordonnancement verrouillés (voir [Verrou des commandes](#verrou-des-commandes)) |
| `lock_timeout` | number | `30` | Secondes d'inactivité avant reverrouillage |
| `admin_only` | bool | `false` | Lecture seule pour les utilisateurs non administrateurs |
| `controls` | object | (voir ci-dessous) | Helpers pilotés, `false` masque une ligne |

| Clé `controls` | Type | Helper par défaut |
|---|---|---|
| `enabled` | toggle | `input_boolean.clim_automation_enabled` |
| `season` | select | `input_select.clim_season_mode` (optionnel) |
| `target_cool` | slider | `input_number.clim_target_cool` |
| `target_heat` | slider | `input_number.clim_target_heat` |
| `import_allowance` | slider | `input_number.clim_import_allowance` (optionnel) |

Éditeur visuel disponible (sélecteurs d'entités, champ vidé = ligne masquée),
les helpers optionnels absents masquant simplement leur ligne. Chaque helper
accepte aussi l'équivalent non `input_*` : `switch`, `select`, `number`. Exemples dans `dashboard-clim-snippet.yaml`.

> **Ressource Lovelace** : HACS ne télécharge **qu'un seul fichier** par dépôt
> de plugin, et déclare automatiquement une ressource pointant dessus. Les deux
> cartes sont donc réunies dans `hacs-water.js`, fichier généré : **une seule
> ressource, gérée par HACS**, aucune déclaration manuelle. Les deux cartes
> apparaissent ensuite dans le sélecteur.

## Débogage

### Lire le bon signal

Deux symptômes visuellement proches, causes sans rapport :

| Symptôme | Nature | Où chercher |
|---|---|---|
| **Triangle rouge** sur le nœud, avant Deploy | Configuration invalide dans l'éditeur (champ requis vide, nœud de config introuvable) | Ouvrir le nœud, le champ fautif est encadré de rouge |
| **Carré rouge + « validation error at: <heure> »** sous le nœud | Statut d'exécution : le **message reçu** est refusé, à chaque message | Barre latérale Debug, et journal Node-RED |

Le second cas ne se corrige pas dans la configuration du nœud : c'est le
contenu du message qu'il faut regarder.

### Contrainte des attributs du nœud sensor

Le nœud `ha-sensor` valide chaque message. Les valeurs d'attribut acceptées
sont **chaîne, nombre, booléen, objet, tableau** — **jamais `null`**. Un seul
attribut nul fait échouer le message **entier** : statut « validation error »,
entité jamais mise à jour, et rien d'autre pour l'expliquer.

C'est le piège principal ici, les valeurs absentes étant normales (sonde
extérieure non configurée, aucune unité en marche, unité injoignable). Le nœud
« Build sensor payload » **retire donc les clés nulles** avant d'émettre : côté
Home Assistant, un attribut absent vaut « inconnu ». Les deux simulations
vérifient l'absence de null au premier niveau, sonde HS comprise.

### Voir passer les messages

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

### Isoler

Le flow se coupe proprement en tronçons, chaque nœud `function` étant autonome :

- Désactiver l'onglet entier (menu de l'onglet → *Disable*), puis réactiver et
  observer un tronçon à la fois.
- Débrancher le fil vers le nœud sensor : erreurs disparues, le problème est
  dans le payload et non dans la décision.
- Injecter à la main : un nœud `inject` branché sur « Lire capteurs » (ou
  « Lire capteurs & unités ») déclenche un cycle complet immédiatement, sans attendre le tick d'une minute.

### Rejouer hors de Home Assistant

Les simulations exécutent les corps réels des nœuds `function` sur un registre
d'états factice et un modèle physique, sans rien déployer :

```
node tests/cumulus-flow-sim.js
node tests/clim-flow-sim.js
node tests/coupled-flows-sim.js
VERBOSE=1 node tests/cumulus-flow-sim.js   # valeurs mesurées à chaque assertion
ONLY=4 node tests/clim-flow-sim.js         # un seul scénario
```

Pour reproduire une situation précise, ajouter un scénario : `makeWorld({...})`
(cumulus) ou `world({...})` (clim) décrivent l'installation, le compteur réseau
se recalcule seul à chaque tick.

## Simulations

| Harnais | Modèle | Couverture |
|---|---|---|
| `tests/cumulus-flow-sim.js` | ballon (chauffe, refroidissement, thermostat), production en cloche, consommation de fond | 18 scénarios : attente du pic, chauffe à part solaire partielle, minimum de nuit, report au lendemain, anti-légionelle due et échue, pause manuelle, solaire amont, thermostat ouvert, sonde HS, Solcast absent, priorité sur la clim, apprentissage, biais Solcast, payload, anti court-cycle, erreur de commande |
| `tests/clim-flow-sim.js` | unités inverter (puissance selon l'écart pièce/consigne), pièces qui dérivent, compteurs de groupe | 18 scénarios : suivi du surplus, approfondir avant de démarrer, nuage, cumulus prioritaire, tolérance d'import, reprise en main par la consigne, disjoncteur, mode absent, ordre du helper, saison sur prévision, puissance apprise, récupérable, min-run, payload, prévision météo, erreur de commande, bilan d'une heure |
| `tests/coupled-flows-sim.js` | les deux pipelines sur un même compteur, journée complète | priorité eau chaude → confort → stockage, part solaire, nombre de commandes du relais |

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

- `node tools/build-flows.js --check` — flows à jour avec `nodered/` ;
- les trois simulations ci-dessus ;
- `node tools/validate-repo.js` — invariants du dépôt, chacun correspondant à un
  défaut réellement rencontré : **`filename` désignant un `.js` et non une
  archive** (une archive déclarée comme ressource Lovelace cassait les deux
  cartes), flows générés à jour, intégrité des deux graphes Node-RED, **absence de collision
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
| `hero_switch` | bool | `true` | Interrupteur d'automatisation dans l'en-tête, avec confirmation à chaque bascule |
| `lock` | bool | `true` | Réglages verrouillés jusqu'au tap sur « Déverrouiller » |
| `lock_timeout` | number | `30` | Secondes d'inactivité avant reverrouillage |
| `admin_only` | bool | `false` | Lecture seule pour les utilisateurs non administrateurs |

Champ Solcast affiché (`pv_estimate`, `pv_estimate10`, `pv_estimate90`) aligné sur l'attribut `forecast_field` exposé par le sensor cumulus, sélecteur Solcast maître.

### Panneau réglages

Panneau « Réglages » (icône ⚙ en bas de la carte, repliable) : cinq contrôles, chacun pilotant un helper HA :

| Clé `controls` | Type | Helper par défaut | Notes |
|---|---|---|---|
| `enabled` | toggle | `input_boolean.cumulus_automation_enabled` | Activation/désactivation de l'automatisation entière |
| `target` | slider | `input_number.cumulus_target_temp` | Cible de confort (°C), atteinte au soleil |
| `min` | slider | `input_number.cumulus_min_temp` | Minimum garanti (°C), réseau accepté pour le tenir |
| `efficiency` | slider | `input_number.cumulus_efficiency` | Rendement de départ, rendement appris en sous-titre |
| `tank` | slider | `input_number.cumulus_tank_volume` | Volume du ballon (L). Optionnel, ligne masquée en l'absence de l'helper. |

Chaque slider avec courte description de son **impact réel** sur la décision
(ex. « Garanti : chauffe au meilleur créneau avant d'y descendre, sur le réseau s'il le faut »).

Lecture automatique de `min`, `max`, `step`, `unit_of_measurement` depuis l'helper HA par les sliders, pas besoin de les redéfinir dans la carte. Valeur envoyée à HA au relâché du curseur uniquement, jamais pendant le glissé.

### Interrupteur d'automatisation

Interrupteur en haut à droite de la carte, relié au contrôle `enabled`
(`input_boolean.cumulus_automation_enabled` par défaut) : coupure ou reprise
de l'automatisation sans ouvrir les réglages. Placé hors du
[verrou](#verrou-des-commandes), il demande confirmation dans les deux sens
(« Annuler / Couper » ou « Annuler / Activer », annulée d'elle-même après 8 s).
Masqué avec `hero_switch: false` ou si `controls.enabled` vaut `false`.

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

### Verrou des commandes

Sur un mur de dashboard ou un téléphone, un défilement qui accroche un slider
suffisait à changer une cible. Les deux cartes verrouillent donc leurs
commandes par défaut :

- **Verrouillé** : sliders, interrupteur et sélecteur grisés et inertes,
  bandeau « Réglages verrouillés » en tête du panneau. Sur la carte clim, le
  bouton ⇅ de réordonnancement est remplacé par un cadenas.
- **Déverrouiller** : un tap sur le bouton du bandeau (ou sur le cadenas de la
  liste des pièces) rend les commandes actives.
- **Reverrouillage automatique** après `lock_timeout` secondes sans
  interaction (30 s par défaut). Chaque réglage repousse l'échéance, le verrou
  ne retombe jamais au milieu d'un ajustement. Replier le panneau ou taper
  « Verrouiller » reverrouille immédiatement.
- **Couper l'automatisation** demande toujours confirmation, même déverrouillé.
- **`admin_only: true`** : pour un utilisateur non administrateur, commandes en
  lecture seule, sans bouton de déverrouillage. Garde-fou d'interface
  seulement : un utilisateur HA peut toujours appeler les services par
  d'autres moyens, les droits réels restent ceux de Home Assistant.

```yaml
type: custom:cumulus-solaire-card
entity: sensor.cumulus_automation
lock_timeout: 60     # reverrouillage après 1 min d'inactivité
admin_only: true     # famille en lecture seule
```

Pour retrouver le comportement précédent (commandes toujours actives) :

```yaml
lock: false
```

## Comportement des couleurs

Palette cohérente pour toutes les couleurs d'état :

| État | Couleur | Quand |
|---|---|---|
| ✋ Pause manuelle | Violet `#8e24aa` | `manual_hold_active = true` |
| 🛑 Légionelle bloquée | Rouge `#e53935` | `legionella_blocked = true` (thermostat mécanique coupant avant 60 °C) |
| 🦠 Anti-légionelle | Rouge `#e53935` | règle `legionella_overdue` ou `plan_legionella` |
| 🛡️ Minimum garanti | Orange `#fb8c00` | règle `plan_floor` |
| 💧 Chauffe solaire | Vert `#43a047` | règle `plan_comfort` |
| ⚡ Stockage gratuit | Vert foncé `#2e7d32` | règle `plan_storage` |
| ⚠️ Légionelle due | Orange `#fb8c00` | attente, cycle dû |
| 📡 Solcast périmé | Gris `#757575` | attente, `solcast_stale = true` |
| 🌤️ Attente du soleil | Bleu `#1e88e5` | règle `wait` |
| ☀️ Solaire amont | Teal `#26a69a` | `solar_covers_target = true` |
| ✅ Cible atteinte | Bleu `#1e88e5` | règle `idle` |
| 🤖 Désactivée | Gris `#9e9e9e` | `enabled = false` |

Pulsation de l'icône et shimmer de la barre d'accent pendant une chauffe (minimum, légionelle, solaire, stockage).

## Interaction

Tap sur la carte → pop-up « more-info » de `sensor.cumulus_automation` (tous les attributs visibles).

## Compatibilité

- Home Assistant 2023.1+
- Aucune dépendance externe (`ha-icon` fourni par HA)
- Responsive : empilement vertical dial + courbe sous 520 px

## Licence

MIT
