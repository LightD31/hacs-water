/**
 * Clim Solaire Card
 *
 * Custom Lovelace card pour le sensor.clim_automation produit par le flow
 * Node-RED « Climatisation Solaire » (flows-clim.json).
 *
 * Sections :
 *   1. Hero (état + raison)
 *   2. Budget de surplus : barre empilée eau chaude / clim / libre, avec les
 *      paliers d'unités marqués dessus
 *   3. Pièces, par ordre de priorité
 *   4. Pastilles : solaire, réservé eau chaude, mesure disjoncteurs, kWh du jour
 *   5. Chemin de décision (6 priorités du flow)
 *   6. Réglages (toggle + sélecteur + sliders, repliable)
 *
 * Aucune dépendance hormis ha-icon (fourni par HA).
 */

const VERSION = '1.0.0';

console.info(
  `%c CLIM-SOLAIRE-CARD %c v${VERSION} `,
  'color: white; background: #00897b; font-weight: 700; padding: 2px 6px; border-radius: 3px 0 0 3px;',
  'color: #00897b; background: white; font-weight: 700; padding: 2px 6px; border: 1px solid #00897b; border-radius: 0 3px 3px 0;',
);

// Ordre = priorité d'affichage du hero, la première règle vraie gagne.
const MODES = {
  'disabled':      { color: '#9e9e9e', icon: 'mdi:robot-off',                   title: 'Automatisation désactivée', active: false },
  'grid-import':   { color: '#e53935', icon: 'mdi:transmission-tower-import',   title: 'Import réseau, délestage',  active: false },
  'breaker-off':   { color: '#e53935', icon: 'mdi:electric-switch',             title: 'Disjoncteur coupé',         active: false },
  'hot-water':     { color: '#26a69a', icon: 'mdi:water-boiler',                title: 'Surplus réservé à l\'eau chaude', active: false },
  'manual':        { color: '#8e24aa', icon: 'mdi:hand-back-right',             title: 'Pilotage manuel',           active: false },
  'cooling':       { color: '#1e88e5', icon: 'mdi:snowflake',                   title: 'Rafraîchissement gratuit',  active: true  },
  'heating':       { color: '#fb8c00', icon: 'mdi:fire',                        title: 'Chauffage gratuit',         active: true  },
  'mixed':         { color: '#43a047', icon: 'mdi:sun-snowflake-variant',       title: 'Confort gratuit',           active: true  },
  'deferred':      { color: '#fb8c00', icon: 'mdi:timer-sand',                  title: 'Temporisation compresseur', active: false },
  'sensor-error':  { color: '#e53935', icon: 'mdi:thermometer-off',             title: 'Températures illisibles',   active: false },
  'season-off':    { color: '#757575', icon: 'mdi:calendar-remove',             title: 'Hors saison',               active: false },
  'comfort-ok':    { color: '#1e88e5', icon: 'mdi:check-circle-outline',        title: 'Confort assuré',            active: false },
  'idle':          { color: '#1e88e5', icon: 'mdi:sleep',                       title: 'Veille',                    active: false },
};

const NEED = {
  cool: { icon: 'mdi:snowflake', color: '#1e88e5', label: 'froid' },
  heat: { icon: 'mdi:fire',      color: '#fb8c00', label: 'chaud' },
  none: { icon: 'mdi:minus',     color: 'var(--clc-text-2)', label: '—' },
};

const DEFAULT_CONTROLS = {
  enabled: {
    entity: 'input_boolean.clim_automation_enabled', label: 'Automatisation', type: 'toggle',
  },
  season: {
    entity: 'input_select.clim_season_mode', label: 'Mode saison', type: 'select',
    icon: 'mdi:sun-snowflake-variant', optional: true,
    desc: "Sens autorisé : auto suit la température extérieure, arrêt suspend tout",
  },
  target_cool: {
    entity: 'input_number.clim_target_cool', label: 'Cible rafraîchissement', type: 'slider',
    icon: 'mdi:snowflake', subtitleAttr: 'cool_store_target', subtitleLabel: 'stockage', subtitleUnit: '°C',
    desc: "Au-dessus, la pièce demande du froid. Le cycle descend ensuite jusqu'à la cible de stockage",
  },
  target_heat: {
    entity: 'input_number.clim_target_heat', label: 'Cible chauffage', type: 'slider',
    icon: 'mdi:fire', subtitleAttr: 'heat_store_target', subtitleLabel: 'stockage', subtitleUnit: '°C',
    desc: "En dessous, la pièce demande du chaud. Le cycle monte ensuite jusqu'à la cible de stockage",
  },
  surplus_trigger: {
    entity: 'input_number.clim_surplus_trigger', label: 'Seuil par unité', type: 'slider',
    icon: 'mdi:solar-power', optional: true,
    desc: "Surplus libre exigé pour allumer une unité de plus. Défaut : la puissance d'une unité",
  },
};

const CONTROL_ORDER = ['enabled', 'season', 'target_cool', 'target_heat', 'surplus_trigger'];

const nbsp = ' ';
const fmtW = (v) => (v == null || isNaN(v))
  ? '—'
  : `${Math.round(v).toLocaleString('fr-FR').replace(/\s/g, nbsp)}${nbsp}W`;
const fmtT = (v, digits = 1) => (v == null || isNaN(v)) ? '—' : `${Number(v).toFixed(digits)}${nbsp}°C`;
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

