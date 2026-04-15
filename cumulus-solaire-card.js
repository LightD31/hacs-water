/**
 * Cumulus Solaire Card
 *
 * Custom Lovelace card pour le sensor.cumulus_automation produit par
 * le flow Node-RED v4 du cumulus solaire.
 *
 * Affiche en un coup d'œil :
 *   - L'état courant (anti-injection, legionella, forçage, etc.) avec
 *     priorité visuelle et animation
 *   - Un cadran 270° de la température de l'eau avec repères pour min,
 *     forçage, cible et seuil legionella
 *   - La courbe de production solaire prévue (Solcast) du jour, avec
 *     la fenêtre optimale surlignée et le curseur "maintenant"
 *   - Une rangée de pastilles : production, surplus, jours sans 60°C,
 *     fraîcheur Solcast
 *
 * Aucune dépendance hormis ha-icon (fourni par HA).
 */

const VERSION = '1.0.0';

console.info(
  `%c CUMULUS-SOLAIRE-CARD %c v${VERSION} `,
  'color: white; background: #1976d2; font-weight: 700; padding: 2px 6px; border-radius: 3px 0 0 3px;',
  'color: #1976d2; background: white; font-weight: 700; padding: 2px 6px; border: 1px solid #1976d2; border-radius: 0 3px 3px 0;',
);

const MODES = {
  'disabled':            { color: '#9e9e9e', icon: 'mdi:robot-off',                title: 'Automatisation désactivée',  active: false },
  'legionella-critical': { color: '#e53935', icon: 'mdi:bacteria',                 title: 'Cycle anti-Legionella',      active: true  },
  'anti-injection':      { color: '#43a047', icon: 'mdi:transmission-tower-export',title: 'Charge le surplus solaire',  active: true  },
  'legionella-due':      { color: '#fb8c00', icon: 'mdi:bacteria-outline',         title: 'Legionella à programmer',    active: false },
  'solcast-stale':       { color: '#757575', icon: 'mdi:cloud-off-outline',        title: 'Solcast périmé',             active: false },
  'forcing':             { color: '#fb8c00', icon: 'mdi:flash',                    title: 'Forçage dans la fenêtre',    active: true  },
  'heating':             { color: '#43a047', icon: 'mdi:water-boiler',             title: 'Chauffe avec le solaire',    active: true  },
  'target-reached':      { color: '#1e88e5', icon: 'mdi:check-circle-outline',     title: 'Cible atteinte',             active: false },
  'idle':                { color: '#1e88e5', icon: 'mdi:water-boiler-auto',        title: 'En attente',                 active: false },
};

class CumulusSolaireCard extends HTMLElement {
  static getStubConfig() {
    return {
      entity: 'sensor.cumulus_automation',
      forecast_entity: 'sensor.solcast_pv_forecast_previsions_pour_aujourd_hui',
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("L'entité sensor.cumulus_automation est requise");
    }
    this._config = {
      forecast_entity: 'sensor.solcast_pv_forecast_previsions_pour_aujourd_hui',
      ...config,
    };
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._render();
    if (!this._tick) {
      // Re-render every 30s to keep clock + "now" cursor accurate
      this._tick = setInterval(() => this._render(), 30000);
    }
  }

  disconnectedCallback() {
    if (this._tick) {
      clearInterval(this._tick);
      this._tick = null;
    }
  }

  getCardSize() { return 6; }

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
              </defs>
              <rect id="forecastWindow"></rect>
              <path id="forecastArea"></path>
              <path id="forecastLine"></path>
              <line id="forecastNow"></line>
              <g id="forecastTicks"></g>
            </svg>
            <div class="forecast-meta" id="forecastMeta"></div>
          </div>
        </div>

