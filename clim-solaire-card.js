/**
 * Clim Solaire Card
 *
 * Custom Lovelace card pour le sensor.clim_automation produit par le flow
 * Node-RED « Climatisation Solaire » (flows-clim.json).
 *
 * Sections (mêmes composants que la carte cumulus) :
 *   1. Hero (état + raison, interrupteur d'automatisation avec confirmation)
 *   2. Budget de surplus : barre empilée eau chaude / clim / export, écart que
 *      le routeur corrige et action en cours (flow v2) ; paliers d'unités avec
 *      l'ancien flow
 *   3. Pièces, par ordre de priorité, avec consigne modulée et puissance
 *   4. Pastilles : solaire, mesure disjoncteurs, kWh du jour, prévision
 *   5. Chemin de décision (publié par le flow)
 *   6. Réglages (toggle + sélecteur + sliders, repliable)
 *
 * Les commandes (réglages, réordonnancement) sont verrouillées par défaut :
 * déverrouillage explicite, puis reverrouillage après une période d'inactivité.
 *
 * Aucune dépendance hormis ha-icon (fourni par HA).
 */

const VERSION = '2.1.0';

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
  'throttled':     { color: '#fb8c00', icon: 'mdi:speedometer-slow',            title: 'Ralenti, surplus en baisse', active: true },
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
    icon: 'mdi:robot',
  },
  season: {
    entity: 'input_select.clim_season_mode', label: 'Mode saison', type: 'select',
    icon: 'mdi:sun-snowflake-variant', optional: true,
    desc: "Sens autorisé : auto suit la prévision du jour, arrêt suspend tout",
  },
  target_cool: {
    entity: 'input_number.clim_target_cool', label: 'Cible rafraîchissement', type: 'slider',
    icon: 'mdi:snowflake', subtitleAttr: 'cool_store_target', subtitleLabel: 'stockage', subtitleUnit: '°C',
    desc: "Au-dessus, la pièce demande du froid. La consigne descend ensuite jusqu'au stockage tant qu'il y a du surplus",
  },
  target_heat: {
    entity: 'input_number.clim_target_heat', label: 'Cible chauffage', type: 'slider',
    icon: 'mdi:fire', subtitleAttr: 'heat_store_target', subtitleLabel: 'stockage', subtitleUnit: '°C',
    desc: "En dessous, la pièce demande du chaud. La consigne monte ensuite jusqu'au stockage tant qu'il y a du surplus",
  },
  import_allowance: {
    entity: 'input_number.clim_import_allowance', label: 'Tolérance d\'import', type: 'slider',
    icon: 'mdi:transmission-tower-import', optional: true,
    desc: "Import réseau accepté pour une pièce hors de sa cible. Le stockage reste au seul surplus",
  },
};

