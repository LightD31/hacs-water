/**
 * hacs-water.js — fichier généré, ne pas éditer.
 *
 * Regroupe les cartes du dépôt en un seul module, HACS n'en téléchargeant qu'un
 * par dépôt et déclarant automatiquement sa ressource Lovelace.
 * Régénération : node tools/build-hacs-bundle.js
 *
 * Sources : cumulus-solaire-card.js, clim-solaire-card.js
 */

// ===== cumulus-solaire-card.js ===========================================
(() => {
/**
 * Cumulus Solaire Card
 *
 * Custom Lovelace card pour le sensor.cumulus_automation produit par
 * le flow Node-RED v5 du cumulus solaire.
 *
 * Sections :
 *   1. Hero (état + raison + heure)
 *   2. Cadran 270° température eau
 *   3. Courbe Solcast du jour avec fenêtre optimale + curseur "now"
 *   4. Pastilles : production / surplus / legionella / solaire amont
 *   5. Réglages (sliders + toggle, repliable)
 *
 * Aucune dépendance hormis ha-icon (fourni par HA).
 */

const VERSION = '1.11.4';

console.info(
  `%c CUMULUS-SOLAIRE-CARD %c v${VERSION} `,
  'color: white; background: #1976d2; font-weight: 700; padding: 2px 6px; border-radius: 3px 0 0 3px;',
  'color: #1976d2; background: white; font-weight: 700; padding: 2px 6px; border: 1px solid #1976d2; border-radius: 0 3px 3px 0;',
);

const MODES = {
  'disabled':            { color: '#9e9e9e', icon: 'mdi:robot-off',                 title: 'Automatisation désactivée', active: false },
  'manual-hold':         { color: '#8e24aa', icon: 'mdi:hand-back-right',           title: 'Pause, commande manuelle', active: false },
  'sensor-error':        { color: '#e53935', icon: 'mdi:thermometer-off',           title: 'Sonde HS, état maintenu',  active: false },
  'legionella-blocked':  { color: '#e53935', icon: 'mdi:alert-octagon-outline',     title: 'Anti-légionelle impossible', active: false },
  'legionella-critical': { color: '#e53935', icon: 'mdi:bacteria',                  title: 'Cycle anti-Legionella',     active: true  },
  'legionella-pending':  { color: '#fb8c00', icon: 'mdi:bacteria',                  title: 'Anti-légionelle en attente (HC)', active: false },
  'anti-injection':      { color: '#43a047', icon: 'mdi:transmission-tower-export', title: 'Charge du surplus solaire', active: true  },
  'legionella-due':      { color: '#fb8c00', icon: 'mdi:bacteria-outline',          title: 'Legionella à programmer',   active: false },
  'solcast-stale':       { color: '#757575', icon: 'mdi:cloud-off-outline',         title: 'Solcast périmé',            active: false },
  'forcing':             { color: '#fb8c00', icon: 'mdi:flash',                     title: 'Forçage dans la fenêtre',   active: true  },
  'heating':             { color: '#43a047', icon: 'mdi:water-boiler',              title: 'Chauffe au solaire',        active: true  },
  'solar-upstream':      { color: '#26a69a', icon: 'mdi:solar-power-variant',       title: 'Eau fournie par le solaire amont', active: false },
  'target-reached':      { color: '#1e88e5', icon: 'mdi:check-circle-outline',      title: 'Cible atteinte',            active: false },
  'idle':                { color: '#1e88e5', icon: 'mdi:water-boiler-auto',         title: 'En attente',                active: false },
};

const DEFAULT_CONTROLS = {
  enabled:         { entity: 'input_boolean.cumulus_automation_enabled', label: 'Automatisation',     type: 'toggle' },
  target:          { entity: 'input_number.cumulus_target_temp',         label: 'Cible',              type: 'slider', icon: 'mdi:thermometer-check',
                     desc: "Température visée, en l'absence de report selon la météo de demain" },
  min:             { entity: 'input_number.cumulus_min_temp',            label: 'Minimum',            type: 'slider', icon: 'mdi:thermometer-low',
                     desc: "Plancher absolu, avec forçage dans la meilleure fenêtre solaire en dessous" },
  solar_trigger:   { entity: 'input_number.cumulus_solar_trigger',       label: 'Seuil solaire',      type: 'slider', icon: 'mdi:solar-power',
                     subtitleAttr: 'effective_trigger', subtitleLabel: 'effectif', subtitleUnit: 'W',
                     desc: "Production mini pour chauffer en direct" },
  surplus_trigger: { entity: 'input_number.cumulus_surplus_trigger',     label: 'Seuil anti-injection', type: 'slider', icon: 'mdi:transmission-tower-export',
                     desc: "Surplus exporté pendant ≥ 5 min, avec forçage de l'allumage" },
  efficiency:      { entity: 'input_number.cumulus_efficiency',          label: 'Rendement',          type: 'slider', icon: 'mdi:percent-circle',
                     desc: "Conversion électricité vers chaleur utile, avec pilotage des durées et de la cible adaptative" },
  tank:            { entity: 'input_number.cumulus_tank_volume',         label: 'Volume ballon',      type: 'slider', icon: 'mdi:water-boiler',
                     optional: true,
                     desc: "Capacité thermique du ballon, avec influence sur la cible adaptative et la durée de fenêtre" },
};

const CONTROL_ORDER = ['enabled', 'target', 'min', 'solar_trigger', 'surplus_trigger', 'efficiency', 'tank'];

class CumulusSolaireCard extends HTMLElement {
  static getStubConfig() {
    return { entity: 'sensor.cumulus_automation' };
  }

  static getConfigElement() {
    return document.createElement('cumulus-solaire-card-editor');
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Entité sensor.cumulus_automation requise");
    }
    // Merge controls
    const userControls = config.controls || {};
    const controls = {};
    for (const key of CONTROL_ORDER) {
      const def = DEFAULT_CONTROLS[key];
      const u = userControls[key];
      if (u === false || u === null) continue;
      if (typeof u === 'string') {
        controls[key] = { ...def, entity: u };
      } else if (u && typeof u === 'object') {
        controls[key] = { ...def, ...u };
      } else {
        controls[key] = { ...def };
      }
    }
    this._config = {
      forecast_entity: 'sensor.solcast_pv_forecast_previsions_pour_aujourd_hui',
      show_settings: 'collapsible',  // 'collapsible' | 'expanded' | false
      ...config,
      controls,
    };
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._render();
    if (!this._tick) {
      this._tick = setInterval(() => this._render(), 30000);
    }
  }

  disconnectedCallback() {
    if (this._tick) {
      clearInterval(this._tick);
      this._tick = null;
    }
  }

  getCardSize() {
    return this._config.show_settings === 'expanded' ? 9 : 6;
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
            <ha-icon id="heroIconEl" icon="mdi:water-boiler-auto"></ha-icon>
          </div>
          <div class="hero-text">
            <div class="hero-title" id="heroTitle">—</div>
            <div class="hero-reason" id="heroReason">—</div>
          </div>
        </div>

        <div class="strategy" id="strategy">
          <div class="strategy-why" id="strategyWhy">
            <ha-icon id="strategyIcon" icon="mdi:strategy"></ha-icon>
            <span id="strategyWhyText">—</span>
            <button class="strategy-info" id="strategyInfo" title="Détails" aria-label="Détails">
              <ha-icon icon="mdi:information-outline"></ha-icon>
            </button>
          </div>
          <div class="strategy-pills" id="strategyPills"></div>
          <div class="strategy-detail" id="strategyDetail"></div>
        </div>

        <div class="main">
          <div class="dial">
            <svg id="dialSvg" viewBox="0 0 220 200" preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id="csc-fill-grad" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0%"   stop-color="#42a5f5"/>
                  <stop offset="55%"  stop-color="#ffb74d"/>
                  <stop offset="100%" stop-color="#ef5350"/>
                </linearGradient>
              </defs>
              <path id="dialBg"></path>
              <path id="dialFill"></path>
              <g id="dialTicks"></g>
              <text id="dialTemp"   x="110" y="118" text-anchor="middle">—</text>
              <text id="dialTarget" x="110" y="148" text-anchor="middle">—</text>
              <text id="dialUnit"   x="110" y="172" text-anchor="middle">température eau</text>
            </svg>
          </div>

          <div class="forecast">
            <div class="forecast-title">
              <span>Production solaire du jour</span>
              <span class="forecast-title-right">
                <span class="forecast-max" id="forecastMax"></span>
                <span class="forecast-stale" id="forecastStale"></span>
              </span>
            </div>
            <svg id="forecastSvg" viewBox="0 0 400 110" preserveAspectRatio="none">
              <defs>
                <linearGradient id="csc-area-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stop-color="#FFC107" stop-opacity="0.55"/>
                  <stop offset="100%" stop-color="#FFC107" stop-opacity="0.05"/>
                </linearGradient>
                <linearGradient id="csc-area-grad-tomorrow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stop-color="#90A4AE" stop-opacity="0.35"/>
                  <stop offset="100%" stop-color="#90A4AE" stop-opacity="0.05"/>
                </linearGradient>
              </defs>
              <rect id="forecastWindow"></rect>
              <path id="forecastBand"></path>
              <path id="forecastArea"></path>
              <path id="forecastLine"></path>
              <line id="forecastNow"></line>
              <g id="forecastTicks"></g>
            </svg>
            <div class="forecast-title forecast-title-tomorrow" id="forecastTomorrowTitle" style="display:none">
              <span>Demain</span>
              <span class="forecast-max" id="forecastTomorrowMax"></span>
            </div>
            <svg id="forecastTomorrowSvg" viewBox="0 0 400 80" preserveAspectRatio="none" style="display:none">
              <path id="forecastTomorrowBand"></path>
              <path id="forecastTomorrowArea"></path>
              <path id="forecastTomorrowLine"></path>
              <g id="forecastTomorrowTicks"></g>
            </svg>
            <div class="forecast-meta" id="forecastMeta"></div>
          </div>
        </div>

        <div class="chips" id="chips"></div>

        <div class="settings" id="settings">
          <div class="settings-toggle" id="settingsToggle">
            <span class="settings-toggle-label">
              <ha-icon icon="mdi:tune-variant"></ha-icon>
              <span>Réglages</span>
            </span>
            <ha-icon class="chevron" id="chevron" icon="mdi:chevron-down"></ha-icon>
          </div>
          <div class="settings-content" id="settingsContent"></div>
        </div>
      </ha-card>
    `;

    this._el = {
      card:         this.shadowRoot.querySelector('ha-card'),
      accent:       this.shadowRoot.querySelector('#accent'),
      hero:         this.shadowRoot.querySelector('#hero'),
      heroIcon:     this.shadowRoot.querySelector('#heroIcon'),
      heroIconEl:   this.shadowRoot.querySelector('#heroIconEl'),
      heroTitle:    this.shadowRoot.querySelector('#heroTitle'),
      heroReason:   this.shadowRoot.querySelector('#heroReason'),
      dialBg:       this.shadowRoot.querySelector('#dialBg'),
      dialFill:     this.shadowRoot.querySelector('#dialFill'),
      dialTicks:    this.shadowRoot.querySelector('#dialTicks'),
      dialTemp:     this.shadowRoot.querySelector('#dialTemp'),
      dialTarget:   this.shadowRoot.querySelector('#dialTarget'),
      forecastWindow: this.shadowRoot.querySelector('#forecastWindow'),
      forecastBand:   this.shadowRoot.querySelector('#forecastBand'),
      forecastArea:   this.shadowRoot.querySelector('#forecastArea'),
      forecastLine:   this.shadowRoot.querySelector('#forecastLine'),
      forecastNow:    this.shadowRoot.querySelector('#forecastNow'),
      forecastTicks:  this.shadowRoot.querySelector('#forecastTicks'),
      forecastMeta:   this.shadowRoot.querySelector('#forecastMeta'),
      forecastStale:  this.shadowRoot.querySelector('#forecastStale'),
      forecastMax:    this.shadowRoot.querySelector('#forecastMax'),
      forecastTomorrowTitle: this.shadowRoot.querySelector('#forecastTomorrowTitle'),
      forecastTomorrowMax:   this.shadowRoot.querySelector('#forecastTomorrowMax'),
      forecastTomorrowSvg:   this.shadowRoot.querySelector('#forecastTomorrowSvg'),
      forecastTomorrowBand:  this.shadowRoot.querySelector('#forecastTomorrowBand'),
      forecastTomorrowArea:  this.shadowRoot.querySelector('#forecastTomorrowArea'),
      forecastTomorrowLine:  this.shadowRoot.querySelector('#forecastTomorrowLine'),
      forecastTomorrowTicks: this.shadowRoot.querySelector('#forecastTomorrowTicks'),
      chips:        this.shadowRoot.querySelector('#chips'),
      strategy:         this.shadowRoot.querySelector('#strategy'),
      strategyIcon:     this.shadowRoot.querySelector('#strategyIcon'),
      strategyWhyText:  this.shadowRoot.querySelector('#strategyWhyText'),
      strategyInfo:     this.shadowRoot.querySelector('#strategyInfo'),
      strategyPills:    this.shadowRoot.querySelector('#strategyPills'),
      strategyDetail:   this.shadowRoot.querySelector('#strategyDetail'),
      settings:     this.shadowRoot.querySelector('#settings'),
      settingsToggle: this.shadowRoot.querySelector('#settingsToggle'),
      settingsContent: this.shadowRoot.querySelector('#settingsContent'),
      chevron:      this.shadowRoot.querySelector('#chevron'),
    };

    // Click on hero/main → more-info (skip settings)
    [this._el.hero, this.shadowRoot.querySelector('.main'), this._el.chips].forEach(zone => {
      zone.addEventListener('click', (e) => {
        const ev = new Event('hass-more-info', { bubbles: true, composed: true });
        ev.detail = { entityId: this._config.entity };
        this.dispatchEvent(ev);
      });
    });

    // Strategy strip: info toggles detail, clicks inside strip don't bubble to more-info
    this._strategyExpanded = false;
    this._el.strategy.addEventListener('click', (e) => e.stopPropagation());
    this._el.strategyInfo.addEventListener('click', (e) => {
      e.stopPropagation();
      this._strategyExpanded = !this._strategyExpanded;
      this._el.strategy.classList.toggle('expanded', this._strategyExpanded);
    });

    // Settings panel: stop propagation so it doesn't trigger more-info
    this._el.settings.addEventListener('click', (e) => e.stopPropagation());
    this._el.settings.addEventListener('input', (e) => e.stopPropagation());
    this._el.settings.addEventListener('change', (e) => e.stopPropagation());

    // Settings panel visibility
    if (this._config.show_settings === false) {
      this._el.settings.style.display = 'none';
    } else if (this._config.show_settings === 'expanded') {
      this._el.settingsContent.classList.add('expanded');
      this._el.settingsToggle.classList.add('expanded');
      this._el.settingsToggle.style.display = 'none'; // no toggle row
    } else {
      // collapsible (default), starts collapsed
      this._el.settingsToggle.addEventListener('click', () => {
        const isOpen = this._el.settingsContent.classList.toggle('expanded');
        this._el.settingsToggle.classList.toggle('expanded', isOpen);
      });
    }

    // Build settings rows once
    this._buildSettings();

    this._built = true;
  }

  _buildSettings() {
    const container = this._el.settingsContent;
    container.innerHTML = '';
    this._sliders = {};
    this._toggles = {};

    for (const key of CONTROL_ORDER) {
      const ctrl = this._config.controls[key];
      if (!ctrl) continue;

      if (ctrl.type === 'toggle') {
        const row = document.createElement('div');
        row.className = 'setting-row toggle-row';
        row.innerHTML = `
          <div class="setting-label">
            <ha-icon icon="mdi:robot"></ha-icon>
            <span>${this._escape(ctrl.label)}</span>
          </div>
          <label class="switch">
            <input type="checkbox" data-key="${key}">
            <span class="switch-track"><span class="switch-thumb"></span></span>
          </label>
        `;
        container.appendChild(row);
        const input = row.querySelector('input');
        input.addEventListener('change', () => this._onToggleChange(ctrl, input.checked));
        this._toggles[key] = { input, ctrl };
      } else {
        const row = document.createElement('div');
        row.className = 'setting-row slider-row';
        row.innerHTML = `
          <div class="setting-header">
            <div class="setting-label">
              <ha-icon icon="${ctrl.icon || 'mdi:tune'}"></ha-icon>
              <span>${this._escape(ctrl.label)}</span>
            </div>
            <div class="setting-value">
              <span class="setting-value-main" data-key="${key}-val">—</span>
              <span class="setting-value-sub"  data-key="${key}-sub"></span>
            </div>
          </div>
          ${ctrl.desc ? `<div class="setting-desc">${this._escape(ctrl.desc)}</div>` : ''}
          <input type="range" class="slider" data-key="${key}" min="0" max="100" step="1" value="0">
        `;
        container.appendChild(row);
        const slider = row.querySelector('.slider');
        const valEl  = row.querySelector(`[data-key="${key}-val"]`);
        const subEl  = row.querySelector(`[data-key="${key}-sub"]`);

        // Drag tracking
        slider._dragging = false;
        const stopDrag = () => { slider._dragging = false; };
        slider.addEventListener('pointerdown', () => { slider._dragging = true; });
        slider.addEventListener('pointerup',     stopDrag);
        slider.addEventListener('pointercancel', stopDrag);
        slider.addEventListener('pointerleave',  stopDrag);

        slider.addEventListener('input', () => {
          this._updateSliderFill(slider);
          valEl.textContent = this._formatSliderValue(slider, ctrl);
          // Debounced service call
          clearTimeout(slider._timer);
          slider._timer = setTimeout(() => {
            this._onSliderChange(ctrl, Number(slider.value));
          }, 250);
        });

        this._sliders[key] = { slider, valEl, subEl, ctrl };
      }
    }
  }

  // ---------- Render ----------

  _render() {
    const so = this._hass?.states?.[this._config.entity];
    if (!so) {
      this._el.heroTitle.textContent = `Entité introuvable`;
      this._el.heroReason.textContent = this._config.entity;
      return;
    }

    const a = so.attributes || {};
    const modeKey = this._mode(a);
    const m = MODES[modeKey];

    // Accent + icon
    this.style.setProperty('--csc-accent', m.color);
    this._el.accent.classList.toggle('active', m.active);
    this._el.heroIcon.style.background = m.color + '22';
    this._el.heroIcon.style.color = m.color;
    this._el.heroIcon.classList.toggle('active', m.active);
    this._el.heroIconEl.setAttribute('icon', m.icon);

    // v5: so.state is the canonical human-readable mode label from the flow;
    // a.reason holds the detailed "why".
    this._el.heroTitle.textContent = so.state || m.title;
    let reason = a.reason || '';
    if (a.degraded_sonde === true && a.sonde_down_hours > 0) {
      reason += `${reason ? ' · ' : ''}sonde HS depuis ${a.sonde_down_hours} h`;
    }
    this._el.heroReason.textContent = reason;

    this._renderStrategy(a);
    this._renderDial(a);
    this._renderForecast(a);
    this._renderForecastTomorrow(a);
    this._renderChips(a);
    this._renderSettings(a);
  }

  // ---------- Strategy strip ----------

  _renderStrategy(a) {
    const mode = a.tomorrow_mode;

    let icon = 'mdi:strategy';
    let why = '';
    let accentVar = null;

    if (a.manual_hold_active) {
      icon = 'mdi:hand-back-right';
      why = 'Commande manuelle détectée, automatisation en pause';
      accentVar = '#8e24aa';
    } else if (a.legionella_blocked) {
      icon = 'mdi:alert-octagon-outline';
      why = 'Anti-légionelle forcé, thermostat mécanique probablement coupé avant 62°C';
      accentVar = '#e53935';
    } else if (a.degraded_sonde) {
      icon = 'mdi:thermometer-off';
      why = 'Sonde HS, mode dégradé (solaire / anti-injection uniquement)';
      accentVar = '#e53935';
    } else if (a.legionella_critical) {
      icon = 'mdi:bacteria';
      why = 'Cycle anti-légionelle critique, chauffe forcée';
      accentVar = '#e53935';
    } else if (a.legionella_critical_pending) {
      icon = 'mdi:bacteria';
      why = 'Anti-légionelle critique, chauffe planifiée aux heures creuses';
      accentVar = '#fb8c00';
    } else if (a.legionella_due) {
      icon = 'mdi:bacteria-outline';
      why = 'Cycle anti-légionelle à programmer, cible remontée à 62°C';
      accentVar = '#fb8c00';
    } else if (a.solar_covers_target === true && a.desired !== 'on') {
      icon = 'mdi:solar-power-variant';
      const t = (a.solar_upstream_temp != null) ? `${Number(a.solar_upstream_temp).toFixed(0)}°C` : 'à la cible';
      why = `Cumulus solaire amont à ${t}, appoint électrique en veille`;
      accentVar = '#26a69a';
    } else if (mode === 'good') {
      icon = 'mdi:weather-sunny';
      why = 'Demain ensoleillé, seuil solaire relevé dans l\'attente d\'un meilleur soleil';
      accentVar = '#43a047';
    } else if (mode === 'poor') {
      icon = 'mdi:weather-cloudy';
      why = 'Demain faible, seuil solaire abaissé pour la captation du moindre soleil';
      accentVar = '#1e88e5';
    } else if (mode === 'mixed') {
      icon = 'mdi:weather-partly-cloudy';
      why = 'Demain moyen, seuil solaire standard';
      accentVar = '#fb8c00';
    } else {
      icon = 'mdi:strategy';
      why = 'Stratégie standard';
    }

    this._el.strategyIcon.setAttribute('icon', icon);
    this._el.strategyWhyText.textContent = why;
    if (accentVar) {
      this._el.strategy.style.setProperty('--strat-accent', accentVar);
    } else {
      this._el.strategy.style.removeProperty('--strat-accent');
    }

    // --- Influence pills ---
    const pills = [];
    const reach = a.reach_for;
    const target = a.target_temp;
    if (reach != null && target != null) {
      let sub = '= cible';
      let tone = 'neutral';
      const delta = Math.round((target - reach) * 10) / 10;
      if (delta > 0.1) {
        sub = `↓ −${delta.toFixed(1)}°C report`;
        tone = 'down';
      } else if (reach - target > 0.1) {
        sub = `↑ +${(reach - target).toFixed(1)}°C legio`;
        tone = 'up';
      }
      pills.push({
        icon: 'mdi:thermometer-check',
        label: 'Cible',
        value: `${Number(reach).toFixed(0)}°C`,
        sub,
        tone,
      });
    }

    const eff = a.effective_trigger;
    const base = a.solar_trigger;
    const mult = a.trig_mult;
    if (eff != null && base != null) {
      let sub = '';
      let tone = 'neutral';
      if (mult != null && Math.abs(mult - 1) >= 0.02) {
        const pct = Math.round((mult - 1) * 100);
        sub = pct >= 0 ? `↑ +${pct}%` : `↓ ${pct}%`;
        tone = pct >= 0 ? 'up' : 'down';
      } else {
        sub = 'standard';
      }
      pills.push({
        icon: 'mdi:solar-power',
        label: 'Seuil',
        value: `${Math.round(eff)} W`,
        sub,
        tone,
      });
    }

    let winIcon = 'mdi:clock-outline';
    let winValue = '—';
    let winSub = '';
    let winTone = 'neutral';
    if (a.window_start && a.window_end) {
      const ws = new Date(a.window_start);
      const we = new Date(a.window_end);
      const fmt = (d) => `${String(d.getHours()).padStart(2,'0')}h${String(d.getMinutes()).padStart(2,'0')}`;
      winValue = `${fmt(ws)}–${fmt(we)}`;
      if (a.is_forcing === true) {
        winSub = 'forçage';
        winTone = 'active';
        winIcon = 'mdi:flash';
      } else if (a.in_window === true) {
        winSub = 'en cours';
        winTone = 'active';
      } else {
        winSub = a.window_avg_w ? `~${Math.round(a.window_avg_w)} W` : 'à venir';
      }
    } else if (a.window_skipped_reason) {
      winValue = 'hors fenêtre';
      winSub = a.window_skipped_reason;
    }
    pills.push({
      icon: winIcon,
      label: 'Fenêtre',
      value: winValue,
      sub: winSub,
      tone: winTone,
    });

    this._el.strategyPills.innerHTML = pills.map(p => `
      <div class="strat-pill tone-${p.tone}">
        <ha-icon icon="${p.icon}"></ha-icon>
        <div class="strat-pill-text">
          <div class="strat-pill-l">${this._escape(p.label)}</div>
          <div class="strat-pill-v">${this._escape(p.value)}</div>
          ${p.sub ? `<div class="strat-pill-s">${this._escape(p.sub)}</div>` : ''}
        </div>
      </div>
    `).join('');

    // --- Detail (expandable) ---
    const fmtPct = (v) => Math.round(Number(v) * 100) + '%';
    const rows = [];
    if (a.tomorrow_score != null) rows.push(['Score demain', fmtPct(a.tomorrow_score)]);
    if (a.worst_next2_score != null) rows.push(['Pire J+1/J+2', fmtPct(a.worst_next2_score)]);
    if (a.trig_mult != null) rows.push(['Multiplicateur seuil', `×${Number(a.trig_mult).toFixed(2)}`]);
    if (a.stop_temp != null) rows.push(['Arrêt du forçage', `${Number(a.stop_temp).toFixed(1)}°C`]);
    if (a.dt_forcing != null && a.dt_forcing > 0) rows.push(['Besoin forçage', `${Number(a.dt_forcing).toFixed(1)}°C`]);
    if (a.tank_volume_l != null) rows.push(['Volume ballon', `${a.tank_volume_l} L`]);
    if (a.sonde_down_hours != null && a.sonde_down_hours > 0) rows.push(['Sonde HS depuis', `${a.sonde_down_hours} h`]);
    if (a.manual_hold_until) {
      const t = new Date(a.manual_hold_until);
      rows.push(['Reprise auto', `${String(t.getHours()).padStart(2,'0')}h${String(t.getMinutes()).padStart(2,'0')}`]);
    }
    const ladder = this._decisionLadder(a);
    const ladderHtml = `
      <div class="ladder">
        <div class="ladder-title">Chemin de décision</div>
        ${ladder.map(s => `
          <div class="ladder-row st-${s.status}${s.warn ? ' warn' : ''}">
            <ha-icon icon="${s.status === 'fired' ? 'mdi:arrow-right-bold-circle'
                          : s.status === 'pass'  ? 'mdi:check'
                                                 : 'mdi:minus'}"></ha-icon>
            <span class="ladder-label">${this._escape(s.label)}</span>
            <span class="ladder-note">${this._escape(s.note || '')}</span>
          </div>`).join('')}
      </div>`;
    this._el.strategyDetail.innerHTML = ladderHtml + rows.map(([k, v]) =>
      `<div class="strat-detail-row"><span>${this._escape(k)}</span><span>${this._escape(v)}</span></div>`
    ).join('');
  }

  /**
   * Reconstruit le chemin de décision du flow (priorités descendantes).
   * La première règle qui "tire" est l'état terminal — les suivantes sont
   * court-circuitées. Tout est dérivé des attributs du sensor.
   */
  _decisionLadder(a) {
    const fmtW = (v) => (v != null && !isNaN(v)) ? `${Math.round(v)} W` : '—';
    const tempOk = a.temp_sensor_available !== false;
    const antiInj = (a.anti_injection_useful !== undefined)
      ? a.anti_injection_useful : a.anti_injection_active;
    const reach = a.reach_for ?? a.target_temp;
    const targetReached = tempOk && a.water_temp != null && reach != null
      && a.water_temp >= reach;

    const steps = [
      { label: 'Pause manuelle',
        cond: a.manual_hold_active === true,
        note: a.manual_hold_active ? 'interrupteur actionné à la main' : 'non' },
      { label: 'Automatisation',
        cond: a.enabled === false,
        note: a.enabled ? 'active' : 'désactivée' },
      { label: 'Sonde température',
        // Ancien flow : sonde HS = état figé (terminal). Flow v3+ : simple drapeau.
        cond: !tempOk && a.degraded_sonde === undefined,
        note: tempOk ? 'OK' : 'HS, mode dégradé',
        warn: !tempOk },
      { label: 'Anti-injection',
        cond: antiInj === true,
        note: `${fmtW(a.potential_surplus)} / seuil ${fmtW(a.surplus_trigger)}` },
      { label: 'Légionelle critique',
        cond: a.legionella_critical === true,
        note: a.days_since_high_temp != null ? `${a.days_since_high_temp} j sans 60°C` : '' },
      { label: 'Cible atteinte',
        cond: targetReached,
        note: (tempOk && a.water_temp != null && reach != null)
          ? `${Number(a.water_temp).toFixed(1)}° / ${Number(reach).toFixed(0)}°` : '—' },
      // Présent seulement avec le flow "solaire amont" (rétro-compat).
      ...(a.solar_upstream_available !== undefined ? [{
        label: 'Cumulus solaire',
        cond: a.solar_covers_target === true,
        note: (a.solar_upstream_temp != null && a.solar_sufficient_threshold != null)
          ? `${Number(a.solar_upstream_temp).toFixed(1)}° / ${Number(a.solar_sufficient_threshold).toFixed(0)}°`
          : (a.solar_upstream_available === false ? 'sonde amont indispo' : '—') }] : []),
      { label: 'Forçage fenêtre',
        cond: a.is_forcing === true,
        note: a.is_forcing ? 'dans la fenêtre optimale'
            : (a.window_skipped_reason || (a.in_window ? 'fenêtre en cours' : 'hors fenêtre')) },
      { label: 'Solaire (hystérésis 5 min)',
        cond: true,
        note: `${fmtW(a.solar_power)} / seuil ${fmtW(a.effective_trigger)}` },
    ];

    let firedIdx = steps.findIndex(s => s.cond);
    if (firedIdx === -1) firedIdx = steps.length - 1;
    return steps.map((s, i) => ({
      label: s.label,
      note: s.note,
      warn: s.warn === true,
      status: i === firedIdx ? 'fired' : (i < firedIdx ? 'pass' : 'skip'),
    }));
  }

  _mode(a) {
    if (a.enabled === false) return 'disabled';
    if (a.manual_hold_active === true) return 'manual-hold';
    // Flow v3+ : sonde HS = mode dégradé, le flow continue (solaire/anti-injection),
    // le hero suit donc l'état réel. Ancien flow (pas de degraded_sonde) : état figé.
    if (a.temp_sensor_available === false && a.degraded_sonde === undefined) return 'sensor-error';
    if (a.legionella_blocked === true) return 'legionella-blocked';
    if (a.legionella_critical === true) return 'legionella-critical';
    if (a.legionella_critical_pending === true) return 'legionella-pending';
    // v3 : anti_injection_useful = la latch SERT vraiment (cuve pas pleine,
    // thermostat pas coupé). Fallback sur la latch brute pour l'ancien flow.
    const antiInj = (a.anti_injection_useful !== undefined)
      ? a.anti_injection_useful : a.anti_injection_active;
    if (antiInj === true) return 'anti-injection';
    if (a.solcast_stale === true && !a.is_forcing) return 'solcast-stale';
    if (a.legionella_due === true && (a.water_temp ?? 0) < (a.reach_for ?? 60)) return 'legionella-due';
    // Le cumulus solaire amont couvre déjà la cible → l'électrique est coupé
    // (desired off), même si une fenêtre de forçage est encore latchée sur la
    // cuve élec. (le solaire amont ne refroidit pas cette cuve).
    if (a.solar_covers_target === true && a.desired !== 'on') return 'solar-upstream';
    if (a.is_forcing === true) return 'forcing';
    if (a.desired === 'on') return 'heating';
    const reach = a.reach_for ?? a.target_temp ?? 55;
    if (a.water_temp != null && a.water_temp >= reach) return 'target-reached';
    return 'idle';
  }

  // ---------- Dial ----------

  _renderDial(a) {
    const cx = 110, cy = 105, r = 78;
    const T_MIN = 30, T_MAX = 70;
    const A_MIN = -135, A_MAX = 135;
    const SWEEP = A_MAX - A_MIN;

    const tToA = (t) => {
      const c = Math.max(T_MIN, Math.min(T_MAX, t));
      return A_MIN + ((c - T_MIN) / (T_MAX - T_MIN)) * SWEEP;
    };
    const polar = (angleDeg, rad = r) => {
      const a = (angleDeg - 90) * Math.PI / 180;
      return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) };
    };
    const arc = (a1, a2, rad = r) => {
      const s = polar(a1, rad), e = polar(a2, rad);
      const sweep = a2 - a1;
      const large = Math.abs(sweep) > 180 ? 1 : 0;
      const dir = sweep > 0 ? 1 : 0;
      return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${rad} ${rad} 0 ${large} ${dir} ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
    };

    this._el.dialBg.setAttribute('d', arc(A_MIN, A_MAX));

    const temp = (a.water_temp != null && !isNaN(a.water_temp)) ? Number(a.water_temp) : null;
    const tA = temp != null ? tToA(temp) : A_MIN;
    if (temp != null && tA > A_MIN + 0.5) {
      this._el.dialFill.setAttribute('d', arc(A_MIN, tA));
    } else {
      this._el.dialFill.setAttribute('d', '');
    }

    const ticks = [];
    if (a.min_temp != null) ticks.push({ v: Number(a.min_temp), color: '#ef5350', big: false });
    if (a.forcage_threshold != null && a.forcage_threshold !== a.min_temp) {
      ticks.push({ v: Number(a.forcage_threshold), color: '#fb8c00', big: false });
    }
    const reach = a.reach_for ?? a.target_temp;
    if (reach != null) ticks.push({ v: Number(reach), color: '#43a047', big: true });
    if (a.stop_temp != null && a.stop_temp !== reach && a.stop_temp !== a.forcage_threshold) {
      ticks.push({ v: Number(a.stop_temp), color: '#26a69a', big: false });
    }
    if (a.legionella_due === true && reach !== 60) {
      ticks.push({ v: 60, color: '#8e24aa', big: false });
    }

    while (this._el.dialTicks.firstChild) this._el.dialTicks.removeChild(this._el.dialTicks.firstChild);
    ticks.forEach(t => {
      if (t.v == null || isNaN(t.v) || t.v < T_MIN || t.v > T_MAX) return;
      const ang = tToA(t.v);
      const pIn  = polar(ang, r - (t.big ? 16 : 12));
      const pOut = polar(ang, r + (t.big ? 8  : 5));
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', pIn.x.toFixed(2));
      line.setAttribute('y1', pIn.y.toFixed(2));
      line.setAttribute('x2', pOut.x.toFixed(2));
      line.setAttribute('y2', pOut.y.toFixed(2));
      line.setAttribute('stroke', t.color);
      line.setAttribute('stroke-width', t.big ? 3.5 : 2.5);
      line.setAttribute('stroke-linecap', 'round');
      this._el.dialTicks.appendChild(line);
    });

    this._el.dialTemp.textContent = (temp != null) ? `${temp.toFixed(1)}°` : '—';
    if (a.temp_sensor_available === false) {
      this._el.dialTarget.textContent = 'sonde indisponible';
    } else if (reach != null) {
      this._el.dialTarget.textContent = `→ ${Number(reach).toFixed(0)}°C`;
    } else {
      this._el.dialTarget.textContent = '';
    }
  }

  // ---------- Forecast ----------

  _renderForecast(a) {
    const fEntity = this._hass?.states?.[this._config.forecast_entity];
    const W = 400, H = 110;
    const padTop = 8, padBottom = 18;
    const usableH = H - padTop - padBottom;

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEndMs = dayStart.getTime() + 24 * 3600 * 1000;
    const dayMs = dayEndMs - dayStart.getTime();

    const tToX = (t) => Math.max(0, Math.min(W, ((t - dayStart.getTime()) / dayMs) * W));

    const slots = (fEntity?.attributes?.detailedForecast || []);
    const field = a.forecast_field || 'pv_estimate';

    const points = slots
      .map(s => ({
        t: new Date(s.period_start).getTime(),
        w: Number(s[field] || 0),
        p10: s.pv_estimate10 != null ? Number(s.pv_estimate10) : null,
        p90: s.pv_estimate90 != null ? Number(s.pv_estimate90) : null,
      }))
      .filter(p => !isNaN(p.t) && p.t >= dayStart.getTime() && p.t < dayEndMs)
      .sort((p1, p2) => p1.t - p2.t);

    const dataMax = Math.max(
      0,
      ...points.map(p => Math.max(p.w, p.p90 != null ? p.p90 : 0)),
    );
    const maxW = Math.max(0.5, dataMax);
    const wToY = (w) => padTop + usableH - (w / maxW) * usableH;

    const screenPts = points.map(p => ({ x: tToX(p.t), y: wToY(p.w) }));
    const linePath = this._smoothPath(screenPts);

    const hasBand = points.some(p => p.p10 != null && p.p90 != null && p.p90 > p.p10);
    if (hasBand) {
      const topPts = points.map(p => ({ x: tToX(p.t), y: wToY(p.p90 != null ? p.p90 : p.w) }));
      const botPts = points.map(p => ({ x: tToX(p.t), y: wToY(p.p10 != null ? p.p10 : p.w) }));
      const topPath = this._smoothPath(topPts);
      const botBack = botPts.slice().reverse()
        .map(p => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      this._el.forecastBand.setAttribute('d', `${topPath} ${botBack} Z`);
    } else {
      this._el.forecastBand.setAttribute('d', '');
    }

    this._el.forecastMax.textContent = dataMax > 0.05 ? `max ${this._fmtKw(dataMax)}` : '';

    if (linePath) {
      this._el.forecastLine.setAttribute('d', linePath);
      const baseY = padTop + usableH;
      const firstX = screenPts[0].x;
      const lastX  = screenPts[screenPts.length - 1].x;
      this._el.forecastArea.setAttribute('d',
        linePath + ` L ${lastX.toFixed(1)} ${baseY.toFixed(1)} L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`
      );
    } else {
      this._el.forecastLine.setAttribute('d', '');
      this._el.forecastArea.setAttribute('d', '');
    }

    if (a.window_start && a.window_end) {
      const wsX = tToX(new Date(a.window_start).getTime());
      const weX = tToX(new Date(a.window_end).getTime());
      this._el.forecastWindow.setAttribute('x', wsX.toFixed(1));
      this._el.forecastWindow.setAttribute('y', padTop);
      this._el.forecastWindow.setAttribute('width', Math.max(2, weX - wsX).toFixed(1));
      this._el.forecastWindow.setAttribute('height', usableH);
      this._el.forecastWindow.style.opacity = '1';
    } else {
      this._el.forecastWindow.style.opacity = '0';
    }

    const nowX = tToX(Date.now());
    this._el.forecastNow.setAttribute('x1', nowX.toFixed(1));
    this._el.forecastNow.setAttribute('x2', nowX.toFixed(1));
    this._el.forecastNow.setAttribute('y1', padTop);
    this._el.forecastNow.setAttribute('y2', padTop + usableH);

    while (this._el.forecastTicks.firstChild) this._el.forecastTicks.removeChild(this._el.forecastTicks.firstChild);
    [6, 9, 12, 15, 18, 21].forEach(h => {
      const t = new Date(dayStart);
      t.setHours(h);
      const x = tToX(t.getTime());
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x.toFixed(1));
      text.setAttribute('y', H - 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'forecast-tick');
      text.textContent = `${h}h`;
      this._el.forecastTicks.appendChild(text);
    });

    if (a.solcast_stale === true) {
      this._el.forecastStale.textContent = `⚠️ ${a.solcast_age_hours ?? '?'}h`;
    } else {
      this._el.forecastStale.textContent = '';
    }

    const parts = [];
    if (a.today_remaining_kwh != null && a.today_remaining_kwh > 0) {
      parts.push(`<span>Reste ${Number(a.today_remaining_kwh).toFixed(1)} kWh</span>`);
    }
    if (a.tomorrow_forecast_kwh != null) {
      const kwh = a.tomorrow_forecast_kwh;
      const p10 = a.tomorrow_p10_kwh;
      const p90 = a.tomorrow_p90_kwh;
      let txt = `Demain : ${Number(kwh).toFixed(1)} kWh`;
      if (p10 != null && p90 != null && p90 > p10) {
        txt += ` (${Number(p10).toFixed(1)}–${Number(p90).toFixed(1)})`;
      }
      parts.push(`<span>${this._escape(txt)}</span>`);
    }
    if (a.day_after_forecast_kwh != null) {
      const p10 = a.day_after_p10_kwh;
      const p90 = a.day_after_p90_kwh;
      let txt = `J+2 : ${Number(a.day_after_forecast_kwh).toFixed(1)} kWh`;
      if (p10 != null && p90 != null && p90 > p10) {
        txt += ` (${Number(p10).toFixed(1)}–${Number(p90).toFixed(1)})`;
      }
      parts.push(`<span>${this._escape(txt)}</span>`);
    }

    this._el.forecastMeta.innerHTML = parts.join('');
  }

  _renderForecastTomorrow(a) {
    const tomorrowEntityId = this._config.forecast_entity_tomorrow;
    const hide = () => {
      this._el.forecastTomorrowTitle.style.display = 'none';
      this._el.forecastTomorrowSvg.style.display = 'none';
    };
    if (!tomorrowEntityId) return hide();
    const fEntity = this._hass?.states?.[tomorrowEntityId];
    const slots = fEntity?.attributes?.detailedForecast || [];
    if (!slots.length) return hide();

    const W = 400, H = 80;
    const padTop = 4, padBottom = 16;
    const usableH = H - padTop - padBottom;

    const tStart = new Date();
    tStart.setHours(0, 0, 0, 0);
    tStart.setDate(tStart.getDate() + 1);
    const tEnd = tStart.getTime() + 24 * 3600 * 1000;
    const dayMs = tEnd - tStart.getTime();

    const tToX = (t) => Math.max(0, Math.min(W, ((t - tStart.getTime()) / dayMs) * W));
    const field = a.forecast_field || 'pv_estimate';

    const points = slots
      .map(s => ({
        t: new Date(s.period_start).getTime(),
        w: Number(s[field] || 0),
        p10: s.pv_estimate10 != null ? Number(s.pv_estimate10) : null,
        p90: s.pv_estimate90 != null ? Number(s.pv_estimate90) : null,
      }))
      .filter(p => !isNaN(p.t) && p.t >= tStart.getTime() && p.t < tEnd)
      .sort((p1, p2) => p1.t - p2.t);

    if (!points.length) return hide();

    this._el.forecastTomorrowTitle.style.display = '';
    this._el.forecastTomorrowSvg.style.display = '';

    const dataMax = Math.max(
      0,
      ...points.map(p => Math.max(p.w, p.p90 != null ? p.p90 : 0)),
    );
    const maxW = Math.max(0.5, dataMax);
    const wToY = (w) => padTop + usableH - (w / maxW) * usableH;
    const screenPts = points.map(p => ({ x: tToX(p.t), y: wToY(p.w) }));
    const linePath = this._smoothPath(screenPts);

    const hasBand = points.some(p => p.p10 != null && p.p90 != null && p.p90 > p.p10);
    if (hasBand) {
      const topPts = points.map(p => ({ x: tToX(p.t), y: wToY(p.p90 != null ? p.p90 : p.w) }));
      const botPts = points.map(p => ({ x: tToX(p.t), y: wToY(p.p10 != null ? p.p10 : p.w) }));
      const topPath = this._smoothPath(topPts);
      const botBack = botPts.slice().reverse()
        .map(p => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      this._el.forecastTomorrowBand.setAttribute('d', `${topPath} ${botBack} Z`);
    } else {
      this._el.forecastTomorrowBand.setAttribute('d', '');
    }

    this._el.forecastTomorrowMax.textContent = dataMax > 0.05 ? `max ${this._fmtKw(dataMax)}` : '';

    if (linePath) {
      this._el.forecastTomorrowLine.setAttribute('d', linePath);
      const baseY = padTop + usableH;
      const firstX = screenPts[0].x;
      const lastX  = screenPts[screenPts.length - 1].x;
      this._el.forecastTomorrowArea.setAttribute('d',
        linePath + ` L ${lastX.toFixed(1)} ${baseY.toFixed(1)} L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`
      );
    } else {
      this._el.forecastTomorrowLine.setAttribute('d', '');
      this._el.forecastTomorrowArea.setAttribute('d', '');
    }

    while (this._el.forecastTomorrowTicks.firstChild) {
      this._el.forecastTomorrowTicks.removeChild(this._el.forecastTomorrowTicks.firstChild);
    }
    [6, 9, 12, 15, 18, 21].forEach(h => {
      const t = new Date(tStart);
      t.setHours(h);
      const x = tToX(t.getTime());
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x.toFixed(1));
      text.setAttribute('y', H - 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'forecast-tick');
      text.textContent = `${h}h`;
      this._el.forecastTomorrowTicks.appendChild(text);
    });
  }

  _smoothPath(pts) {
    if (!pts || pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    const out = [`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`];
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const cx = (p0.x + p1.x) / 2;
      out.push(`C ${cx.toFixed(1)} ${p0.y.toFixed(1)}, ${cx.toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`);
    }
    return out.join(' ');
  }

  // ---------- Chips ----------

  _renderChips(a) {
    const fmtSigned = (n) => {
      if (n == null || isNaN(n)) return '—';
      const v = Math.round(n);
      return (v >= 0 ? '+' : '') + v;
    };
    const fmtRound = (n) => (n == null || isNaN(n)) ? '—' : Math.round(n);

    const chips = [
      {
        icon: 'mdi:solar-power-variant',
        color: '#ffb300',
        value: `${fmtRound(a.solar_power)} W`,
        label: 'Production',
      },
      (() => {
        const ps = Number(a.potential_surplus);
        const hasPs = ps != null && !isNaN(ps);
        const aiUseful = (a.anti_injection_useful !== undefined)
          ? a.anti_injection_useful : a.anti_injection_active;
        let icon, color, label;
        if (aiUseful === true) {
          icon = 'mdi:transmission-tower-export';
          color = '#43a047';
          label = 'Anti-injection';
        } else if (a.anti_injection_active === true) {
          // Latch active mais rien à absorber (cuve pleine / thermostat coupé)
          icon = 'mdi:transmission-tower-export';
          color = '#9e9e9e';
          label = 'Surplus (saturé)';
        } else if (hasPs && ps > 20) {
          icon = 'mdi:transmission-tower-export';
          color = '#fb8c00';
          label = 'Surplus';
        } else if (hasPs && ps < -20) {
          icon = 'mdi:transmission-tower-import';
          color = '#e53935';
          label = 'Import';
        } else {
          icon = 'mdi:transmission-tower';
          color = '#9e9e9e';
          label = 'Surplus';
        }
        return {
          icon,
          color,
          value: `${fmtSigned(a.potential_surplus)} W`,
          label,
        };
      })(),
      {
        icon: a.legionella_critical ? 'mdi:bacteria'
            : a.legionella_due      ? 'mdi:bacteria-outline'
                                    : 'mdi:shield-check-outline',
        color: a.legionella_critical ? '#e53935'
             : a.legionella_due      ? '#fb8c00'
                                     : '#43a047',
        value: (a.days_since_high_temp != null) ? `${a.days_since_high_temp} j` : '—',
        label: 'Sans 60°C',
      },
      // Cumulus solaire amont — affiché seulement si la sonde existe
      ...(a.solar_upstream_temp != null ? [{
        icon: a.solar_covers_target ? 'mdi:solar-power-variant' : 'mdi:water-thermometer-outline',
        color: a.solar_covers_target ? '#26a69a' : '#1e88e5',
        value: `${Number(a.solar_upstream_temp).toFixed(1)}°`,
        label: 'Solaire amont',
      }] : []),
      ...(a.thermostat_tripped === true ? [{
        icon: 'mdi:thermostat-box',
        color: '#757575',
        value: 'coupé',
        label: 'Thermostat',
      }] : []),
    ];

    this._el.chips.innerHTML = chips.map(c => `
      <div class="chip" style="--chip-color: ${c.color};">
        <ha-icon icon="${c.icon}"></ha-icon>
        <div class="chip-text">
          <div class="v">${this._escape(c.value)}</div>
          <div class="l">${this._escape(c.label)}</div>
        </div>
      </div>
    `).join('');
  }

  // ---------- Settings ----------

  _renderSettings(autoAttrs) {
    if (this._config.show_settings === false) return;

    // Sliders
    for (const [key, info] of Object.entries(this._sliders || {})) {
      const so = this._hass.states[info.ctrl.entity];
      const row = info.slider.closest('.setting-row');
      if (!so) {
        row.classList.add('missing');
        // Helpers optionnels (ex: volume ballon) : masqués s'ils n'existent pas
        if (info.ctrl.optional) row.style.display = 'none';
        info.valEl.textContent = '—';
        continue;
      }
      row.classList.remove('missing');
      row.style.display = '';

      const minA  = parseFloat(so.attributes.min);
      const maxA  = parseFloat(so.attributes.max);
      const stepA = parseFloat(so.attributes.step);
      const val   = parseFloat(so.state);

      if (!isNaN(minA))  info.slider.min  = minA;
      if (!isNaN(maxA))  info.slider.max  = maxA;
      if (!isNaN(stepA)) info.slider.step = stepA;

      if (!info.slider._dragging && !isNaN(val)) {
        info.slider.value = val;
        this._updateSliderFill(info.slider);
        info.valEl.textContent = this._formatSliderValue(info.slider, info.ctrl, val, so);
      }

      // Subtitle (e.g., effective_trigger from cumulus_automation)
      if (info.ctrl.subtitleAttr) {
        const subVal = autoAttrs[info.ctrl.subtitleAttr];
        if (subVal != null && Number(subVal) !== val) {
          const unit = info.ctrl.subtitleUnit || '';
          info.subEl.textContent = `${info.ctrl.subtitleLabel || ''} ${Math.round(subVal)}${unit ? ' ' + unit : ''}`;
          info.subEl.style.display = '';
        } else {
          info.subEl.style.display = 'none';
        }
      }
    }

    // Toggles
    for (const [key, info] of Object.entries(this._toggles || {})) {
      const so = this._hass.states[info.ctrl.entity];
      const row = info.input.closest('.setting-row');
      if (!so) {
        row.classList.add('missing');
        continue;
      }
      row.classList.remove('missing');
      info.input.checked = (so.state === 'on');
    }
  }

  _updateSliderFill(slider) {
    const min = Number(slider.min) || 0;
    const max = Number(slider.max) || 100;
    const val = Number(slider.value) || 0;
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    slider.style.setProperty('--fill-pct', `${pct}%`);
  }

  _formatSliderValue(slider, ctrl, value, stateObj) {
    const v = (value != null) ? value : Number(slider.value);
    const so = stateObj || this._hass.states[ctrl.entity];
    const unit = so?.attributes?.unit_of_measurement || '';
    const step = parseFloat(slider.step) || 1;
    const digits = step >= 1 ? 0 : (step >= 0.1 ? 1 : 2);
    return `${v.toFixed(digits)}${unit ? ' ' + unit : ''}`;
  }

  _onSliderChange(ctrl, value) {
    if (!this._hass) return;
    const domain = ctrl.entity.split('.')[0];
    if (domain !== 'input_number' && domain !== 'number') return;
    this._hass.callService(domain, 'set_value', {
      entity_id: ctrl.entity,
      value,
    });
  }

  _onToggleChange(ctrl, checked) {
    if (!this._hass) return;
    const domain = ctrl.entity.split('.')[0];
    if (domain === 'input_boolean') {
      this._hass.callService('input_boolean', checked ? 'turn_on' : 'turn_off', {
        entity_id: ctrl.entity,
      });
    } else if (domain === 'switch') {
      this._hass.callService('switch', checked ? 'turn_on' : 'turn_off', {
        entity_id: ctrl.entity,
      });
    }
  }

  _escape(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  }

  _fmtKw(kw) {
    return kw >= 1 ? `${kw.toFixed(1)} kW` : `${Math.round(kw * 1000)} W`;
  }

  // ---------- CSS ----------

  _css() {
    return `
      :host {
        --csc-accent: var(--primary-color);
        --csc-text: var(--primary-text-color);
        --csc-text-2: var(--secondary-text-color);
        --csc-divider: var(--divider-color, rgba(127,127,127,0.18));
      }
      ha-card {
        padding: 0;
        overflow: hidden;
      }

      /* Accent bar */
      .accent {
        position: relative;
        height: 4px;
        background: var(--csc-accent);
        transition: background 0.4s ease;
        overflow: hidden;
      }
      .accent.active::after {
        content: '';
        position: absolute;
        top: 0; left: -40%;
        width: 40%; height: 100%;
        background: linear-gradient(90deg,
          rgba(255,255,255,0) 0%,
          rgba(255,255,255,0.5) 50%,
          rgba(255,255,255,0) 100%);
        animation: csc-shimmer 2.4s linear infinite;
      }
      @keyframes csc-shimmer {
        0%   { left: -40%; }
        100% { left: 100%; }
      }

      /* Hero */
      .hero {
        display: grid;
        grid-template-columns: 56px 1fr;
        gap: 14px;
        align-items: center;
        padding: 14px 18px 6px 18px;
        cursor: pointer;
      }
      .hero-icon {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        transition: background 0.4s ease, color 0.4s ease, box-shadow 0.4s ease;
      }
      .hero-icon ha-icon {
        --mdc-icon-size: 28px;
      }
      .hero-icon.active {
        animation: csc-pulse 2.2s ease-in-out infinite;
        box-shadow: 0 0 18px -4px var(--csc-accent);
      }
      @keyframes csc-pulse {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.06); }
      }
      .hero-text { min-width: 0; }
      .hero-title {
        font-size: 1.05rem;
        font-weight: 600;
        color: var(--csc-text);
        line-height: 1.25;
      }
      .hero-reason {
        font-size: 0.82rem;
        color: var(--csc-text-2);
        margin-top: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Strategy strip */
      .strategy {
        --strat-accent: var(--csc-accent);
        padding: 2px 18px 10px 18px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .strategy-why {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.82rem;
        color: var(--csc-text);
        padding: 6px 10px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--strat-accent) 12%, transparent);
        border-left: 3px solid var(--strat-accent);
      }
      @supports not (background: color-mix(in srgb, red, blue)) {
        .strategy-why { background: var(--csc-divider); }
      }
      .strategy-why ha-icon {
        --mdc-icon-size: 18px;
        color: var(--strat-accent);
        flex-shrink: 0;
      }
      .strategy-why #strategyWhyText {
        flex: 1;
        min-width: 0;
        line-height: 1.3;
      }
      .strategy-info {
        all: unset;
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        cursor: pointer;
        color: var(--csc-text-2);
        transition: background 0.2s ease, color 0.2s ease;
        flex-shrink: 0;
      }
      .strategy-info ha-icon { --mdc-icon-size: 16px; }
      .strategy-info:hover {
        background: color-mix(in srgb, var(--csc-text-2) 14%, transparent);
        color: var(--csc-text);
      }
      .strategy.expanded .strategy-info {
        color: var(--strat-accent);
      }
      .strategy-pills {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      @media (max-width: 520px) {
        .strategy-pills { grid-template-columns: 1fr; }
      }
      .strat-pill {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 8px;
        align-items: center;
        padding: 6px 10px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--csc-text-2) 8%, transparent);
        min-width: 0;
      }
      @supports not (background: color-mix(in srgb, red, blue)) {
        .strat-pill { background: var(--csc-divider); }
      }
      .strat-pill ha-icon {
        --mdc-icon-size: 18px;
        color: var(--csc-text-2);
      }
      .strat-pill.tone-up    ha-icon { color: #fb8c00; }
      .strat-pill.tone-down  ha-icon { color: #1e88e5; }
      .strat-pill.tone-active ha-icon { color: var(--strat-accent); }
      .strat-pill-text { min-width: 0; line-height: 1.15; }
      .strat-pill-l {
        font-size: 0.62rem;
        color: var(--csc-text-2);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .strat-pill-v {
        font-size: 0.92rem;
        font-weight: 700;
        color: var(--csc-text);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .strat-pill-s {
        font-size: 0.68rem;
        color: var(--csc-text-2);
        margin-top: 1px;
        line-height: 1.2;
        word-break: break-word;
      }
      .strategy-detail {
        display: none;
        grid-template-columns: repeat(2, 1fr);
        gap: 4px 14px;
        padding: 8px 10px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--csc-text-2) 6%, transparent);
        font-size: 0.75rem;
      }
      @supports not (background: color-mix(in srgb, red, blue)) {
        .strategy-detail { background: var(--csc-divider); }
      }
      @media (max-width: 520px) {
        .strategy-detail { grid-template-columns: 1fr; }
      }
      .strategy.expanded .strategy-detail { display: grid; }

      /* Decision ladder */
      .ladder {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-bottom: 8px;
        margin-bottom: 4px;
        border-bottom: 1px solid var(--csc-divider);
      }
      .ladder-title {
        font-size: 0.62rem;
        color: var(--csc-text-2);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 4px;
      }
      .ladder-row {
        display: grid;
        grid-template-columns: 18px auto 1fr;
        gap: 8px;
        align-items: center;
        font-size: 0.74rem;
        color: var(--csc-text-2);
        padding: 2px 0;
      }
      .ladder-row ha-icon { --mdc-icon-size: 14px; }
      .ladder-row.st-pass ha-icon { color: #43a047; }
      .ladder-row.st-fired {
        color: var(--csc-text);
        font-weight: 600;
      }
      .ladder-row.st-fired ha-icon { color: var(--strat-accent); }
      .ladder-row.st-skip { opacity: 0.45; }
      .ladder-row.warn .ladder-note { color: #e53935; }
      .ladder-note {
        text-align: right;
        font-variant-numeric: tabular-nums;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .strat-detail-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        color: var(--csc-text-2);
      }
      .strat-detail-row span:last-child {
        color: var(--csc-text);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }

      /* Main */
      .main {
        display: grid;
        grid-template-columns: 200px 1fr;
        gap: 18px;
        padding: 6px 18px 8px 18px;
        align-items: center;
        cursor: pointer;
      }
      @media (max-width: 520px) {
        .main { grid-template-columns: 1fr; }
        .dial { max-width: 220px; margin: 0 auto; }
      }
      .dial svg { display: block; width: 100%; height: auto; }
      #dialBg   { fill: none; stroke: var(--csc-divider); stroke-width: 14; stroke-linecap: round; }
      #dialFill { fill: none; stroke: url(#csc-fill-grad); stroke-width: 14; stroke-linecap: round; }
      #dialTemp { font-size: 38px; font-weight: 700; fill: var(--csc-text); font-variant-numeric: tabular-nums; }
      #dialTarget { font-size: 13px; fill: var(--csc-text-2); font-weight: 500; }
      #dialUnit { font-size: 10px; fill: var(--csc-text-2); text-transform: uppercase; letter-spacing: 0.08em; }

      /* Forecast */
      .forecast { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .forecast-title {
        display: flex; justify-content: space-between; align-items: baseline;
        font-size: 0.72rem; color: var(--csc-text-2);
        text-transform: uppercase; letter-spacing: 0.06em;
      }
      .forecast-title-right {
        display: inline-flex;
        align-items: baseline;
        gap: 10px;
      }
      .forecast-max {
        color: var(--csc-text-2);
        font-weight: 600;
        text-transform: none;
        letter-spacing: 0;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .forecast-title > span:first-child { min-width: 0; }
      .forecast-stale { color: #e53935; font-weight: 600; }
      .forecast svg { width: 100%; height: 110px; overflow: visible; }
      #forecastWindow { fill: rgba(76,175,80,0.20); transition: opacity 0.4s ease; }
      #forecastBand   { fill: rgba(255,193,7,0.18); stroke: none; }
      #forecastArea   { fill: url(#csc-area-grad); stroke: none; }
      #forecastLine   { fill: none; stroke: #FFC107; stroke-width: 1.5; }
      #forecastNow    { stroke: var(--csc-accent); stroke-width: 2; stroke-dasharray: 3 3; opacity: 0.85; }
      .forecast-title-tomorrow { margin-top: 4px; opacity: 0.85; }
      #forecastTomorrowSvg { height: 80px; }
      #forecastTomorrowBand { fill: rgba(144,164,174,0.22); stroke: none; }
      #forecastTomorrowArea { fill: url(#csc-area-grad-tomorrow); stroke: none; }
      #forecastTomorrowLine { fill: none; stroke: #90A4AE; stroke-width: 1.3; stroke-dasharray: 4 2; }
      .forecast-tick  { font-size: 9px; fill: var(--csc-text-2); }
      .forecast-meta {
        font-size: 0.74rem; color: var(--csc-text-2);
        display: flex; gap: 14px; flex-wrap: wrap; min-height: 1em;
      }

      /* Chips */
      .chips {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
        padding: 6px 18px 12px 18px;
        cursor: pointer;
      }
      .chip {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 10px;
        align-items: center;
        padding: 8px 12px;
        border-radius: 12px;
        background:
          linear-gradient(135deg,
            color-mix(in srgb, var(--chip-color) 18%, transparent),
            color-mix(in srgb, var(--chip-color)  6%, transparent));
        transition: background 0.3s ease;
      }
      @supports not (background: color-mix(in srgb, red, blue)) {
        .chip { background: var(--csc-divider); }
      }
      .chip ha-icon { --mdc-icon-size: 20px; color: var(--chip-color); }
      .chip .v { font-size: 0.95rem; font-weight: 700; color: var(--csc-text); font-variant-numeric: tabular-nums; line-height: 1.1; }
      .chip .l { font-size: 0.68rem; color: var(--csc-text-2); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 1px; }

      /* Settings */
      .settings { border-top: 1px solid var(--csc-divider); }
      .settings-toggle {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 18px;
        cursor: pointer;
        user-select: none;
        transition: background 0.2s;
      }
      .settings-toggle:hover {
        background: color-mix(in srgb, var(--csc-text-2) 6%, transparent);
      }
      .settings-toggle-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.85rem;
        font-weight: 500;
        color: var(--csc-text-2);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .settings-toggle-label ha-icon { --mdc-icon-size: 18px; }
      .chevron {
        --mdc-icon-size: 22px;
        color: var(--csc-text-2);
        transition: transform 0.3s ease;
      }
      .settings-toggle.expanded .chevron { transform: rotate(180deg); }

      .settings-content {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.4s ease, padding 0.3s ease;
        padding: 0 18px;
      }
      .settings-content.expanded {
        max-height: 900px;
        padding: 4px 18px 16px 18px;
      }

      .setting-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 0;
      }
      .setting-row + .setting-row {
        border-top: 1px solid var(--csc-divider);
      }
      .setting-row.missing { opacity: 0.4; pointer-events: none; }

      .toggle-row {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
      }
      .setting-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
      }
      .setting-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.9rem;
        color: var(--csc-text);
        font-weight: 500;
      }
      .setting-label ha-icon {
        --mdc-icon-size: 18px;
        color: var(--csc-text-2);
      }
      .setting-value {
        display: flex;
        align-items: baseline;
        gap: 8px;
        font-variant-numeric: tabular-nums;
      }
      .setting-value-main {
        font-size: 0.95rem;
        font-weight: 700;
        color: var(--csc-accent);
      }
      .setting-value-sub {
        font-size: 0.75rem;
        color: var(--csc-text-2);
      }
      .setting-desc {
        font-size: 0.72rem;
        color: var(--csc-text-2);
        line-height: 1.3;
        margin-top: -2px;
      }

      /* Slider */
      .slider {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: var(--csc-divider);
        background-image: linear-gradient(var(--csc-accent), var(--csc-accent));
        background-size: var(--fill-pct, 0%) 100%;
        background-repeat: no-repeat;
        outline: none;
        cursor: pointer;
        transition: background-color 0.3s ease;
      }
      .slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--csc-accent);
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }
      .slider::-webkit-slider-thumb:hover {
        transform: scale(1.15);
        box-shadow: 0 3px 10px rgba(0,0,0,0.35);
      }
      .slider::-webkit-slider-thumb:active {
        transform: scale(1.25);
      }
      .slider::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--csc-accent);
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        transition: transform 0.15s ease;
      }
      .slider::-moz-range-thumb:hover { transform: scale(1.15); }
      .slider::-moz-range-thumb:active { transform: scale(1.25); }

      /* Switch */
      .switch {
        position: relative;
        width: 44px;
        height: 24px;
        flex-shrink: 0;
      }
      .switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .switch-track {
        position: absolute;
        inset: 0;
        background: var(--csc-divider);
        border-radius: 12px;
        cursor: pointer;
        transition: background 0.25s ease;
      }
      .switch-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        box-shadow: 0 1px 3px rgba(0,0,0,0.35);
        transition: transform 0.25s ease;
      }
      .switch input:checked ~ .switch-track {
        background: var(--csc-accent);
      }
      .switch input:checked ~ .switch-track .switch-thumb {
        transform: translateX(20px);
      }
    `;
  }
}

const CONTROL_LABELS = {
  enabled:         'Automatisation (interrupteur)',
  target:          'Température cible',
  min:             'Température minimum',
  solar_trigger:   'Seuil déclenchement solaire',
  surplus_trigger: 'Seuil anti-injection',
  efficiency:      'Rendement',
  tank:            'Volume du ballon (L)',
};

class CumulusSolaireCardEditor extends HTMLElement {
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
    // Wait for BOTH hass and config so ha-form can resolve entity selectors;
    // building too early causes ha-form to fire spurious value-changed with
    // empty entity fields once hass arrives, which wipes the user's controls.
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-form { display: block; }
        .hint {
          margin: 0 0 10px 0;
          font-size: 0.78rem;
          color: var(--secondary-text-color);
          line-height: 1.4;
        }
        .hint code {
          background: var(--divider-color, rgba(127,127,127,0.18));
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 0.9em;
        }
      </style>
      <p class="hint">
        Le min/max/pas des sliders sont lus automatiquement depuis chaque
        <code>input_number</code>. Laissez un champ contrôle vide pour masquer ce réglage.
      </p>
    `;
    this._form = document.createElement('ha-form');
    this._form.addEventListener('value-changed', (e) => this._onFormChanged(e));
    this._form.computeLabel = (s) => this._label(s);
    this._form.computeHelper = (s) => this._helper(s);
    this.shadowRoot.appendChild(this._form);
    if (this._hass) this._form.hass = this._hass;
    this._form.schema = this._schema();
  }

  _schema() {
    const sensor = { entity: { filter: { domain: 'sensor' } } };
    const controlField = (key) => {
      const def = DEFAULT_CONTROLS[key];
      const domain = def.type === 'toggle'
        ? ['input_boolean', 'switch']
        : ['input_number', 'number'];
      return {
        name: `ctrl_${key}`,
        selector: { entity: { filter: { domain } } },
      };
    };
    return [
      { name: 'entity', required: true, selector: sensor },
      { name: 'forecast_entity', selector: sensor },
      { name: 'forecast_entity_tomorrow', selector: sensor },
      {
        name: 'show_settings',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              { value: 'collapsible', label: 'Repliable (défaut)' },
              { value: 'expanded',    label: 'Toujours déplié' },
              { value: 'hidden',      label: 'Masqué' },
            ],
          },
        },
      },
      {
        name: 'controls_section',
        type: 'expandable',
        title: 'Contrôles',
        expanded: true,
        schema: CONTROL_ORDER.map(controlField),
      },
    ];
  }

  _label(schema) {
    const labels = {
      entity:                   'Entité cumulus',
      forecast_entity:          'Entité prévisions Solcast du jour',
      forecast_entity_tomorrow: 'Entité prévisions Solcast de demain',
      show_settings:            'Panneau de réglages',
      controls_section:         'Contrôles',
    };
    if (labels[schema.name]) return labels[schema.name];
    if (schema.name && schema.name.startsWith('ctrl_')) {
      return CONTROL_LABELS[schema.name.slice(5)] || schema.name;
    }
    return undefined;
  }

  _helper(schema) {
    if (schema.name === 'entity') return 'sensor.cumulus_automation ou équivalent';
    if (schema.name === 'forecast_entity') return 'Prévisions Solcast pour aujourd\'hui';
    if (schema.name === 'forecast_entity_tomorrow') return 'Optionnel, pour la courbe de demain';
    if (schema.name && schema.name.startsWith('ctrl_')) {
      const def = DEFAULT_CONTROLS[schema.name.slice(5)];
      return def ? `Défaut : ${def.entity}, vide pour masquer` : undefined;
    }
    return undefined;
  }

  _configToData(cfg) {
    const data = {
      entity: cfg.entity || '',
      forecast_entity: cfg.forecast_entity || '',
      forecast_entity_tomorrow: cfg.forecast_entity_tomorrow || '',
      show_settings: cfg.show_settings === false
        ? 'hidden'
        : (cfg.show_settings || 'collapsible'),
    };
    const userControls = cfg.controls || {};
    for (const key of CONTROL_ORDER) {
      const u = userControls[key];
      let entityId;
      if (u === false || u === null) entityId = '';
      else if (typeof u === 'string') entityId = u;
      else if (u && typeof u === 'object' && u.entity) entityId = u.entity;
      else entityId = DEFAULT_CONTROLS[key].entity;
      data[`ctrl_${key}`] = entityId;
    }
    return data;
  }

  _dataToConfig(data) {
    const cfg = { ...this._config };
    cfg.entity = data.entity || '';
    if (data.forecast_entity) cfg.forecast_entity = data.forecast_entity;
    else delete cfg.forecast_entity;
    if (data.forecast_entity_tomorrow) cfg.forecast_entity_tomorrow = data.forecast_entity_tomorrow;
    else delete cfg.forecast_entity_tomorrow;

    if (data.show_settings === 'hidden') {
      cfg.show_settings = false;
    } else if (!data.show_settings || data.show_settings === 'collapsible') {
      delete cfg.show_settings;
    } else {
      cfg.show_settings = data.show_settings;
    }

    // Save controls verbatim. Don't silently drop entries that match the
    // current defaults — if defaults change in a future version, a user who
    // had explicitly selected the old default would lose their choice.
    const controls = {};
    let hasOverride = false;
    for (const key of CONTROL_ORDER) {
      const entityId = data[`ctrl_${key}`] || '';
      const existing = this._config.controls?.[key];
      if (!entityId) {
        controls[key] = false;
        hasOverride = true;
      } else if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        controls[key] = { ...existing, entity: entityId };
        hasOverride = true;
      } else {
        controls[key] = entityId;
        hasOverride = true;
      }
    }
    if (hasOverride) cfg.controls = controls;
    else delete cfg.controls;

    return cfg;
  }

  _syncForm() {
    if (!this._form || !this._config) return;
    const data = this._configToData(this._config);
    const json = JSON.stringify(data);
    if (json === this._lastDataJson) return;
    this._lastDataJson = json;
    this._form.data = data;
    // Mark initialized only once we've actually pushed user data into ha-form.
    // Any value-changed event fired BEFORE this point is a framework artefact
    // (e.g. selectors populating when hass arrives) and must not overwrite
    // the user's saved config.
    this._syncedOnce = true;
  }

  _onFormChanged(e) {
    if (!this._syncedOnce) return;
    const data = e.detail.value;
    this._lastDataJson = JSON.stringify(data);
    const newConfig = this._dataToConfig(data);
    this._config = newConfig;
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: newConfig },
      bubbles: true,
      composed: true,
    }));
  }
}

