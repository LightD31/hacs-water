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
 *   4. Pastilles : production / surplus / legionella / Solcast
 *   5. Réglages (sliders + toggle, repliable)
 *
 * Aucune dépendance hormis ha-icon (fourni par HA).
 */

const VERSION = '1.6.0';

console.info(
  `%c CUMULUS-SOLAIRE-CARD %c v${VERSION} `,
  'color: white; background: #1976d2; font-weight: 700; padding: 2px 6px; border-radius: 3px 0 0 3px;',
  'color: #1976d2; background: white; font-weight: 700; padding: 2px 6px; border: 1px solid #1976d2; border-radius: 0 3px 3px 0;',
);

const MODES = {
  'disabled':            { color: '#9e9e9e', icon: 'mdi:robot-off',                 title: 'Automatisation désactivée', active: false },
  'sensor-error':        { color: '#e53935', icon: 'mdi:thermometer-off',           title: 'Sonde HS — état maintenu',  active: false },
  'legionella-critical': { color: '#e53935', icon: 'mdi:bacteria',                  title: 'Cycle anti-Legionella',     active: true  },
  'anti-injection':      { color: '#43a047', icon: 'mdi:transmission-tower-export', title: 'Charge le surplus solaire', active: true  },
  'legionella-due':      { color: '#fb8c00', icon: 'mdi:bacteria-outline',          title: 'Legionella à programmer',   active: false },
  'solcast-stale':       { color: '#757575', icon: 'mdi:cloud-off-outline',         title: 'Solcast périmé',            active: false },
  'forcing':             { color: '#fb8c00', icon: 'mdi:flash',                     title: 'Forçage dans la fenêtre',   active: true  },
  'heating':             { color: '#43a047', icon: 'mdi:water-boiler',              title: 'Chauffe avec le solaire',   active: true  },
  'target-reached':      { color: '#1e88e5', icon: 'mdi:check-circle-outline',      title: 'Cible atteinte',            active: false },
  'idle':                { color: '#1e88e5', icon: 'mdi:water-boiler-auto',         title: 'En attente',                active: false },
};

const DEFAULT_CONTROLS = {
  enabled:         { entity: 'input_boolean.cumulus_automation_enabled', label: 'Automatisation',     type: 'toggle' },
  target:          { entity: 'input_number.cumulus_target_temp',         label: 'Cible',              type: 'slider', icon: 'mdi:thermometer-check' },
  min:             { entity: 'input_number.cumulus_min_temp',            label: 'Minimum',            type: 'slider', icon: 'mdi:thermometer-low' },
  solar_trigger:   { entity: 'input_number.cumulus_solar_trigger',       label: 'Seuil solaire',      type: 'slider', icon: 'mdi:solar-power',
                     subtitleAttr: 'effective_trigger', subtitleLabel: 'effectif', subtitleUnit: 'W' },
  surplus_trigger: { entity: 'input_number.cumulus_surplus_trigger',     label: 'Seuil anti-injection', type: 'slider', icon: 'mdi:transmission-tower-export' },
  efficiency:      { entity: 'input_number.cumulus_efficiency',          label: 'Rendement',          type: 'slider', icon: 'mdi:percent-circle' },
};

const CONTROL_ORDER = ['enabled', 'target', 'min', 'solar_trigger', 'surplus_trigger', 'efficiency'];

class CumulusSolaireCard extends HTMLElement {
  static getStubConfig() {
    return { entity: 'sensor.cumulus_automation' };
  }