class ClimSolaireCard extends HTMLElement {
  static getStubConfig() {
    return { entity: 'sensor.clim_automation' };
  }

  static getConfigElement() {
    return document.createElement('clim-solaire-card-editor');
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error('Entité sensor.clim_automation requise');
    }
    const userControls = config.controls || {};
    const controls = {};
    for (const key of CONTROL_ORDER) {
      const def = DEFAULT_CONTROLS[key];
      const u = userControls[key];
      if (u === false || u === null) continue;
      if (typeof u === 'string') controls[key] = { ...def, entity: u };
      else if (u && typeof u === 'object') controls[key] = { ...def, ...u };
      else controls[key] = { ...def };
    }
    this._config = {
      show_settings: 'collapsible',   // 'collapsible' | 'expanded' | false
      show_units: true,
      ...config,
      controls,
    };
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._render();
  }

  getCardSize() {
    let size = 5;
    if (this._config && this._config.show_units) size += 3;
    if (this._config && this._config.show_settings === 'expanded') size += 3;
    return size;
  }

  // ---------- Build ----------

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <ha-card>
        <div class="accent" id="accent"></div>

        <div class="hero" id="hero">
          <div class="hero-icon" id="heroIcon">
            <ha-icon id="heroIconEl" icon="mdi:air-conditioner"></ha-icon>
          </div>
          <div class="hero-text">
            <div class="hero-title" id="heroTitle">—</div>
            <div class="hero-reason" id="heroReason">—</div>
          </div>
        </div>

        <div class="budget">
          <div class="budget-head">
            <span>Budget de surplus</span>
            <button class="info-btn" id="pathBtn" title="Chemin de décision" aria-label="Chemin de décision">
              <ha-icon icon="mdi:information-outline"></ha-icon>
            </button>
          </div>
          <div class="bar" id="bar">
            <div class="seg seg-hw"   id="segHw"></div>
            <div class="seg seg-clim" id="segClim"></div>
            <div class="seg seg-free" id="segFree"></div>
            <div class="ticks" id="ticks"></div>
          </div>
          <div class="legend" id="legend"></div>
          <div class="path" id="path"></div>
        </div>

        <div class="units" id="units"></div>

        <div class="pills" id="pills"></div>

        <div class="settings" id="settings">
          <button class="settings-toggle" id="settingsToggle">
            <ha-icon icon="mdi:cog-outline"></ha-icon>
            <span>Réglages</span>
            <ha-icon class="chev" id="settingsChev" icon="mdi:chevron-down"></ha-icon>
          </button>
          <div class="settings-body" id="settingsBody"></div>
        </div>
      </ha-card>
    `;

    const $ = (id) => this.shadowRoot.getElementById(id);
    this._el = {
      accent: $('accent'), hero: $('hero'), heroIcon: $('heroIcon'), heroIconEl: $('heroIconEl'),
      heroTitle: $('heroTitle'), heroReason: $('heroReason'),
      bar: $('bar'), segHw: $('segHw'), segClim: $('segClim'), segFree: $('segFree'),
      ticks: $('ticks'), legend: $('legend'), path: $('path'), pathBtn: $('pathBtn'),
      units: $('units'), pills: $('pills'),
      settings: $('settings'), settingsToggle: $('settingsToggle'),
      settingsChev: $('settingsChev'), settingsBody: $('settingsBody'),
    };

    this._el.hero.addEventListener('click', () => this._moreInfo(this._config.entity));
    this._el.pathBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._pathOpen = !this._pathOpen;
      this._el.path.classList.toggle('open', this._pathOpen);
    });
    this._el.settingsToggle.addEventListener('click', () => {
      this._settingsOpen = !this._settingsOpen;
      this._applySettingsOpen();
    });

    this._settingsOpen = this._config.show_settings === 'expanded';
    this._pathOpen = false;
    this._built = true;
  }

  _applySettingsOpen() {
    const open = this._settingsOpen || this._config.show_settings === 'expanded';
    this._el.settingsBody.classList.toggle('open', open);
    this._el.settingsChev.setAttribute('icon', open ? 'mdi:chevron-up' : 'mdi:chevron-down');
    this._el.settingsToggle.style.display =
      this._config.show_settings === 'expanded' ? 'none' : '';
  }

  // ---------- Render ----------

  _render() {
    const st = this._hass && this._hass.states[this._config.entity];
    if (!st) {
      this._el.heroTitle.textContent = 'Entité introuvable';
      this._el.heroReason.textContent = this._config.entity;
      return;
    }
    const a = st.attributes || {};
    this._attrs = a;
    const mode = MODES[this._mode(st, a)] || MODES.idle;

    this.style.setProperty('--clc-accent', mode.color);
    this._el.accent.classList.toggle('active', mode.active);
    this._el.heroIcon.classList.toggle('active', mode.active);
    this._el.heroIconEl.setAttribute('icon', mode.icon);
    this._el.heroTitle.textContent = st.state && st.state !== 'unknown' ? st.state : mode.title;
    this._el.heroReason.textContent = a.reason || '—';

    this._renderBudget(a);
    this._renderPath(a);
    this._renderUnits(a);
    this._renderPills(a);
    this._renderSettings(a);
  }

  _cutGroups(a) {
    return (Array.isArray(a.groups) ? a.groups : []).filter((g) => g && g.breaker_on === false);
  }

  _mode(st, a) {
    if (a.enabled === false) return 'disabled';
    if (a.grid_importing && a.hard_stop) return 'grid-import';
    // Le confort en cours prime sur l'avertissement disjoncteur : un groupe
    // hors tension pendant que l'autre rafraîchit ne justifie pas un hero
    // rouge. L'information reste portée par la légende et la liste des pièces.
    if (a.preempted_by_hot_water && (a.active_count || 0) === 0) return 'hot-water';
    if ((a.active_count || 0) > 0) {
      if (a.shed_deferred) return 'deferred';
      const modes = (a.units || []).filter((u) => u.desired === 'on' && u.owned).map((u) => u.need_mode);
      const cool = modes.indexOf('cool') !== -1;
      const heat = modes.indexOf('heat') !== -1;
      if (cool && heat) return 'mixed';
      return heat ? 'heating' : 'cooling';
    }
    if (this._cutGroups(a).length > 0) return 'breaker-off';
    if ((a.manual_count || 0) > 0 && (a.need_count || 0) === 0) return 'manual';
    if (a.any_temp_available === false) return 'sensor-error';
    if ((a.tier_pending_min || 0) > 0) return 'deferred';
    if (a.can_cool === false && a.can_heat === false) return 'season-off';
    if ((a.need_count || 0) === 0) return 'comfort-ok';
    return 'idle';
  }

  // --- Barre de budget : eau chaude / clim / libre, paliers marqués ---
  _renderBudget(a) {
    const reserve = Math.max(0, Number(a.cumulus_reserve_w) || 0);
    const draw = Math.max(0, Number(a.clim_draw_recoverable) || 0);
    const avail = Number(a.available_w) || 0;
    const trig = Math.max(1, Number(a.surplus_trigger_per_unit) || 800);
    const free = Math.max(0, avail - draw);
    const importing = a.grid_importing === true;

    // Échelle : au moins un palier de plus que ce qui est occupé, pour que la
    // prochaine marche reste visible.
    const used = reserve + draw + free;
    const scale = Math.max(used, reserve + trig * ((a.active_count || 0) + 1), trig);

    const pct = (v) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
    this._el.segHw.style.width = pct(reserve);
    this._el.segClim.style.width = pct(draw);
    this._el.segFree.style.width = pct(free);
    this._el.bar.classList.toggle('importing', importing);

    // Paliers, comptés à partir de la fin de la réservation eau chaude
    const maxTicks = Math.min(Number(a.max_units) || 5, 6);
    let ticks = '';
    for (let k = 1; k <= maxTicks; k++) {
      const at = reserve + trig * k;
      if (at > scale) break;
      const reached = avail >= trig * k;
      ticks += `<div class="tick${reached ? ' reached' : ''}" style="left:${(at / scale) * 100}%">`
        + `<span>${k}</span></div>`;
    }
    this._el.ticks.innerHTML = ticks;

    const item = (cls, label, value) =>
      `<div class="leg"><i class="${cls}"></i><span class="leg-l">${esc(label)}</span>`
      + `<span class="leg-v">${esc(value)}</span></div>`;

    let legend = '';
    if (reserve > 0) legend += item('seg-hw', `Eau chaude (jusqu'à ${fmtT(a.hot_water_priority_temp, 0)})`, fmtW(reserve));
    if (draw > 0) legend += item('seg-clim', `Clim, ${a.active_count || 0} unité(s)`, fmtW(draw));
    legend += item('seg-free', 'Libre', fmtW(free));
    if (importing) {
      legend += `<div class="leg warn"><ha-icon icon="mdi:transmission-tower-import"></ha-icon>`
        + `<span class="leg-l">Import réseau en cours</span></div>`;
    }
    const cut = this._cutGroups(a);
    if (cut.length > 0) {
      legend += `<div class="leg warn"><ha-icon icon="mdi:electric-switch"></ha-icon>`
        + `<span class="leg-l">Disjoncteur ${esc(cut.map((g) => g.name).join(', '))}`
        + ` hors tension</span></div>`;
    }
    this._el.legend.innerHTML = legend;
  }

  // --- Chemin de décision : 6 priorités du flow ---
  _renderPath(a) {
    const steps = [];
    const push = (label, state, detail) => steps.push({ label, state, detail });
    let decided = false;
    const mark = (ok, label, detail) => {
      if (decided) { push(label, 'skip', detail); return; }
      if (!ok) { decided = true; push(label, 'stop', detail); return; }
      push(label, 'pass', detail);
    };

    mark(a.enabled !== false, '1. Automatisation active',
      a.enabled === false ? 'désactivée, aucune commande' : 'activée');

    const outOfScope = (a.manual_count || 0) + (a.hold_count || 0);
    mark(true, '2. Pièces dans le périmètre',
      outOfScope > 0 ? `${outOfScope} hors périmètre (manuel ou pause)` : 'toutes disponibles');

    mark((a.need_count || 0) > 0, '3. Besoin de confort',
      `${a.need_count || 0} pièce(s) en demande sur ${a.unit_count || 0}`);

    mark(!a.preempted_by_hot_water, '4. Eau chaude servie',
      a.cumulus_reserve_reason || '—');

    mark((a.fundable_units || 0) > 0, '5. Palier de surplus',
      `${fmtW(a.available_w)} libre → ${a.fundable_units || 0} unité(s) finançable(s)`
      + ((a.tier_pending_min || 0) > 0 ? `, confirmation ${a.tier_pending_min} min` : ''));

    mark(!a.shed_deferred, '6. Anti court-cycle',
      a.shed_deferred
        ? `arrêt de ${a.shed_blocked_by || '?'} en attente du min-run`
        : `${a.active_count || 0} unité(s) en marche`);

    this._el.path.innerHTML = steps.map((s) => `
      <div class="step ${s.state}">
        <ha-icon icon="${s.state === 'pass' ? 'mdi:check' : s.state === 'stop' ? 'mdi:arrow-right-bold' : 'mdi:minus'}"></ha-icon>
        <div>
          <div class="step-l">${esc(s.label)}</div>
          <div class="step-d">${esc(s.detail)}</div>
        </div>
      </div>`).join('');
  }

  // --- Pièces, par ordre de priorité ---
  _renderUnits(a) {
    if (!this._config.show_units || !Array.isArray(a.units) || a.units.length === 0) {
      this._el.units.innerHTML = '';
      this._el.units.style.display = 'none';
      return;
    }
    this._el.units.style.display = '';

    // Le réordonnancement n'est proposé que si le helper existe réellement :
    // sans lui, l'ordre vient de CLIM_UNITS et n'est pas modifiable d'ici.
    const helper = a.priority_helper;
    const canReorder = !!(helper && this._hass.states[helper]);
    if (!canReorder) this._reorder = false;

    // Affichage optimiste : le flow met quelques secondes à republier son
    // sensor, l'ordre demandé est donc appliqué localement en attendant.
    const units = a.units.slice();
    if (this._pendingOrder) {
      const live = units.map((u) => u.entity_id).join(',');
      if (live === this._pendingOrder.join(',') || Date.now() - this._pendingAt > 30000) {
        this._pendingOrder = null;
      } else {
        const rank = (u) => {
          const k = this._pendingOrder.indexOf(u.entity_id);
          return k < 0 ? 999 : k;
        };
        units.sort((x, y) => rank(x) - rank(y));
      }
    }

    const rows = units.map((u, i) => {
      const need = NEED[u.need_mode] || NEED.none;
      let badge = 'veille';
      let cls = 'idle';
      if (u.breaker_on === false) { badge = 'disjoncteur'; cls = 'err'; }
      else if (u.available === false) { badge = 'injoignable'; cls = 'err'; }
      else if (u.manual_control) { badge = 'manuel'; cls = 'manual'; }
      else if (u.hold_active) { badge = 'pause'; cls = 'manual'; }
      else if (u.desired === 'on' && u.owned) { badge = 'en marche'; cls = 'run'; }
      else if ((u.min_off_left_min || 0) > 0) { badge = `${u.min_off_left_min} min`; cls = 'wait'; }
      else if (u.mode_supported === false) { badge = 'mode absent'; cls = 'err'; }

      const target = u.store_target != null ? ` → ${fmtT(u.store_target)}` : '';
      const arrows = this._reorder ? `
          <span class="u-move">
            <button class="mv" data-mv="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}
                    title="Monter" aria-label="Monter">
              <ha-icon icon="mdi:chevron-up"></ha-icon>
            </button>
            <button class="mv" data-mv="down" data-i="${i}"
                    ${i === units.length - 1 ? 'disabled' : ''}
                    title="Descendre" aria-label="Descendre">
              <ha-icon icon="mdi:chevron-down"></ha-icon>
            </button>
          </span>` : '';
      return `
        <div class="unit ${cls}${this._reorder ? ' reordering' : ''}" data-entity="${esc(u.entity_id)}">
          <span class="u-pri">${i + 1}</span>
          <span class="u-name">
            ${esc(u.label)}
            ${u.group ? `<span class="u-group">${esc(u.group)}</span>` : ''}
          </span>
          <span class="u-temp">${u.current_temp != null ? fmtT(u.current_temp) : '—'}${target}</span>
          <span class="u-need" style="color:${need.color}">
            <ha-icon icon="${need.icon}"></ha-icon>
          </span>
          <span class="u-badge">${esc(badge)}</span>
          ${arrows}
        </div>`;
    }).join('');

    const head = `
      <div class="units-head">
        <span>Pièces, par priorité</span>
        ${canReorder ? `
          <button class="info-btn${this._reorder ? ' on' : ''}" id="reorderBtn"
                  title="Réordonner les priorités" aria-label="Réordonner les priorités">
            <ha-icon icon="${this._reorder ? 'mdi:check' : 'mdi:swap-vertical'}"></ha-icon>
          </button>` : ''}
      </div>`;
    const hint = this._reorder
      ? `<div class="reorder-hint">Ordre de service du surplus : le premier servi est
         le dernier délesté. Enregistré dans <code>${esc(helper)}</code>.</div>`
      : '';
    this._el.units.innerHTML = head + hint + rows;

    this._el.units.querySelectorAll('.unit').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.u-move')) return;   // une flèche n'est pas un tap de ligne
        this._moreInfo(el.dataset.entity);
      });
    });
    const btn = this.shadowRoot.getElementById('reorderBtn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._reorder = !this._reorder;
        this._render();
      });
    }
    this._el.units.querySelectorAll('.mv').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._movePriority(units, Number(el.dataset.i), el.dataset.mv === 'up' ? -1 : 1);
      });
    });
  }

  // Écrit le nouvel ordre dans le helper. Le flow y est abonné par un trigger,
  // la prise en compte est donc immédiate ; l'affichage est optimiste en
  // attendant que le sensor soit republié.
  _movePriority(units, index, delta) {
    const j = index + delta;
    if (j < 0 || j >= units.length) return;
    const order = units.map((u) => u.entity_id);
    [order[index], order[j]] = [order[j], order[index]];

    // Préfixe `climate.` retiré : un input_text plafonne à 255 caractères, et le
    // flow accepte aussi bien l'entity_id complet que sa partie utile.
    const value = order.map((id) => id.replace(/^climate\./, '')).join(',');
    if (value.length > 255) {
      console.error('CLIM-SOLAIRE-CARD : ordre trop long pour un input_text ('
        + value.length + ' > 255 caractères), écriture abandonnée.');
      return;
    }

    this._pendingOrder = order;
    this._pendingAt = Date.now();
    this._hass.callService('input_text', 'set_value',
      { entity_id: this._attrs.priority_helper, value });
    this._render();
  }

  _renderPills(a) {
    const pills = [];
    const pill = (icon, label, value, color) => pills.push(
      `<div class="pill"${color ? ` style="--pill:${color}"` : ''}>
        <ha-icon icon="${icon}"></ha-icon>
        <div><span class="p-v">${esc(value)}</span><span class="p-l">${esc(label)}</span></div>
      </div>`);

    pill('mdi:solar-power', 'production', fmtW(a.solar_power), '#fb8c00');
    pill('mdi:transmission-tower', 'surplus potentiel', fmtW(a.potential_surplus), '#43a047');
    if ((a.cumulus_reserve_w || 0) > 0) {
      pill('mdi:water-boiler', 'réservé eau chaude', fmtW(a.cumulus_reserve_w), '#26a69a');
    }
    if (a.clim_power_total_measured != null) {
      // Total mesuré aux disjoncteurs : il inclut les unités lancées à la main,
      // contrairement au récupérable affiché dans la barre.
      const extra = Math.round(a.clim_power_total_measured - (a.clim_draw_recoverable || 0));
      const label = extra > 50 ? `mesuré, dont ${fmtW(extra)} hors flow` : 'conso mesurée';
      pill('mdi:flash', label, fmtW(a.clim_power_total_measured), '#1e88e5');
    }
    if (a.observed_draw_per_unit_w != null) {
      const off = a.clim_load_w && Math.abs(a.observed_draw_per_unit_w - a.clim_load_w) > a.clim_load_w * 0.25;
      pill('mdi:tune-variant', off ? `à calibrer (réglé ${fmtW(a.clim_load_w)})` : 'par unité',
        fmtW(a.observed_draw_per_unit_w), off ? '#fb8c00' : '#757575');
    }
    if (a.clim_kwh_today != null) {
      pill('mdi:counter', 'aujourd\'hui', `${a.clim_kwh_today}${nbsp}kWh`, '#757575');
    }
    if (a.outdoor_temp != null) {
      pill('mdi:thermometer', 'extérieur', fmtT(a.outdoor_temp), '#757575');
    }
    this._el.pills.innerHTML = pills.join('');
  }

  // ---------- Réglages ----------

  _renderSettings(autoAttrs) {
    if (this._config.show_settings === false) {
      this._el.settings.style.display = 'none';
      return;
    }
    this._el.settings.style.display = '';
    this._applySettingsOpen();

    const hass = this._hass;
    let html = '';
    for (const key of CONTROL_ORDER) {
      const c = this._config.controls[key];
      if (!c) continue;
      const st = hass.states[c.entity];
      if (!st) {
        if (c.optional) continue;
        html += `<div class="row missing">${esc(c.label)} : <code>${esc(c.entity)}</code> introuvable</div>`;
        continue;
      }

      if (c.type === 'toggle') {
        html += `
          <div class="row">
            <div class="row-head">
              <span class="row-label">${esc(c.label)}</span>
              <label class="sw">
                <input type="checkbox" data-ctl="${key}" ${st.state === 'on' ? 'checked' : ''}>
                <span class="sw-track"></span>
              </label>
            </div>
          </div>`;
      } else if (c.type === 'select') {
        const opts = (st.attributes.options || [])
          .map((o) => `<option value="${esc(o)}"${o === st.state ? ' selected' : ''}>${esc(o)}</option>`)
          .join('');
        html += `
          <div class="row">
            <div class="row-head">
              <span class="row-label">${c.icon ? `<ha-icon icon="${c.icon}"></ha-icon>` : ''}${esc(c.label)}</span>
              <select class="sel" data-ctl="${key}">${opts}</select>
            </div>
            ${c.desc ? `<div class="row-desc">${esc(c.desc)}</div>` : ''}
          </div>`;
      } else {
        const min = Number(st.attributes.min != null ? st.attributes.min : 0);
        const max = Number(st.attributes.max != null ? st.attributes.max : 100);
        const step = Number(st.attributes.step != null ? st.attributes.step : 1);
        const unit = st.attributes.unit_of_measurement || '';
        const val = Number(st.state);
        let sub = '';
        if (c.subtitleAttr && autoAttrs[c.subtitleAttr] != null) {
          sub = `<span class="row-sub">${esc(c.subtitleLabel)} ${autoAttrs[c.subtitleAttr]}${esc(c.subtitleUnit || '')}</span>`;
        }
        html += `
          <div class="row">
            <div class="row-head">
              <span class="row-label">${c.icon ? `<ha-icon icon="${c.icon}"></ha-icon>` : ''}${esc(c.label)}</span>
              <span class="row-value">${isNaN(val) ? '—' : val}${esc(unit)} ${sub}</span>
            </div>
            <input type="range" data-ctl="${key}" min="${min}" max="${max}" step="${step}"
                   value="${isNaN(val) ? min : val}">
            ${c.desc ? `<div class="row-desc">${esc(c.desc)}</div>` : ''}
          </div>`;
      }
    }
    this._el.settingsBody.innerHTML = html;
    this._wireControls();
  }

  _wireControls() {
    this._el.settingsBody.querySelectorAll('[data-ctl]').forEach((el) => {
      const key = el.dataset.ctl;
      const c = this._config.controls[key];
      if (!c) return;
      if (el.type === 'checkbox') {
        el.addEventListener('change', () => {
          this._hass.callService('input_boolean', 'toggle', { entity_id: c.entity });
        });
      } else if (el.tagName === 'SELECT') {
        el.addEventListener('change', () => {
          this._hass.callService('input_select', 'select_option',
            { entity_id: c.entity, option: el.value });
        });
      } else {
        el.addEventListener('input', () => {
          const head = el.parentElement.querySelector('.row-value');
          if (head) head.childNodes[0].nodeValue = el.value;
        });
        // Envoi différé de 250 ms : le curseur ne spamme pas le bus HA
        el.addEventListener('change', () => {
          clearTimeout(this._debounce);
          const v = Number(el.value);
          this._debounce = setTimeout(() => {
            this._hass.callService('input_number', 'set_value',
              { entity_id: c.entity, value: v });
          }, 250);
        });
      }
    });
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    const ev = new Event('hass-more-info', { bubbles: true, composed: true });
    ev.detail = { entityId };
    this.dispatchEvent(ev);
  }

  // ---------- Styles ----------

  _css() {
    return `
      :host {
        --clc-accent: var(--primary-color);
        --clc-text: var(--primary-text-color);
        --clc-text-2: var(--secondary-text-color);
        --clc-divider: var(--divider-color, rgba(127,127,127,0.18));
      }
      ha-card { padding: 0; overflow: hidden; }

      .accent {
        position: relative; height: 4px; overflow: hidden;
        background: var(--clc-accent); transition: background 0.4s ease;
      }
      .accent.active::after {
        content: ''; position: absolute; top: 0; left: -40%; width: 40%; height: 100%;
        background: linear-gradient(90deg, rgba(255,255,255,0) 0%,
          rgba(255,255,255,0.5) 50%, rgba(255,255,255,0) 100%);
        animation: clc-shimmer 2.4s linear infinite;
      }
      @keyframes clc-shimmer { 0% { left: -40%; } 100% { left: 100%; } }

      .hero {
        display: grid; grid-template-columns: 56px 1fr; gap: 14px; align-items: center;
        padding: 14px 18px 8px 18px; cursor: pointer;
      }
      .hero-icon {
        width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center;
        background: color-mix(in srgb, var(--clc-accent) 16%, transparent);
        color: var(--clc-accent);
        transition: background 0.4s ease, color 0.4s ease, box-shadow 0.4s ease;
      }
      .hero-icon ha-icon { --mdc-icon-size: 28px; }
      .hero-icon.active {
        animation: clc-pulse 2.2s ease-in-out infinite;
        box-shadow: 0 0 18px -4px var(--clc-accent);
      }
      @keyframes clc-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      .hero-text { min-width: 0; }
      .hero-title { font-size: 1.05rem; font-weight: 600; color: var(--clc-text); line-height: 1.25; }
      .hero-reason {
        font-size: 0.82rem; color: var(--clc-text-2); line-height: 1.35; margin-top: 2px;
      }

      /* Budget */
      .budget { padding: 6px 18px 10px 18px; }
      .budget-head {
        display: flex; align-items: center; justify-content: space-between;
        font-size: 0.78rem; color: var(--clc-text-2); margin-bottom: 6px;
        text-transform: uppercase; letter-spacing: 0.04em;
      }
      .info-btn {
        background: none; border: none; padding: 0; cursor: pointer;
        color: var(--clc-text-2); display: grid; place-items: center;
      }
      .info-btn ha-icon { --mdc-icon-size: 18px; }

      .bar {
        position: relative; display: flex; height: 22px; border-radius: 11px;
        overflow: hidden; background: var(--clc-divider);
      }
      .bar.importing { box-shadow: inset 0 0 0 2px #e53935; }
      .seg { transition: width 0.5s ease; }
      .seg-hw   { background: #26a69a; }
      .seg-clim { background: var(--clc-accent); }
      .seg-free { background: color-mix(in srgb, #43a047 45%, transparent); }
      i.seg-hw, i.seg-clim, i.seg-free {
        display: inline-block; width: 10px; height: 10px; border-radius: 3px; flex: none;
      }
      .ticks { position: absolute; inset: 0; pointer-events: none; }
      .tick {
        position: absolute; top: 0; bottom: 0; width: 0;
        border-left: 2px dashed rgba(255,255,255,0.55);
      }
      .tick span {
        position: absolute; top: 50%; left: 3px; transform: translateY(-50%);
        font-size: 0.6rem; font-weight: 700; color: rgba(255,255,255,0.75);
      }
      .tick.reached { border-left-color: rgba(255,255,255,0.95); }
      .tick.reached span { color: #fff; }

      .legend {
        display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px;
        font-size: 0.78rem; color: var(--clc-text-2);
      }
      .leg { display: flex; align-items: center; gap: 6px; }
      .leg-v { font-weight: 600; color: var(--clc-text); }
      .leg.warn { color: #e53935; }
      .leg.warn ha-icon { --mdc-icon-size: 16px; }

      /* Chemin de décision */
      .path { display: none; margin-top: 10px; }
      .path.open { display: block; }
      .step {
        display: grid; grid-template-columns: 20px 1fr; gap: 8px; align-items: start;
        padding: 4px 0; font-size: 0.78rem;
      }
      .step ha-icon { --mdc-icon-size: 16px; margin-top: 1px; }
      .step-l { color: var(--clc-text); font-weight: 500; }
      .step-d { color: var(--clc-text-2); }
      .step.pass ha-icon { color: #43a047; }
      .step.stop ha-icon { color: var(--clc-accent); }
      .step.stop .step-l { font-weight: 700; }
      .step.skip { opacity: 0.42; }

      /* Pièces */
      .units { padding: 4px 18px 8px 18px; }
      .units-head {
        display: flex; align-items: center; justify-content: space-between;
        font-size: 0.78rem; color: var(--clc-text-2); text-transform: uppercase;
        letter-spacing: 0.04em; margin-bottom: 4px;
      }
      .info-btn.on { color: var(--clc-accent); }
      .reorder-hint {
        font-size: 0.72rem; color: var(--clc-text-2); line-height: 1.35;
        padding: 2px 0 6px 0;
      }
      .reorder-hint code { font-size: 0.68rem; }
      .unit.reordering { cursor: default; }
      .u-move { display: flex; gap: 2px; }
      .u-move .mv {
        background: none; border: 1px solid var(--clc-divider); border-radius: 6px;
        padding: 0; width: 26px; height: 24px; cursor: pointer;
        color: var(--clc-text); display: grid; place-items: center;
      }
      .u-move .mv[disabled] { opacity: 0.3; cursor: default; }
      .u-move .mv ha-icon { --mdc-icon-size: 16px; }
      .unit {
        display: grid; grid-template-columns: 18px 1fr auto 22px auto;
        gap: 8px; align-items: center; padding: 6px 0;
        border-top: 1px solid var(--clc-divider); font-size: 0.84rem; cursor: pointer;
      }
      .unit:first-of-type { border-top: none; }
      .u-pri {
        font-size: 0.7rem; font-weight: 700; color: var(--clc-text-2);
        text-align: center;
      }
      .u-name { color: var(--clc-text); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .u-group {
        font-size: 0.66rem; color: var(--clc-text-2); border: 1px solid var(--clc-divider);
        border-radius: 6px; padding: 0 4px; margin-left: 6px; white-space: nowrap;
      }
      .u-temp { color: var(--clc-text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .u-need ha-icon { --mdc-icon-size: 17px; }
      .u-badge {
        font-size: 0.68rem; padding: 2px 7px; border-radius: 9px; white-space: nowrap;
        background: var(--clc-divider); color: var(--clc-text-2);
      }
      .unit.run .u-badge { background: color-mix(in srgb, #43a047 22%, transparent); color: #2e7d32; }
      .unit.wait .u-badge { background: color-mix(in srgb, #fb8c00 22%, transparent); color: #ef6c00; }
      .unit.manual .u-badge { background: color-mix(in srgb, #8e24aa 20%, transparent); color: #6a1b9a; }
      .unit.err .u-badge { background: color-mix(in srgb, #e53935 20%, transparent); color: #c62828; }

      /* Pastilles */
      .pills {
        display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 18px 12px 18px;
      }
      .pill {
        display: flex; align-items: center; gap: 7px; flex: 1 1 130px;
        padding: 7px 10px; border-radius: 10px; background: var(--clc-divider);
      }
      .pill ha-icon { --mdc-icon-size: 19px; color: var(--pill, var(--clc-text-2)); }
      .pill div { display: flex; flex-direction: column; min-width: 0; }
      .p-v { font-size: 0.85rem; font-weight: 600; color: var(--clc-text); white-space: nowrap; }
      .p-l { font-size: 0.68rem; color: var(--clc-text-2); }

      /* Réglages */
      .settings { border-top: 1px solid var(--clc-divider); }
      .settings-toggle {
        width: 100%; display: flex; align-items: center; gap: 8px;
        padding: 10px 18px; background: none; border: none; cursor: pointer;
        color: var(--clc-text-2); font-size: 0.84rem; font-family: inherit;
      }
      .settings-toggle ha-icon { --mdc-icon-size: 18px; }
      .settings-toggle .chev { margin-left: auto; }
      .settings-body { display: none; padding: 0 18px 14px 18px; }
      .settings-body.open { display: block; }
      .row { padding: 8px 0; border-top: 1px solid var(--clc-divider); }
      .row:first-child { border-top: none; }
      .row.missing { color: #e53935; font-size: 0.78rem; }
      .row-head {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
      }
      .row-label {
        display: flex; align-items: center; gap: 6px;
        font-size: 0.86rem; color: var(--clc-text);
      }
      .row-label ha-icon { --mdc-icon-size: 17px; color: var(--clc-text-2); }
      .row-value { font-size: 0.86rem; font-weight: 600; color: var(--clc-text); }
      .row-sub { font-size: 0.7rem; font-weight: 400; color: var(--clc-text-2); }
      .row-desc { font-size: 0.72rem; color: var(--clc-text-2); margin-top: 4px; line-height: 1.35; }
      input[type=range] {
        width: 100%; margin-top: 8px; accent-color: var(--clc-accent);
      }
      .sel {
        font-family: inherit; font-size: 0.82rem; padding: 3px 6px; border-radius: 6px;
        border: 1px solid var(--clc-divider); background: transparent; color: var(--clc-text);
      }
      .sw { position: relative; display: inline-block; width: 38px; height: 20px; }
      .sw input { opacity: 0; width: 0; height: 0; }
      .sw-track {
        position: absolute; inset: 0; border-radius: 10px; cursor: pointer;
        background: var(--clc-divider); transition: background 0.25s ease;
      }
      .sw-track::before {
        content: ''; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px;
        border-radius: 50%; background: #fff; transition: transform 0.25s ease;
      }
      .sw input:checked + .sw-track { background: var(--clc-accent); }
      .sw input:checked + .sw-track::before { transform: translateX(18px); }

      @media (max-width: 460px) {
        .unit { grid-template-columns: 16px 1fr auto 20px; }
        .u-move { grid-column: -2 / -1; }
        .u-badge { grid-column: 2 / -1; justify-self: start; }
      }
    `;
  }
}