        <div class="chips" id="chips"></div>
      </ha-card>
    `;

    // Caches
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
      forecastArea:   this.shadowRoot.querySelector('#forecastArea'),
      forecastLine:   this.shadowRoot.querySelector('#forecastLine'),
      forecastNow:    this.shadowRoot.querySelector('#forecastNow'),
      forecastTicks:  this.shadowRoot.querySelector('#forecastTicks'),
      forecastMeta:   this.shadowRoot.querySelector('#forecastMeta'),
      forecastStale:  this.shadowRoot.querySelector('#forecastStale'),
      chips:        this.shadowRoot.querySelector('#chips'),
    };

    // Tap → more-info
    this._el.card.addEventListener('click', (ev) => {
      // Don't fire if user clicked something interactive in the future
      const e = new Event('hass-more-info', { bubbles: true, composed: true });
      e.detail = { entityId: this._config.entity };
      this.dispatchEvent(e);
    });

    this._built = true;
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
    const reason = so.state || '';
    const modeKey = this._mode(a);
    const m = MODES[modeKey];

    // Accent + icon
    this.style.setProperty('--csc-accent', m.color);
    this._el.accent.classList.toggle('active', m.active);
    this._el.heroIcon.style.background = m.color + '22';
    this._el.heroIcon.style.color = m.color;
    this._el.heroIcon.classList.toggle('active', m.active);
    this._el.heroIconEl.setAttribute('icon', m.icon);

    // Hero text
    this._el.heroTitle.textContent = m.title;
    this._el.heroReason.textContent = reason;

    // Time
    const now = new Date();
    this._el.heroTime.textContent =
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');

    // Dial + forecast + chips
    this._renderDial(a);
    this._renderForecast(a);
    this._renderChips(a);
  }

  _mode(a) {
    if (a.enabled === false) return 'disabled';
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

    // Background arc (always full)
    this._el.dialBg.setAttribute('d', arc(A_MIN, A_MAX));

    // Fill arc up to current temp
    const temp = (a.water_temp != null && !isNaN(a.water_temp)) ? Number(a.water_temp) : null;
    const tA = temp != null ? tToA(temp) : A_MIN;
    if (temp != null && tA > A_MIN + 0.5) {
      this._el.dialFill.setAttribute('d', arc(A_MIN, tA));
    } else {
      this._el.dialFill.setAttribute('d', '');
    }

    // Ticks
    const ticks = [];
    if (a.min_temp != null)          ticks.push({ v: Number(a.min_temp),         color: '#ef5350', big: false });
    if (a.forcage_threshold != null && a.forcage_threshold !== a.min_temp) {
      ticks.push({ v: Number(a.forcage_threshold), color: '#fb8c00', big: false });
    }
    const reach = a.reach_for ?? a.target_temp;
    if (reach != null)               ticks.push({ v: Number(reach),              color: '#43a047', big: true  });
    if (a.legionella_due === true && reach !== 60) {
      ticks.push({ v: 60, color: '#8e24aa', big: false });
    }

    // Build tick svg
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

    // Center labels
    this._el.dialTemp.textContent = (temp != null) ? `${temp.toFixed(1)}°` : '—';
    if (reach != null) {
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
      .map(s => ({ t: new Date(s.period_start).getTime(), w: Number(s[field] || 0) }))
      .filter(p => !isNaN(p.t) && p.t >= dayStart.getTime() && p.t < dayEndMs)
      .sort((p1, p2) => p1.t - p2.t);

    const maxW = Math.max(0.5, ...points.map(p => p.w));
    const wToY = (w) => padTop + usableH - (w / maxW) * usableH;

    // Smooth curve through points
    const screenPts = points.map(p => ({ x: tToX(p.t), y: wToY(p.w) }));
    const linePath = this._smoothPath(screenPts);

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

    // Window overlay
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

    // Now cursor
    const nowX = tToX(Date.now());
    this._el.forecastNow.setAttribute('x1', nowX.toFixed(1));
    this._el.forecastNow.setAttribute('x2', nowX.toFixed(1));
    this._el.forecastNow.setAttribute('y1', padTop);
    this._el.forecastNow.setAttribute('y2', padTop + usableH);

    // Hour ticks
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

    // Stale flag
    if (a.solcast_stale === true) {
      this._el.forecastStale.textContent = `⚠️ ${a.solcast_age_hours ?? '?'}h`;
    } else {
      this._el.forecastStale.textContent = '';
    }

    // Meta line
    const parts = [];
    if (a.window_start && a.window_end && a.duration_minutes > 0) {
      const ws = new Date(a.window_start);
      const we = new Date(a.window_end);
      const fmt = (d) => `${String(d.getHours()).padStart(2,'0')}h${String(d.getMinutes()).padStart(2,'0')}`;
      const avg = a.window_avg_w ? ` · ${Math.round(a.window_avg_w)} W` : '';
      parts.push(`<span class="badge"><span class="swatch win"></span> Fenêtre ${fmt(ws)}–${fmt(we)}${avg}</span>`);
    } else if (a.window_skipped_reason) {
      parts.push(`<span>${this._escape(a.window_skipped_reason)}</span>`);
    }
    if (a.tomorrow_mode && a.tomorrow_mode !== 'normal') {
      const labels = { poor: 'temps faible', good: 'temps fort', legionella: 'cycle Legionella' };
      const lbl = labels[a.tomorrow_mode] || a.tomorrow_mode;
      parts.push(`<span>Demain : ${this._escape(lbl)}</span>`);
    }
    if (a.kwhTomorrow != null && a.tomorrow_forecast_kwh != null) {
      // skip duplicate
    }
    this._el.forecastMeta.innerHTML = parts.join('');
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
      {
        icon: a.solcast_stale ? 'mdi:cloud-off-outline' : 'mdi:cloud-check-outline',
        color: a.solcast_stale ? '#e53935' : '#43a047',
        value: (a.solcast_age_hours != null) ? `${a.solcast_age_hours} h` : '—',
        label: 'Solcast',
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
        cursor: pointer;
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
      .hero-text {
        min-width: 0;
      }
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

      /* Main (dial + forecast) */
      .main {
        display: grid;
        grid-template-columns: 200px 1fr;
        gap: 18px;
        padding: 6px 18px 8px 18px;
        align-items: center;
      }
      @media (max-width: 520px) {
        .main { grid-template-columns: 1fr; }
        .dial { max-width: 220px; margin: 0 auto; }
      }

      .dial svg {
        display: block;
        width: 100%;
        height: auto;
      }
      #dialBg {
        fill: none;
        stroke: var(--csc-divider);
        stroke-width: 14;
        stroke-linecap: round;
      }
      #dialFill {
        fill: none;
        stroke: url(#csc-fill-grad);
        stroke-width: 14;
        stroke-linecap: round;
      }
      #dialTemp {
        font-size: 38px;
        font-weight: 700;
        fill: var(--csc-text);
        font-variant-numeric: tabular-nums;
      }
      #dialTarget {
        font-size: 13px;
        fill: var(--csc-text-2);
        font-weight: 500;
      }
      #dialUnit {
        font-size: 10px;
        fill: var(--csc-text-2);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      /* Forecast */
      .forecast {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .forecast-title {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        font-size: 0.72rem;
        color: var(--csc-text-2);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .forecast-stale {
        color: #e53935;
        font-weight: 600;
      }
      .forecast svg {
        width: 100%;
        height: 110px;
        overflow: visible;
      }
      #forecastWindow {
        fill: rgba(76,175,80,0.20);
        transition: opacity 0.4s ease;
      }
      #forecastArea {
        fill: url(#csc-area-grad);
        stroke: none;
      }
      #forecastLine {
        fill: none;
        stroke: #FFC107;
        stroke-width: 1.5;
      }
      #forecastNow {
        stroke: var(--csc-accent);
        stroke-width: 2;
        stroke-dasharray: 3 3;
        opacity: 0.85;
      }
      .forecast-tick {
        font-size: 9px;
        fill: var(--csc-text-2);
      }
      .forecast-meta {
        font-size: 0.74rem;
        color: var(--csc-text-2);
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
        min-height: 1em;
      }
      .forecast-meta .badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .forecast-meta .swatch {
        width: 10px;
        height: 10px;
        border-radius: 2px;
      }
      .forecast-meta .swatch.win {
        background: rgba(76,175,80,0.5);
      }

      /* Chips */
      .chips {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
        padding: 6px 18px 16px 18px;
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
      /* Fallback for browsers without color-mix */
      @supports not (background: color-mix(in srgb, red, blue)) {
        .chip { background: var(--csc-divider); }
      }
      .chip ha-icon {
        --mdc-icon-size: 20px;
        color: var(--chip-color);
      }
      .chip .v {
        font-size: 0.95rem;
        font-weight: 700;
        color: var(--csc-text);
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
      }
      .chip .l {
        font-size: 0.68rem;
        color: var(--csc-text-2);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: 1px;
      }
    `;
  }
}

if (!customElements.get('cumulus-solaire-card')) {
  customElements.define('cumulus-solaire-card', CumulusSolaireCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'cumulus-solaire-card',
  name: 'Cumulus Solaire',
  description: 'Carte tableau de bord pour l\'automatisation cumulus solaire (Node-RED v4)',
  preview: false,
  documentationURL: 'https://github.com/USER/cumulus-solaire-card',
});