const CONTROL_ORDER = ['enabled', 'season', 'target_cool', 'target_heat', 'import_allowance'];

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
      hero_switch: true,              // interrupteur d'automatisation dans l'en-tête
      lock: true,                     // commandes verrouillées jusqu'à déverrouillage
      lock_timeout: 30,               // s d'inactivité avant reverrouillage
      admin_only: false,              // lecture seule pour les non-administrateurs
      ...config,
      controls,
    };
    this._built = false;
  }

  disconnectedCallback() {
    clearTimeout(this._lockTimer);
    this._cancelConfirm();
    this._unlocked = false;
    this._reorder = false;
  }

  // HA pousse un nouvel objet hass à chaque changement d'état de N'IMPORTE
  // quelle entité : la carte ne se redessine que si l'une des siennes a bougé.
  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    const fresh = !this._built;
    if (fresh) this._build();
    if (fresh || !prev || this._watchedChanged(prev, hass)) this._render();
  }

  _watchedChanged(prev, hass) {
    const admin = (h) => !!(h.user && h.user.is_admin);
    if (admin(prev) !== admin(hass)) return true;
    const ids = [this._config.entity];
    for (const c of Object.values(this._config.controls)) ids.push(c.entity);
    if (this._attrs && this._attrs.priority_helper) ids.push(this._attrs.priority_helper);
    return ids.some((id) => prev.states[id] !== hass.states[id]);
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
          <label class="switch hero-switch" id="heroSwitchWrap" title="Automatisation">
            <input type="checkbox" id="heroSwitch" aria-label="Automatisation">
            <span class="switch-track"><span class="switch-thumb"></span></span>
          </label>
        </div>
        <div class="hero-confirm" id="heroConfirm"></div>

        <div class="budget">
          <div class="budget-head section-title">
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

        <div class="chips" id="pills"></div>

        <div class="settings" id="settings">
          <button class="settings-toggle" id="settingsToggle">
            <span class="settings-toggle-label">
              <ha-icon icon="mdi:tune-variant"></ha-icon>
              <span>Réglages</span>
            </span>
            <ha-icon class="chevron" id="settingsChev" icon="mdi:chevron-down"></ha-icon>
          </button>
          <div class="settings-body" id="settingsBody"></div>
        </div>
      </ha-card>
    `;

    const $ = (id) => this.shadowRoot.getElementById(id);
    this._el = {
      accent: $('accent'), hero: $('hero'), heroIcon: $('heroIcon'), heroIconEl: $('heroIconEl'),
      heroTitle: $('heroTitle'), heroReason: $('heroReason'),
      heroSwitch: $('heroSwitch'), heroSwitchWrap: $('heroSwitchWrap'), heroConfirm: $('heroConfirm'),
      bar: $('bar'), segHw: $('segHw'), segClim: $('segClim'), segFree: $('segFree'),
      ticks: $('ticks'), legend: $('legend'), path: $('path'), pathBtn: $('pathBtn'),
      units: $('units'), pills: $('pills'),
      settings: $('settings'), settingsToggle: $('settingsToggle'),
      settingsChev: $('settingsChev'), settingsBody: $('settingsBody'),
    };

    this._el.hero.addEventListener('click', () => this._moreInfo(this._config.entity));

    // Interrupteur d'automatisation de l'en-tête. Hors du verrou des réglages,
    // il est donc gardé par une confirmation, dans les deux sens.
    this._el.heroSwitchWrap.addEventListener('click', (e) => e.stopPropagation());
    this._el.heroConfirm.addEventListener('click', (e) => e.stopPropagation());
    this._el.heroSwitch.addEventListener('change', () => {
      const sw = this._el.heroSwitch;
      const c = this._config.controls.enabled;
      const st = c && this._hass.states[c.entity];
      const isOn = !!st && st.state === 'on';
      sw.checked = isOn;   // l'interrupteur ne bouge qu'une fois confirmé
      if (!c || !st || this._readOnly()) return;
      this._confirm(this._el.heroConfirm,
        isOn ? 'Couper l\'automatisation ? Les unités ne seront plus pilotées.'
             : 'Réactiver l\'automatisation de la clim ?',
        isOn ? 'Couper' : 'Activer',
        () => this._setToggle(c.entity, !isOn));
    });

    this._el.pathBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._pathOpen = !this._pathOpen;
      this._el.path.classList.toggle('open', this._pathOpen);
      this._el.pathBtn.classList.toggle('on', this._pathOpen);
    });
    this._el.settingsToggle.addEventListener('click', () => {
      this._settingsOpen = !this._settingsOpen;
      this._applySettingsOpen();
      if (!this._settingsOpen && this._unlocked) this._relock();
    });

    this._settingsOpen = this._config.show_settings === 'expanded';
    this._pathOpen = false;
    this._settingsSig = null;
    this._built = true;
  }

  _applySettingsOpen() {
    const open = this._settingsOpen || this._config.show_settings === 'expanded';
    this._el.settingsBody.classList.toggle('open', open);
    this._el.settingsToggle.classList.toggle('expanded', open);
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

    this._renderHeroSwitch();
    this._renderBudget(a);
    this._renderPath(a);
    this._renderUnits(a);
    this._renderPills(a);
    this._renderSettings(a);
  }

  _renderHeroSwitch() {
    const c = this._config.controls.enabled;
    const st = c && this._hass.states[c.entity];
    const show = this._config.hero_switch !== false && !!st;
    this._el.heroSwitchWrap.style.display = show ? '' : 'none';
    this._el.hero.classList.toggle('with-switch', show);
    if (!show) return;
    this._el.heroSwitch.checked = st.state === 'on';
    this._el.heroSwitch.disabled = this._readOnly();
  }

  _cutGroups(a) {
    return (Array.isArray(a.groups) ? a.groups : []).filter((g) => g && g.breaker_on === false);
  }

  _mode(st, a) {
    if (a.enabled === false) return 'disabled';
    // Flow v2 (routeur) : consignes modulées, plus de paliers ni de réservation.
    if (a.router_action !== undefined) {
      if ((a.active_count || 0) > 0) {
        if (String(st.state || '').indexOf('Ralenti') === 0) return a.cumulus_heating ? 'hot-water' : 'throttled';
        const modes = (a.units || []).filter((u) => u.desired === 'on' && u.owned).map((u) => u.need_mode);
        const cool = modes.indexOf('cool') !== -1, heat = modes.indexOf('heat') !== -1;
        return cool && heat ? 'mixed' : heat ? 'heating' : 'cooling';
      }
      if (this._cutGroups(a).length > 0) return 'breaker-off';
      if ((a.manual_count || 0) > 0 && (a.need_count || 0) === 0) return 'manual';
      if (a.any_temp_available === false) return 'sensor-error';
      if (a.router_action === 'start_pending') return 'deferred';
      if (a.cumulus_heating && (a.need_count || 0) > 0) return 'hot-water';
      if (a.can_cool === false && a.can_heat === false) return 'season-off';
      if ((a.need_count || 0) === 0) return 'comfort-ok';
      return 'idle';
    }
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

  // --- Barre de budget, flow v2 : eau chaude / clim / export ---
  // Le routeur vise un export proche de la marge : la barre montre où part le
  // surplus, et l'écart que la boucle est en train de corriger.
  _renderRouterBudget(a) {
    const hw = a.cumulus_heating ? Math.max(0, Number(a.cumulus_draw_w) || 0) : 0;
    const clim = Math.max(0, Number(a.recoverable_w) || 0);
    const exp = Number(a.export_avg_w) || 0;
    const free = Math.max(0, exp - (Number(a.cumulus_yield_w) || 0));
    const importing = exp < -50;
    const scale = Math.max(1, hw + clim + free);
    const pct = (v) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
    this._el.segHw.style.width = pct(hw);
    this._el.segClim.style.width = pct(clim);
    this._el.segFree.style.width = pct(free);
    this._el.bar.classList.toggle('importing', importing);
    this._el.ticks.innerHTML = '';

    const item = (cls, label, value) =>
      `<div class="leg"><i class="${cls}"></i><span class="leg-l">${esc(label)}</span>`
      + `<span class="leg-v">${esc(value)}</span></div>`;
    let legend = '';
    if (hw > 0) legend += item('seg-hw', 'Eau chaude, prioritaire', fmtW(hw));
    if (clim > 0) legend += item('seg-clim', `Clim, ${a.active_count || 0} unité(s)`, fmtW(clim));
    legend += item('seg-free', importing ? 'Import' : 'Export', fmtW(Math.abs(exp)));
    const act = {
      deepen: 'consigne approfondie', relax: 'consigne relâchée', start: 'démarrage',
      start_pending: 'démarrage en confirmation', stop: 'arrêt', stop_pending: 'arrêt en attente',
    }[a.router_action];
    legend += `<div class="leg"><ha-icon icon="mdi:sine-wave"></ha-icon>`
      + `<span class="leg-l">Écart ${a.error_w > 0 ? '+' : ''}${fmtW(a.error_w)}`
      + `${act ? ' · ' + esc(act) : ''}</span></div>`;
    if (a.allowance_active && (a.import_allowance_w || 0) > 0) {
      legend += `<div class="leg"><ha-icon icon="mdi:transmission-tower-import"></ha-icon>`
        + `<span class="leg-l">Tolérance d'import ${fmtW(a.import_allowance_w)} (pièce hors cible)</span></div>`;
    }
    const cut = this._cutGroups(a);
    if (cut.length > 0) {
      legend += `<div class="leg warn"><ha-icon icon="mdi:electric-switch"></ha-icon>`
        + `<span class="leg-l">Disjoncteur ${esc(cut.map((g) => g.name).join(', '))} hors tension</span></div>`;
    }
    this._el.legend.innerHTML = legend;
  }

  // --- Barre de budget : eau chaude / clim / libre, paliers marqués ---
  _renderBudget(a) {
    if (a.router_action !== undefined) { this._renderRouterBudget(a); return; }
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
  // Même échelle que la carte cumulus : règle décisive en gras, valeurs à droite
  _ladderHtml(steps) {
    return `
      <div class="ladder">
        <div class="ladder-title">Chemin de décision</div>
        ${steps.map((s) => `
          <div class="ladder-row st-${s.status}">
            <ha-icon icon="${s.status === 'fired' ? 'mdi:arrow-right-bold-circle'
                          : s.status === 'pass' ? 'mdi:check' : 'mdi:minus'}"></ha-icon>
            <span class="ladder-label">${esc(s.label)}</span>
            <span class="ladder-note">${esc(s.detail || '')}</span>
          </div>`).join('')}
      </div>`;
  }

  _renderPath(a) {
    if (Array.isArray(a.decision_path) && a.decision_path.length) {
      this._el.path.innerHTML = this._ladderHtml(a.decision_path.map((s) => ({
        label: s.label, detail: s.detail,
        status: s.status === 'hit' ? 'fired' : s.status === 'pass' ? 'pass' : 'skip',
      })));
      return;
    }
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

    this._el.path.innerHTML = this._ladderHtml(steps.map((s) => ({
      label: s.label, detail: s.detail, status: s.state === 'stop' ? 'fired' : s.state,
    })));
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
    const canReorder = !!(helper && this._hass.states[helper]) && !this._readOnly();
    if (!canReorder || this._locked()) this._reorder = false;

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

      const sp = u.target_setpoint != null ? u.target_setpoint : u.store_target;
      const target = (sp != null && (u.desired === 'on' || u.store_target != null)) ? ` → ${fmtT(sp)}` : '';
      const power = (u.power_w || 0) > 0 ? ` · ${fmtW(u.power_w)}` : '';
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
          <span class="u-temp">${u.current_temp != null ? fmtT(u.current_temp) : '—'}${target}${power}</span>
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
        ${canReorder && this._locked() ? `
          <button class="info-btn" data-lock="unlock"
                  title="Déverrouiller pour réordonner" aria-label="Déverrouiller pour réordonner">
            <ha-icon icon="mdi:lock-outline"></ha-icon>
          </button>` : ''}
        ${canReorder && !this._locked() ? `
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
        if (this._locked()) return;
        this._reorder = !this._reorder;
        this._armRelock();
        this._render();
      });
    }
    this._wireLock(this._el.units);
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
    if (this._locked()) return;
    this._armRelock();
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
      `<div class="chip" style="--chip-color:${color || 'var(--clc-text-2)'}">
        <ha-icon icon="${icon}"></ha-icon>
        <div class="chip-text"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div></div>
      </div>`);

    pill('mdi:solar-power-variant', 'Production', fmtW(a.solar_power), '#ffb300');
    if (a.router_action !== undefined) {
      pill('mdi:flash', a.clim_power_total_w > (a.recoverable_w || 0) + 50
        ? `Clim, dont ${fmtW(a.clim_power_total_w - (a.recoverable_w || 0))} à la main` : 'Clim',
        fmtW(a.clim_power_total_w), '#1e88e5');
      if (a.clim_kwh_today != null) {
        pill('mdi:counter', a.clim_solar_share_today != null
          ? `Aujourd'hui · ${a.clim_solar_share_today} % solaire` : 'Aujourd\'hui',
          `${a.clim_kwh_today}${nbsp}kWh`, '#757575');
      }
      if (a.outdoor_temp != null) pill('mdi:thermometer', `Extérieur (${a.outdoor_source || '?'})`, fmtT(a.outdoor_temp), '#757575');
      if (a.forecast_today_max != null) {
        pill('mdi:weather-partly-cloudy', 'Prévision du jour',
          `${Math.round(a.forecast_today_min)}–${Math.round(a.forecast_today_max)}${nbsp}°C`, '#757575');
      }
      this._el.pills.innerHTML = pills.join('');
      return;
    }
    pill('mdi:transmission-tower', 'Surplus potentiel', fmtW(a.potential_surplus), '#43a047');
    if ((a.cumulus_reserve_w || 0) > 0) {
      pill('mdi:water-boiler', 'Réservé eau chaude', fmtW(a.cumulus_reserve_w), '#26a69a');
    }
    if (a.clim_power_total_measured != null) {
      // Total mesuré aux disjoncteurs : il inclut les unités lancées à la main,
      // contrairement au récupérable affiché dans la barre.
      const extra = Math.round(a.clim_power_total_measured - (a.clim_draw_recoverable || 0));
      const label = extra > 50 ? `Mesuré, dont ${fmtW(extra)} hors flow` : 'Conso mesurée';
      pill('mdi:flash', label, fmtW(a.clim_power_total_measured), '#1e88e5');
    }
    if (a.observed_draw_per_unit_w != null) {
      const off = a.clim_load_w && Math.abs(a.observed_draw_per_unit_w - a.clim_load_w) > a.clim_load_w * 0.25;
      pill('mdi:tune-variant', off ? `À calibrer (réglé ${fmtW(a.clim_load_w)})` : 'Par unité',
        fmtW(a.observed_draw_per_unit_w), off ? '#fb8c00' : '#757575');
    }
    if (a.clim_kwh_today != null) {
      pill('mdi:counter', 'Aujourd\'hui', `${a.clim_kwh_today}${nbsp}kWh`, '#757575');
    }
    if (a.outdoor_temp != null) {
      pill('mdi:thermometer', 'Extérieur', fmtT(a.outdoor_temp), '#757575');
    }
    this._el.pills.innerHTML = pills.join('');
  }

  // ---------- Réglages ----------

  // Le panneau n'est reconstruit que si sa structure change (helper apparu ou
  // disparu, options d'un sélecteur, verrou). Sinon les valeurs sont mises à
  // jour en place : un curseur tenu ne saute plus à chaque republication.
  _renderSettings(autoAttrs) {
    if (this._config.show_settings === false) {
      this._el.settings.style.display = 'none';
      return;
    }
    this._el.settings.style.display = '';
    this._applySettingsOpen();

    const hass = this._hass;
    const sig = [this._locked(), this._readOnly(), this._config.lock !== false];
    for (const key of CONTROL_ORDER) {
      const c = this._config.controls[key];
      const st = c && hass.states[c.entity];
      sig.push(key, !c ? 'x' : !st ? 'missing'
        : c.type === 'select' ? (st.attributes.options || []).join('|') : 'ok');
    }
    const signature = JSON.stringify(sig);
    if (signature !== this._settingsSig) {
      this._settingsSig = signature;
      this._buildSettings();
    }
    this._updateSettings(autoAttrs);
  }

  _buildSettings() {
    const hass = this._hass;
    const dis = this._locked() ? ' disabled' : '';
    let html = this._lockRowHtml();
    for (const key of CONTROL_ORDER) {
      const c = this._config.controls[key];
      if (!c) continue;
      const st = hass.states[c.entity];
      if (!st) {
        if (c.optional) continue;
        html += `<div class="setting-row missing">${esc(c.label)} : <code>${esc(c.entity)}</code> introuvable</div>`;
        continue;
      }
      const label = `<div class="setting-label">${c.icon ? `<ha-icon icon="${c.icon}"></ha-icon>` : ''}<span>${esc(c.label)}</span></div>`;
      const desc = c.desc ? `<div class="setting-desc">${esc(c.desc)}</div>` : '';

      if (c.type === 'toggle') {
        html += `
          <div class="setting-row toggle-row" data-row="${key}">
            ${label}
            <label class="switch">
              <input type="checkbox" data-ctl="${key}"${dis}>
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>`;
      } else if (c.type === 'select') {
        const opts = (st.attributes.options || [])
          .map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
        html += `
          <div class="setting-row" data-row="${key}">
            <div class="setting-header">
              ${label}
              <select class="sel" data-ctl="${key}"${dis}>${opts}</select>
            </div>
            ${desc}
          </div>`;
      } else {
        html += `
          <div class="setting-row" data-row="${key}">
            <div class="setting-header">
              ${label}
              <div class="setting-value">
                <span class="setting-value-main" data-rv="${key}">—</span>
                <span class="setting-value-sub" data-sub="${key}"></span>
              </div>
            </div>
            ${desc}
            <input type="range" class="slider" data-ctl="${key}"${dis}>
          </div>`;
      }
    }
    this._el.settingsBody.classList.toggle('locked', !!dis);
    this._el.settingsBody.innerHTML = html;
    this._wireControls();
    this._wireLock(this._el.settingsBody);
  }

  _updateSettings(autoAttrs) {
    const body = this._el.settingsBody;
    body.querySelectorAll('[data-ctl]').forEach((el) => {
      const c = this._config.controls[el.dataset.ctl];
      const st = c && this._hass.states[c.entity];
      if (!st) return;
      if (el.type === 'checkbox') {
        // Coupure en attente de confirmation : l'interrupteur reste sur l'état réel
        el.checked = st.state === 'on';
      } else if (el.tagName === 'SELECT') {
        if (this.shadowRoot.activeElement !== el) el.value = st.state;
      } else {
        const a = st.attributes;
        el.min = a.min != null ? a.min : 0;
        el.max = a.max != null ? a.max : 100;
        el.step = a.step != null ? a.step : 1;
        const val = Number(st.state);
        // Valeur envoyée en attente de retour de HA : on la garde affichée
        // plutôt que de revenir un instant sur l'ancienne.
        const held = el._sent != null && Date.now() < el._sentUntil && Number(el._sent) !== val;
        if (!held) el._sent = null;
        if (!el._dragging && !held && !isNaN(val)) {
          el.value = val;
          this._updateSliderFill(el);
          this._showSliderValue(el, c, st);
        }
        const sub = body.querySelector(`[data-sub="${el.dataset.ctl}"]`);
        if (sub) {
          const v = c.subtitleAttr ? autoAttrs[c.subtitleAttr] : null;
          sub.textContent = v != null
            ? `${c.subtitleLabel} ${v}${c.subtitleUnit ? nbsp + c.subtitleUnit : ''}` : '';
        }
      }
    });
  }

  _showSliderValue(el, c, st) {
    const rv = this._el.settingsBody.querySelector(`[data-rv="${el.dataset.ctl}"]`);
    if (!rv) return;
    const step = Number(el.step) || 1;
    const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    const unit = (st && st.attributes.unit_of_measurement) || '';
    rv.textContent = `${Number(el.value).toFixed(digits)}${unit ? nbsp + unit : ''}`;
  }

  _updateSliderFill(el) {
    const min = Number(el.min) || 0;
    const max = Number(el.max) || 100;
    const pct = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0;
    el.style.setProperty('--fill-pct', `${pct}%`);
  }

  // ---------- Verrou ----------

  // Lecture seule imposée : option admin_only et utilisateur non administrateur.
  // Garde-fou d'interface uniquement, les droits réels restent ceux de HA.
  _readOnly() {
    const u = this._hass && this._hass.user;
    return !!(this._config.admin_only && u && !u.is_admin);
  }

  _locked() {
    if (this._readOnly()) return true;
    return this._config.lock !== false && !this._unlocked;
  }

  _lockTimeoutMs() {
    const s = Number(this._config.lock_timeout);
    return (isFinite(s) && s > 0 ? s : 30) * 1000;
  }

  _unlock() {
    if (this._readOnly()) return;
    this._unlocked = true;
    this._armRelock();
    this._render();
  }

  _relock() {
    clearTimeout(this._lockTimer);
    this._cancelConfirm();
    this._unlocked = false;
    this._reorder = false;
    if (this._hass) this._render();
  }

  // Chaque interaction repousse le reverrouillage : il ne survient qu'après
  // une vraie période d'inactivité, jamais au milieu d'un réglage.
  _armRelock() {
    if (this._config.lock === false) return;
    clearTimeout(this._lockTimer);
    this._lockTimer = setTimeout(() => this._relock(), this._lockTimeoutMs());
  }

  _lockRowHtml() {
    if (this._readOnly()) {
      return `<div class="lock-row"><ha-icon icon="mdi:lock-outline"></ha-icon>
        <span class="lock-l">Lecture seule, réglages réservés aux administrateurs</span></div>`;
    }
    if (this._config.lock === false) return '';
    if (this._locked()) {
      return `<div class="lock-row"><ha-icon icon="mdi:lock-outline"></ha-icon>
        <span class="lock-l">Réglages verrouillés</span>
        <button class="lock-btn" data-lock="unlock">Déverrouiller</button></div>`;
    }
    return `<div class="lock-row open"><ha-icon icon="mdi:lock-open-variant-outline"></ha-icon>
      <span class="lock-l">Déverrouillé, reverrouillage après
        ${Math.round(this._lockTimeoutMs() / 1000)}${nbsp}s d'inactivité</span>
      <button class="lock-btn" data-lock="lock">Verrouiller</button></div>`;
  }

  _wireLock(root) {
    root.querySelectorAll('[data-lock]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (el.dataset.lock === 'unlock') this._unlock();
        else this._relock();
      });
    });
  }

  _wireControls() {
    this._el.settingsBody.querySelectorAll('[data-ctl]').forEach((el) => {
      const key = el.dataset.ctl;
      const c = this._config.controls[key];
      if (!c) return;
      const domain = c.entity.split('.')[0];
      if (el.type === 'checkbox') {
        el.addEventListener('change', () => {
          if (this._locked()) { el.checked = !el.checked; return; }
          this._armRelock();
          const on = el.checked;
          if (on || key !== 'enabled') { this._setToggle(c.entity, on); return; }
          // Couper l'automatisation laisse les unités sans pilote : confirmation
          el.checked = true;
          this._confirm(el.closest('.setting-row'),
            'Couper l\'automatisation ? Les unités ne seront plus pilotées.', 'Couper',
            () => this._setToggle(c.entity, false));
        });
      } else if (el.tagName === 'SELECT') {
        el.addEventListener('change', () => {
          if (this._locked()) return;
          this._armRelock();
          const svc = domain === 'select' ? 'select' : 'input_select';
          this._hass.callService(svc, 'select_option', { entity_id: c.entity, option: el.value });
        });
      } else {
        // Glissé : affichage seul. Envoi au relâché uniquement, une valeur
        // intermédiaire ne part jamais vers HA.
        const stopDrag = () => { el._dragging = false; };
        el.addEventListener('pointerdown', () => { el._dragging = true; });
        el.addEventListener('pointerup', stopDrag);
        el.addEventListener('pointercancel', stopDrag);
        el.addEventListener('input', () => {
          this._armRelock();
          this._updateSliderFill(el);
          this._showSliderValue(el, c, this._hass.states[c.entity]);
        });
        el.addEventListener('change', () => {
          el._dragging = false;
          if (this._locked()) return;
          this._armRelock();
          const v = Number(el.value);
          el._sent = v;
          el._sentUntil = Date.now() + 5000;
          const svc = domain === 'number' ? 'number' : 'input_number';
          this._hass.callService(svc, 'set_value', { entity_id: c.entity, value: v });
        });
      }
    });
  }

  // Service explicite on/off plutôt que toggle : si l'état a changé entre-temps
  // (autre écran, automatisation), un toggle ferait l'inverse de ce qui est vu.
  _setToggle(entityId, on) {
    const domain = entityId.split('.')[0];
    const svc = domain === 'input_boolean' || domain === 'switch' ? domain : 'homeassistant';
    this._hass.callService(svc, on ? 'turn_on' : 'turn_off', { entity_id: entityId });
  }

  // Barre de confirmation sous la ligne concernée, annulée d'elle-même après 8 s
  _confirm(anchor, text, okLabel, onOk) {
    this._cancelConfirm();
    if (!anchor) return;
    const bar = document.createElement('div');
    bar.className = 'confirm';
    bar.innerHTML = `<span class="confirm-l">${esc(text)}</span>
      <button class="confirm-btn" data-c="no">Annuler</button>
      <button class="confirm-btn ok" data-c="yes">${esc(okLabel)}</button>`;
    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-c]');
      if (!b) return;
      this._cancelConfirm();
      if (b.dataset.c === 'yes' && !this._readOnly()) onOk();
    });
    anchor.appendChild(bar);
    this._confirmBar = bar;
    this._confirmTimer = setTimeout(() => this._cancelConfirm(), 8000);
  }

  _cancelConfirm() {
    clearTimeout(this._confirmTimer);
    if (this._confirmBar) this._confirmBar.remove();
    this._confirmBar = null;
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

      /* Composants partagés avec la carte cumulus (mêmes valeurs) :
         en-tête, titres de section, bouton info, chemin de décision,
         tuiles, réglages, curseur, interrupteur, verrou, confirmation. */
      .hero {
        display: grid; grid-template-columns: 56px 1fr; gap: 14px; align-items: center;
        padding: 14px 18px 8px 18px; cursor: pointer;
      }
      .hero.with-switch { grid-template-columns: 56px 1fr auto; }
      .hero-switch input:disabled ~ .switch-track { opacity: 0.5; cursor: not-allowed; }
      .hero-confirm { padding: 0 18px; }
      .hero-confirm .confirm { margin: 4px 0 6px 0; }
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
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }

      /* Budget */
      .budget { padding: 6px 18px 10px 18px; }
      .budget-head, .units-head {
        display: flex; align-items: center; justify-content: space-between;
        font-size: 0.72rem; color: var(--clc-text-2); margin-bottom: 6px;
        text-transform: uppercase; letter-spacing: 0.06em;
      }
      .info-btn {
        all: unset; width: 24px; height: 24px; display: grid; place-items: center;
        border-radius: 50%; cursor: pointer; color: var(--clc-text-2); flex-shrink: 0;
        transition: background 0.2s ease, color 0.2s ease;
      }
      .info-btn ha-icon { --mdc-icon-size: 16px; }
      .info-btn:hover {
        background: color-mix(in srgb, var(--clc-text-2) 14%, transparent); color: var(--clc-text);
      }
      .info-btn.on { color: var(--clc-accent); }

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
      .path {
        display: none; margin-top: 10px; padding: 8px 10px; border-radius: 10px;
        background: color-mix(in srgb, var(--clc-text-2) 6%, transparent);
      }
      .path.open { display: block; }
      .ladder { display: flex; flex-direction: column; gap: 2px; }
      .ladder-title {
        font-size: 0.62rem; color: var(--clc-text-2); text-transform: uppercase;
        letter-spacing: 0.05em; margin-bottom: 4px;
      }
      .ladder-row {
        display: grid; grid-template-columns: 18px auto 1fr; gap: 8px; align-items: center;
        font-size: 0.74rem; color: var(--clc-text-2); padding: 2px 0;
      }
      .ladder-row ha-icon { --mdc-icon-size: 14px; }
      .ladder-row.st-pass ha-icon { color: #43a047; }
      .ladder-row.st-fired { color: var(--clc-text); font-weight: 600; }
      .ladder-row.st-fired ha-icon { color: var(--clc-accent); }
      .ladder-row.st-skip { opacity: 0.45; }
      .ladder-row.warn .ladder-note { color: #e53935; }
      .ladder-note {
        text-align: right; font-variant-numeric: tabular-nums; min-width: 0; overflow-wrap: anywhere;
      }

      /* Pièces */
      .units { padding: 4px 18px 8px 18px; }
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

      /* Tuiles */
      .chips {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px; padding: 6px 18px 12px 18px;
      }
      .chip {
        display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: center;
        padding: 8px 12px; border-radius: 12px;
        background: linear-gradient(135deg,
          color-mix(in srgb, var(--chip-color) 18%, transparent),
          color-mix(in srgb, var(--chip-color) 6%, transparent));
      }
      @supports not (background: color-mix(in srgb, red, blue)) {
        .chip { background: var(--clc-divider); }
      }
      .chip ha-icon { --mdc-icon-size: 20px; color: var(--chip-color); }
      .chip-text { min-width: 0; }
      .chip .v {
        font-size: 0.95rem; font-weight: 700; color: var(--clc-text);
        font-variant-numeric: tabular-nums; line-height: 1.1; white-space: nowrap;
      }
      .chip .l {
        font-size: 0.68rem; color: var(--clc-text-2); text-transform: uppercase;
        letter-spacing: 0.05em; margin-top: 1px;
      }

      /* Réglages */
      .settings { border-top: 1px solid var(--clc-divider); }
      .settings-toggle {
        all: unset; box-sizing: border-box; width: 100%;
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 18px; cursor: pointer; user-select: none; transition: background 0.2s;
      }
      .settings-toggle:hover { background: color-mix(in srgb, var(--clc-text-2) 6%, transparent); }
      .settings-toggle-label {
        display: flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 500;
        color: var(--clc-text-2); text-transform: uppercase; letter-spacing: 0.05em;
      }
      .settings-toggle-label ha-icon { --mdc-icon-size: 18px; }
      .chevron { --mdc-icon-size: 22px; color: var(--clc-text-2); transition: transform 0.3s ease; }
      .settings-toggle.expanded .chevron { transform: rotate(180deg); }
      .settings-body { display: none; padding: 4px 18px 16px 18px; }
      .settings-body.open { display: block; }
      .setting-row { display: flex; flex-direction: column; gap: 6px; padding: 10px 0; }
      .setting-row + .setting-row { border-top: 1px solid var(--clc-divider); }
      .setting-row.missing { display: block; color: #e53935; font-size: 0.78rem; }
      .toggle-row { flex-direction: row; align-items: center; justify-content: space-between; flex-wrap: wrap; }
      .setting-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
      .setting-label {
        display: flex; align-items: center; gap: 8px;
        font-size: 0.9rem; color: var(--clc-text); font-weight: 500;
      }
      .setting-label ha-icon { --mdc-icon-size: 18px; color: var(--clc-text-2); }
      .setting-value { display: flex; align-items: baseline; gap: 8px; font-variant-numeric: tabular-nums; }
      .setting-value-main { font-size: 0.95rem; font-weight: 700; color: var(--clc-accent); white-space: nowrap; }
      .setting-value-sub { font-size: 0.75rem; color: var(--clc-text-2); white-space: nowrap; }
      .setting-value-sub:empty { display: none; }
      .setting-desc { font-size: 0.72rem; color: var(--clc-text-2); line-height: 1.3; margin-top: -2px; }
      .slider {
        -webkit-appearance: none; appearance: none; width: 100%; height: 6px; margin: 4px 0;
        border-radius: 3px; background: var(--clc-divider);
        background-image: linear-gradient(var(--clc-accent), var(--clc-accent));
        background-size: var(--fill-pct, 0%) 100%; background-repeat: no-repeat;
        outline: none; cursor: pointer;
      }
      .slider::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 50%;
        background: var(--clc-accent); cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }
      .slider::-webkit-slider-thumb:hover { transform: scale(1.15); box-shadow: 0 3px 10px rgba(0,0,0,0.35); }
      .slider::-webkit-slider-thumb:active { transform: scale(1.25); }
      .slider::-moz-range-thumb {
        width: 18px; height: 18px; border-radius: 50%; background: var(--clc-accent);
        cursor: pointer; border: none; box-shadow: 0 2px 6px rgba(0,0,0,0.25);
      }
      .sel {
        font-family: inherit; font-size: 0.82rem; padding: 3px 6px; border-radius: 6px;
        border: 1px solid var(--clc-divider); background: transparent; color: var(--clc-text);
      }
      .switch { position: relative; width: 44px; height: 24px; flex-shrink: 0; }
      .switch input { opacity: 0; width: 0; height: 0; }
      .switch-track {
        position: absolute; inset: 0; background: var(--clc-divider); border-radius: 12px;
        cursor: pointer; transition: background 0.25s ease;
      }
      .switch-thumb {
        position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; background: white;
        border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.35); transition: transform 0.25s ease;
      }
      .switch input:checked ~ .switch-track { background: var(--clc-accent); }
      .switch input:checked ~ .switch-track .switch-thumb { transform: translateX(20px); }

      /* Verrou */
      .lock-row {
        display: flex; align-items: center; gap: 8px; padding: 6px 0 8px 0;
        font-size: 0.78rem; color: var(--clc-text-2);
      }
      .lock-row ha-icon { --mdc-icon-size: 17px; flex: none; }
      .lock-row.open ha-icon { color: var(--clc-accent); }
      .lock-l { flex: 1; min-width: 0; line-height: 1.3; }
      .lock-btn {
        flex: none; font-family: inherit; font-size: 0.76rem; cursor: pointer;
        padding: 4px 10px; border-radius: 12px; color: var(--clc-text);
        border: 1px solid var(--clc-divider); background: transparent;
      }
      .lock-row:not(.open) .lock-btn { border-color: var(--clc-accent); color: var(--clc-accent); }
      .settings-body.locked .setting-row:not(.missing) { opacity: 0.55; }

      /* Confirmation */
      .confirm {
        flex-basis: 100%; display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px;
        padding: 8px 10px; border-radius: 10px;
        background: color-mix(in srgb, #e53935 12%, transparent);
        font-size: 0.78rem; color: var(--clc-text);
      }
      .confirm-l { flex: 1 1 160px; line-height: 1.3; }
      .confirm-btn {
        font-family: inherit; font-size: 0.76rem; cursor: pointer; padding: 4px 10px;
        border-radius: 12px; border: 1px solid var(--clc-divider);
        background: transparent; color: var(--clc-text);
      }
      .confirm-btn.ok { background: #e53935; border-color: #e53935; color: #fff; }
      .settings-body.locked input, .settings-body.locked select,
      .settings-body.locked .switch-track { cursor: not-allowed; }

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
  enabled: 'Automatisation (interrupteur)', season: 'Mode saison', target_cool: 'Cible froid',
  target_heat: 'Cible chaud', import_allowance: 'Tolérance d\'import',
};

const CONTROL_DOMAINS = {
  toggle: ['input_boolean', 'switch'],
  select: ['input_select', 'select'],
  slider: ['input_number', 'number'],
};

// Même mécanique que l'éditeur de la carte cumulus : ha-form natif, sélecteurs
// d'entités filtrés par domaine, valeurs par défaut absentes du YAML.
class ClimSolaireCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config || {}));
    this._ensureBuilt();
    this._syncForm();
  }

  set hass(hass) {
    this._hass = hass;
    this._ensureBuilt();
    if (this._form) {
      this._form.hass = hass;
      this._syncForm();
    }
  }

  _ensureBuilt() {
    if (this._form) return;
    // hass ET config requis : construit trop tôt, ha-form émet des
    // value-changed parasites à champs vides qui effaceraient les contrôles.
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-form { display: block; }
        .hint { margin: 0 0 10px 0; font-size: 0.78rem; color: var(--secondary-text-color); line-height: 1.4; }
      </style>
      <p class="hint">
        Min, max et pas des sliders lus depuis chaque helper. Champ de contrôle
        vidé : ligne masquée.
      </p>`;
    this._form = document.createElement('ha-form');
    this._form.addEventListener('value-changed', (e) => this._onFormChanged(e));
    this._form.computeLabel = (sc) => this._label(sc);
    this._form.computeHelper = (sc) => this._helper(sc);
    this.shadowRoot.appendChild(this._form);
    this._form.hass = this._hass;
    this._form.schema = this._schema();
  }

  _schema() {
    return [
      { name: 'entity', required: true, selector: { entity: { filter: { domain: 'sensor' } } } },
      {
        name: 'show_settings',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              { value: 'collapsible', label: 'Repliable (défaut)' },
              { value: 'expanded', label: 'Toujours ouvert' },
              { value: 'hidden', label: 'Masqué' },
            ],
          },
        },
      },
      { name: 'show_units', selector: { boolean: {} } },
      { name: 'hero_switch', selector: { boolean: {} } },
      { name: 'lock', selector: { boolean: {} } },
      {
        name: 'lock_timeout',
        selector: { number: { min: 5, max: 600, step: 5, mode: 'box', unit_of_measurement: 's' } },
      },
      { name: 'admin_only', selector: { boolean: {} } },
      {
        name: 'controls_section',
        type: 'expandable',
        flatten: true,   // champs à la racine de data, sinon imbriqués sous controls_section
        title: 'Contrôles',
        expanded: true,
        schema: CONTROL_ORDER.map((key) => ({
          name: `ctrl_${key}`,
          selector: { entity: { filter: { domain: CONTROL_DOMAINS[DEFAULT_CONTROLS[key].type] } } },
        })),
      },
    ];
  }

  _label(sc) {
    const labels = {
      entity: 'Entité (sensor du flow)',
      show_settings: 'Panneau réglages',
      show_units: 'Liste des pièces',
      hero_switch: 'Interrupteur d\'automatisation dans l\'en-tête',
      lock: 'Verrou des commandes',
      lock_timeout: 'Reverrouillage après inactivité',
      admin_only: 'Lecture seule pour les non-administrateurs',
      controls_section: 'Contrôles',
    };
    if (labels[sc.name]) return labels[sc.name];
    if (sc.name && sc.name.startsWith('ctrl_')) return EDITOR_LABELS[sc.name.slice(5)] || sc.name;
    return undefined;
  }

  _helper(sc) {
    if (sc.name === 'entity') return 'sensor.clim_automation ou équivalent';
    if (sc.name === 'hero_switch') return 'Confirmation demandée à chaque bascule';
    if (sc.name === 'lock') return 'Bouton « Déverrouiller » requis avant réglage ou réordonnancement';
    if (sc.name === 'admin_only') return 'Garde-fou d\'interface, les droits réels restent ceux de Home Assistant';
    if (sc.name && sc.name.startsWith('ctrl_')) {
      const def = DEFAULT_CONTROLS[sc.name.slice(5)];
      return def ? `Défaut : ${def.entity}${def.optional ? ' (optionnel)' : ''}, vide pour masquer` : undefined;
    }
    return undefined;
  }

  _configToData(cfg) {
    const data = {
      entity: cfg.entity || '',
      show_settings: cfg.show_settings === false ? 'hidden' : (cfg.show_settings || 'collapsible'),
      show_units: cfg.show_units !== false,
      hero_switch: cfg.hero_switch !== false,
      lock: cfg.lock !== false,
      lock_timeout: cfg.lock_timeout != null ? Number(cfg.lock_timeout) : 30,
      admin_only: cfg.admin_only === true,
    };
    const ctl = cfg.controls || {};
    for (const key of CONTROL_ORDER) {
      const u = ctl[key];
      let id;
      if (u === false || u === null) id = '';
      else if (typeof u === 'string') id = u;
      else if (u && typeof u === 'object' && u.entity) id = u.entity;
      else id = DEFAULT_CONTROLS[key].entity;
      data[`ctrl_${key}`] = id;
    }
    return data;
  }

  _dataToConfig(data) {
    const cfg = { ...this._config };
    cfg.entity = data.entity || '';
    if (data.show_settings === 'hidden') cfg.show_settings = false;
    else if (!data.show_settings || data.show_settings === 'collapsible') delete cfg.show_settings;
    else cfg.show_settings = data.show_settings;
    if (data.show_units === false) cfg.show_units = false;
    else delete cfg.show_units;
    if (data.hero_switch === false) cfg.hero_switch = false;
    else delete cfg.hero_switch;
    if (data.lock === false) cfg.lock = false;
    else delete cfg.lock;
    const timeout = Number(data.lock_timeout);
    if (timeout > 0 && timeout !== 30) cfg.lock_timeout = timeout;
    else delete cfg.lock_timeout;
    if (data.admin_only === true) cfg.admin_only = true;
    else delete cfg.admin_only;

    // Contrôles enregistrés tels quels, défaut compris : si un défaut change
    // dans une version future, un choix explicite n'est pas perdu.
    const controls = {};
    for (const key of CONTROL_ORDER) {
      const id = data[`ctrl_${key}`] || '';
      const existing = this._config.controls && this._config.controls[key];
      if (!id) controls[key] = false;
      else if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        controls[key] = { ...existing, entity: id };
      } else controls[key] = id;
    }
    cfg.controls = controls;
    return cfg;
  }

  _syncForm() {
    if (!this._form || !this._config) return;
    const data = this._configToData(this._config);
    const json = JSON.stringify(data);
    if (json === this._lastDataJson) return;
    this._lastDataJson = json;
    this._form.data = data;
    this._syncedOnce = true;
  }

  _onFormChanged(e) {
    if (!this._syncedOnce) return;
    const data = e.detail.value;
    this._lastDataJson = JSON.stringify(data);
    this._config = this._dataToConfig(data);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config }, bubbles: true, composed: true,
    }));
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