// ---------- Éditeur visuel ----------

const EDITOR_LABELS = {
  enabled: 'Automatisation', season: 'Mode saison', target_cool: 'Cible froid',
  target_heat: 'Cible chaud', surplus_trigger: 'Seuil par unité',
};

class ClimSolaireCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _emit(patch) {
    this._config = { ...this._config, ...patch };
    const ev = new Event('config-changed', { bubbles: true, composed: true });
    ev.detail = { config: this._config };
    this.dispatchEvent(ev);
  }

  _render() {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    const c = this._config;
    const ctl = c.controls || {};
    this.shadowRoot.innerHTML = `
      <style>
        .f { display: flex; flex-direction: column; gap: 12px; padding: 8px 0; }
        label { font-size: 0.82rem; color: var(--secondary-text-color); }
        input, select {
          width: 100%; box-sizing: border-box; font-family: inherit; font-size: 0.9rem;
          padding: 6px 8px; border-radius: 6px; color: var(--primary-text-color);
          border: 1px solid var(--divider-color, rgba(127,127,127,0.3)); background: transparent;
        }
        .hint { font-size: 0.72rem; color: var(--secondary-text-color); }
        fieldset { border: 1px solid var(--divider-color, rgba(127,127,127,0.3)); border-radius: 8px; }
        legend { font-size: 0.76rem; color: var(--secondary-text-color); }
      </style>
      <div class="f">
        <div>
          <label for="entity">Entité (sensor du flow)</label>
          <input id="entity" type="text" value="${esc(c.entity || 'sensor.clim_automation')}">
        </div>
        <div>
          <label for="show_settings">Panneau réglages</label>
          <select id="show_settings">
            <option value="collapsible"${c.show_settings !== 'expanded' && c.show_settings !== false ? ' selected' : ''}>Repliable</option>
            <option value="expanded"${c.show_settings === 'expanded' ? ' selected' : ''}>Toujours ouvert</option>
            <option value="false"${c.show_settings === false ? ' selected' : ''}>Masqué</option>
          </select>
        </div>
        <div>
          <label for="show_units">Liste des pièces</label>
          <select id="show_units">
            <option value="true"${c.show_units !== false ? ' selected' : ''}>Affichée</option>
            <option value="false"${c.show_units === false ? ' selected' : ''}>Masquée</option>
          </select>
        </div>
        <fieldset>
          <legend>Helpers (vide = défaut, « false » = ligne masquée)</legend>
          ${CONTROL_ORDER.map((k) => `
            <div>
              <label for="ctl-${k}">${esc(EDITOR_LABELS[k])}</label>
              <input id="ctl-${k}" data-ctl="${k}" type="text"
                     placeholder="${esc(DEFAULT_CONTROLS[k].entity)}"
                     value="${esc(typeof ctl[k] === 'string' ? ctl[k] : ctl[k] === false ? 'false' : '')}">
            </div>`).join('')}
        </fieldset>
      </div>`;

    const $ = (id) => this.shadowRoot.getElementById(id);
    $('entity').addEventListener('change', (e) => this._emit({ entity: e.target.value.trim() }));
    $('show_settings').addEventListener('change', (e) => {
      const v = e.target.value;
      this._emit({ show_settings: v === 'false' ? false : v });
    });
    $('show_units').addEventListener('change', (e) => {
      this._emit({ show_units: e.target.value === 'true' });
    });
    this.shadowRoot.querySelectorAll('[data-ctl]').forEach((el) => {
      el.addEventListener('change', () => {
        const controls = { ...(this._config.controls || {}) };
        const v = el.value.trim();
        if (!v) delete controls[el.dataset.ctl];
        else if (v === 'false') controls[el.dataset.ctl] = false;
        else controls[el.dataset.ctl] = v;
        this._emit({ controls });
      });
    });
  }
}

if (!customElements.get('clim-solaire-card-editor')) {
  customElements.define('clim-solaire-card-editor', ClimSolaireCardEditor);
}

if (!customElements.get('clim-solaire-card')) {
  customElements.define('clim-solaire-card', ClimSolaireCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'clim-solaire-card',
  name: 'Clim Solaire',
  description: "Carte tableau de bord pour la climatisation gratuite sur surplus solaire, eau chaude prioritaire",
  preview: false,
  documentationURL: 'https://github.com/LightD31/hacs-water',
});