if (!customElements.get('cumulus-solaire-card-editor')) {
  customElements.define('cumulus-solaire-card-editor', CumulusSolaireCardEditor);
}

if (!customElements.get('cumulus-solaire-card')) {
  customElements.define('cumulus-solaire-card', CumulusSolaireCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'cumulus-solaire-card',
  name: 'Cumulus Solaire',
  description: "Carte tableau de bord pour l'automatisation cumulus solaire (Node-RED v5)",
  preview: false,
  documentationURL: 'https://github.com/USER/cumulus-solaire-card',
});
})();

// ===== clim-solaire-card.js ==============================================
(() => {
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
    const rows = a.units.map((u) => {
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
      return `
        <div class="unit ${cls}" data-entity="${esc(u.entity_id)}">
          <span class="u-pri">${esc(u.priority)}</span>
          <span class="u-name">
            ${esc(u.label)}
            ${u.group ? `<span class="u-group">${esc(u.group)}</span>` : ''}
          </span>
          <span class="u-temp">${u.current_temp != null ? fmtT(u.current_temp) : '—'}${target}</span>
          <span class="u-need" style="color:${need.color}">
            <ha-icon icon="${need.icon}"></ha-icon>
          </span>
          <span class="u-badge">${esc(badge)}</span>
        </div>`;
    }).join('');

    this._el.units.innerHTML = `<div class="units-head">Pièces, par priorité</div>${rows}`;
    this._el.units.querySelectorAll('.unit').forEach((el) => {
      el.addEventListener('click', () => this._moreInfo(el.dataset.entity));
    });
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
        font-size: 0.78rem; color: var(--clc-text-2); text-transform: uppercase;
        letter-spacing: 0.04em; margin-bottom: 4px;
      }
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
})();