  static getConfigElement() {
    return document.createElement('cumulus-solaire-card-editor');
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("L'entité sensor.cumulus_automation est requise");
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
          <div class="hero-time" id="heroTime">--:--</div>
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
              <span>Production solaire — aujourd'hui</span>
              <span class="forecast-stale" id="forecastStale"></span>
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
      heroTime:     this.shadowRoot.querySelector('#heroTime'),
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
      forecastTomorrowTitle: this.shadowRoot.querySelector('#forecastTomorrowTitle'),
      forecastTomorrowSvg:   this.shadowRoot.querySelector('#forecastTomorrowSvg'),
      forecastTomorrowBand:  this.shadowRoot.querySelector('#forecastTomorrowBand'),
      forecastTomorrowArea:  this.shadowRoot.querySelector('#forecastTomorrowArea'),
      forecastTomorrowLine:  this.shadowRoot.querySelector('#forecastTomorrowLine'),
      forecastTomorrowTicks: this.shadowRoot.querySelector('#forecastTomorrowTicks'),
      chips:        this.shadowRoot.querySelector('#chips'),
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

    // Score badge toggle (delegation — meta is rebuilt on each render)
    this._scoreBadgeExpanded = false;
    this._el.forecastMeta.addEventListener('click', (e) => {
      const tgt = e.target.closest('[data-act="score-toggle"]');
      if (!tgt) return;
      e.stopPropagation();
      this._scoreBadgeExpanded = !this._scoreBadgeExpanded;
      this._render();
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
    this._el.heroReason.textContent = a.reason || '';

    const now = new Date();
    this._el.heroTime.textContent =
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');

    this._renderDial(a);
    this._renderForecast(a);
    this._renderForecastTomorrow(a);
    this._renderChips(a);
    this._renderSettings(a);
  }

  _mode(a) {
    if (a.enabled === false) return 'disabled';
    if (a.temp_sensor_available === false) return 'sensor-error';
    if (a.legionella_critical === true) return 'legionella-critical';
    if (a.anti_injection_active === true) return 'anti-injection';
    if (a.solcast_stale === true && !a.is_forcing) return 'solcast-stale';
    if (a.legionella_due === true && (a.water_temp ?? 0) < (a.reach_for ?? 60)) return 'legionella-due';
    if (a.is_forcing === true) return 'forcing';
    if (a.desired === 'on') return 'heating';
    const reach = a.reach_for ?? a.target_temp ?? 55;
    if ((a.water_temp ?? 0) >= reach) return 'target-reached';
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

    const maxW = Math.max(
      0.5,
      ...points.map(p => Math.max(p.w, p.p90 != null ? p.p90 : 0)),
    );
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
    if (a.window_start && a.window_end && a.duration_minutes > 0) {
      const ws = new Date(a.window_start);
      const we = new Date(a.window_end);
      const fmt = (d) => `${String(d.getHours()).padStart(2,'0')}h${String(d.getMinutes()).padStart(2,'0')}`;
      const avg = a.window_avg_w ? ` · ${Math.round(a.window_avg_w)} W` : '';
      const min = a.window_min_avg_w ? ` (min ${Math.round(a.window_min_avg_w)} W)` : '';
      parts.push(`<span class="badge"><span class="swatch win"></span> Fenêtre ${fmt(ws)}–${fmt(we)}${avg}${min}</span>`);
    } else if (a.window_skipped_reason) {
      parts.push(`<span>${this._escape(a.window_skipped_reason)}</span>`);
    }
    if (a.today_remaining_kwh != null && a.today_remaining_kwh > 0) {
      parts.push(`<span>Reste ${Number(a.today_remaining_kwh).toFixed(1)} kWh</span>`);
    }
    if (a.tomorrow_forecast_kwh != null || a.tomorrow_mode) {
      const labels = {
        poor: 'production faible',
        good: 'production élevée',
        mixed: 'production moyenne',
        legionella: 'cycle Legionella',
      };
      const lbl = labels[a.tomorrow_mode] || a.tomorrow_mode || '';
      const kwh = a.tomorrow_forecast_kwh;
      const p10 = a.tomorrow_p10_kwh;
      const p90 = a.tomorrow_p90_kwh;
      let txt = 'Demain';
      if (kwh != null) txt += ` : ${Number(kwh).toFixed(1)} kWh`;
      if (p10 != null && p90 != null && p90 > p10) {
        txt += ` (${Number(p10).toFixed(1)}–${Number(p90).toFixed(1)})`;
      }
      if (lbl) txt += ` · ${lbl}`;
      parts.push(`<span>${this._escape(txt)}</span>`);
    }
    if (a.day_after_forecast_kwh != null) {
      parts.push(`<span>J+2 : ${Number(a.day_after_forecast_kwh).toFixed(1)} kWh</span>`);
    }
    if (a.forecast_uncertainty != null && a.forecast_uncertainty >= 0.5) {
      parts.push(`<span title="Écart p10/p90 élevé">Prévision incertaine</span>`);
    }

    const scoreParts = [];
    const fmtPct = (v) => Math.round(Number(v) * 100) + '%';
    if (a.effective_score != null || a.tomorrow_score != null) {
      const main = a.effective_score != null ? a.effective_score : a.tomorrow_score;
      if (this._scoreBadgeExpanded) {
        const sub = [];
        if (a.tomorrow_score != null)       sub.push(`demain ${fmtPct(a.tomorrow_score)}`);
        if (a.worst_next2_score != null)    sub.push(`pire J+1/J+2 ${fmtPct(a.worst_next2_score)}`);
        if (a.tomorrow_weight != null)      sub.push(`poids ${fmtPct(a.tomorrow_weight)}`);
        if (a.forecast_uncertainty != null) sub.push(`incert. ${fmtPct(a.forecast_uncertainty)}`);
        scoreParts.push(
          `<span class="badge score-badge expanded" data-act="score-toggle" title="Cliquer pour réduire">` +
          `<ha-icon icon="mdi:chart-bell-curve-cumulative"></ha-icon>` +
          `Score ${fmtPct(main)}${sub.length ? ' · ' + this._escape(sub.join(' · ')) : ''}` +
          `</span>`
        );
      } else {
        scoreParts.push(
          `<span class="badge score-badge" data-act="score-toggle" title="Cliquer pour détailler">` +
          `<ha-icon icon="mdi:chart-bell-curve-cumulative"></ha-icon>` +
          `Score ${fmtPct(main)}` +
          `</span>`
        );
      }
    }

    this._el.forecastMeta.innerHTML = [...parts, ...scoreParts].join('');
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

    const maxW = Math.max(
      0.5,
      ...points.map(p => Math.max(p.w, p.p90 != null ? p.p90 : 0)),
    );
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
      {
        icon: a.anti_injection_active ? 'mdi:transmission-tower-export' : 'mdi:transmission-tower',
        color: a.anti_injection_active ? '#43a047' : '#9e9e9e',
        value: `${fmtSigned(a.potential_surplus)} W`,
        label: a.anti_injection_active ? 'Anti-injection' : 'Surplus',
      },
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
        info.valEl.textContent = '—';
        continue;
      }
      row.classList.remove('missing');

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
        grid-template-columns: 56px 1fr auto;
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
      .hero-time {
        font-variant-numeric: tabular-nums;
        font-size: 0.95rem;
        color: var(--csc-text-2);
        font-weight: 500;
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
      .forecast-meta .badge { display: inline-flex; align-items: center; gap: 5px; }
      .forecast-meta .swatch { width: 10px; height: 10px; border-radius: 2px; }
      .forecast-meta .swatch.win { background: rgba(76,175,80,0.5); }
      .forecast-meta .score-badge {
        cursor: pointer;
        padding: 2px 8px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--csc-accent) 14%, transparent);
        color: var(--csc-text);
        transition: background 0.2s ease;
        user-select: none;
      }
      .forecast-meta .score-badge:hover {
        background: color-mix(in srgb, var(--csc-accent) 24%, transparent);
      }
      .forecast-meta .score-badge ha-icon { --mdc-icon-size: 14px; color: var(--csc-accent); }
      @supports not (background: color-mix(in srgb, red, blue)) {
        .forecast-meta .score-badge { background: var(--csc-divider); }
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
        max-height: 600px;
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
    if (this._form) this._form.hass = hass;
  }

  _ensureBuilt() {
    if (this._form) return;
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
      forecast_entity:          'Entité prévisions Solcast — aujourd\'hui',
      forecast_entity_tomorrow: 'Entité prévisions Solcast — demain',
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
    if (schema.name === 'forecast_entity_tomorrow') return 'Optionnel — affiche la courbe de demain';
    if (schema.name && schema.name.startsWith('ctrl_')) {
      const def = DEFAULT_CONTROLS[schema.name.slice(5)];
      return def ? `Défaut : ${def.entity} — vide pour masquer` : undefined;
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
      } else if (entityId !== DEFAULT_CONTROLS[key].entity) {
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
  }

  _onFormChanged(e) {
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
