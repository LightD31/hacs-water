// === Payload de sensor.cumulus_automation ===
// Home Assistant refuse `null` comme valeur d'attribut : un seul attribut nul
// fait échouer la validation du message ENTIER (« validation error », entité
// jamais mise à jour). Les clés sans valeur sont donc retirées en fin de nœud.

const iso = (t) => (t ? new Date(t).toISOString() : null);
const plans = (msg.plans || []).map(p => ({
    id: p.id,
    label: p.label,
    basis: p.basis,
    goal_temp: p.goal != null ? p.goal : null,
    deadline: iso(p.deadline),
    threshold_w: p.threshold,
    need_kwh: p.needKwh != null ? p.needKwh : null,
    free_kwh: p.freeKwh != null ? p.freeKwh : null,
    grid_kwh: p.gridKwh != null ? p.gridKwh : null,
    shortfall: p.shortfall === true,
    fallback: p.fallback === true,
    first_slot: iso(p.firstSlot),
    slot_count: (p.slots || []).length
}));
const lead = (msg.plans || []).find(p => p.id === msg.leadPlan);

const attrs = {
    reason: msg.reason,
    rule: msg.rule,
    action: msg.action,
    desired: msg.desired,
    current_switch: msg.switchState,
    switch_available: msg.switchAvailable === true,
    enabled: msg.enabled === true,

    // --- Températures et cibles ---
    water_temp: msg.temp,
    temp_sensor_available: msg.tempAvailable === true,
    degraded_sonde: msg.degradedSonde === true,
    sonde_down_hours: msg.sondeDownHours || 0,
    target_temp: msg.target,
    min_temp: msg.minT,
    reach_for: msg.reachFor,
    stop_temp: msg.stopTemp,
    tank_volume_l: msg.tankL,

    // --- Plan ---
    plans: plans,
    lead_plan: msg.leadPlan,
    lead_threshold_w: lead ? lead.threshold : null,
    planned_slots: (msg.plannedSlots || []).map(iso),
    need_kwh: msg.needKwh || 0,
    plan_grid_kwh: msg.planGridKwh || 0,
    plan_eval: msg.planEval || [],
    decision_path: msg.decisionPath || [],
    short_cycle_hold: msg.shortCycleHold === true,

    // --- Bilan électrique ---
    solar_power: msg.solar,
    grid_power: msg.gridPower,
    house_consumption: msg.house,
    cumulus_power: msg.cumulusPower,
    cumulus_draw: msg.cumulusDraw,
    cumulus_load_w: msg.loadW,
    thermostat_tripped: msg.thermostatTripped === true,
    potential_surplus: msg.potentialSurplus,
    surplus_avg_w: msg.surplusAvgClim,
    surplus_avg_own_w: msg.surplusAvgOwn,
    clim_recoverable_w: msg.climRecoverable,

    // --- Apprentissage ---
    base_load_w: msg.baseNow,
    base_profile: msg.baseProfile,
    solcast_bias_today: msg.biasToday,
    solcast_bias_long: msg.biasLong,
    forecast_now_w: msg.forecastNowW,
    decay_c_per_h: msg.decayRate,
    efficiency: msg.eff,
    efficiency_source: msg.effSource,
    efficiency_learned: msg.effLearned,
    efficiency_samples: msg.effSamples || 0,

    // --- Prévisions ---
    forecast_field: msg.forecastField,
    solcast_stale: msg.solcastStale === true,
    solcast_age_hours: msg.solcastAgeHours,
    today_forecast_kwh: msg.kwhToday,
    today_remaining_kwh: msg.kwhTodayRemaining,
    tomorrow_forecast_kwh: msg.kwhTomorrow,
    tomorrow_p10_kwh: msg.kwhTomorrowP10,
    tomorrow_p90_kwh: msg.kwhTomorrowP90,
    expected_surplus_today_kwh: msg.expectedSurplusKwh,

    // --- Ballon solaire amont ---
    solar_upstream_temp: msg.solarTankTemp,
    solar_upstream_available: msg.solarTankAvailable === true,
    solar_covers_target: msg.solarCoversTarget === true,
    solar_sufficient_threshold: msg.solarSufficientThreshold,
    solar_sufficient_margin: msg.solarMargin,

    // --- Anti-légionelle ---
    legionella_due: msg.legionellaDue === true,
    legionella_critical: msg.legionellaCritical === true,
    legionella_blocked: msg.legionellaBlocked === true,
    legionella_deadline: iso(msg.legionellaDeadline),
    days_since_high_temp: msg.daysSinceHighTemp,

    // --- Pause manuelle ---
    manual_hold_active: msg.manualHoldActive === true,
    manual_hold_until: iso(msg.manualHoldUntil),

    // --- Bilan du jour ---
    heat_kwh_today: msg.heatKwhToday,
    solar_kwh_today: msg.solarKwhToday,
    solar_share_today: msg.solarShareToday,

    last_action_at: iso(msg.lastActionAt),
    last_action: msg.lastAction,
    last_action_reason: msg.lastActionReason,
    last_update: new Date(msg.now).toISOString(),
    friendly_name: 'Cumulus Automation'
};

for (const k of Object.keys(attrs)) {
    if (attrs[k] === null || attrs[k] === undefined) delete attrs[k];
}

let stateStr = msg.state || msg.reason || 'Inconnu';
if (msg.degradedSonde && stateStr.indexOf('sonde HS') === -1) stateStr = 'Sonde HS · ' + stateStr;
msg.payload = { state: stateStr, attributes: attrs };
return msg;
