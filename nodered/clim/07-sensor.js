// === Payload de sensor.clim_automation ===
// Home Assistant refuse `null` comme valeur d'attribut au premier niveau : un
// seul suffit à faire échouer le message ENTIER (« validation error »). Les
// clés sans valeur sont retirées en fin de nœud ; les null imbriqués dans
// `units` / `groups` ne sont pas validés et restent.

const units = (msg.units || []).map(u => ({
    entity_id: u.id,
    label: u.label,
    priority: u.priority,
    available: u.available === true,
    hvac_mode: u.hvacMode,
    current_temp: u.current,
    setpoint: u.setpoint,
    target_setpoint: u.targetSp,
    deep_setpoint: u.deepSp,
    idle_setpoint: u.idleSp,
    group: u.group,
    breaker_on: u.breakerOn !== false,
    need_mode: u.needMode,
    comfort_need: u.comfortNeed === true,
    need_reason: u.needReason,
    mode_supported: u.modeSupported !== false,
    owned: u.owned === true,
    manual_control: u.manualControl === true,
    hold_active: u.holdActive === true,
    desired: u.desired,
    desired_reason: u.desiredReason,
    action: u.action || 'none',
    power_w: u.powerW || 0,
    power_source: u.powerSource || null,
    learned_w: u.learnedW,
    start_need_w: u.startNeedW || null,
    min_run_left_min: u.minRunLeftMin || 0,
    min_off_left_min: u.minOffLeftMin || 0
}));

const fc = msg.forecast;
const attrs = {
    reason: msg.reason,
    enabled: msg.enabled === true,

    // --- Unités ---
    units: units,
    unit_count: msg.unitCount,
    priority_helper: msg.priorityHelper,
    priority_order_source: msg.priorityOrderSource,
    active_units: msg.activeLabels || [],
    active_count: msg.activeCount || 0,
    need_count: msg.needCount || 0,
    manual_count: msg.manualCount || 0,
    hold_count: msg.holdCount || 0,
    action_count: msg.actionCount || 0,
    actions: msg.actions || [],
    max_units: msg.maxUnits,

    // --- Routeur ---
    router_action: msg.routerAction,
    router_detail: msg.routerDetail,
    error_w: msg.errorW,
    export_avg_w: msg.exportAvg,
    export_margin_w: msg.exportMargin,
    import_allowance_w: msg.importAllowance,
    allowance_active: msg.allowanceActive === true,
    decision_path: msg.decisionPath || [],

    // --- Confort ---
    season_mode: msg.seasonMode,
    season_basis: msg.seasonBasis,
    target_cool: msg.targetCool,
    target_heat: msg.targetHeat,
    cool_store_target: msg.coolStore,
    heat_store_target: msg.heatStore,
    store_band: msg.storeBand,
    cool_floor: msg.coolFloor,
    heat_ceiling: msg.heatCeiling,
    can_cool: msg.canCool === true,
    can_heat: msg.canHeat === true,
    outdoor_temp: msg.outdoorTemp,
    outdoor_source: msg.outdoorSource,
    outdoor_available: msg.outdoorAvailable === true,
    outdoor_cool_min: msg.outdoorCoolMin,
    outdoor_heat_max: msg.outdoorHeatMax,
    forecast_today_max: fc ? fc.todayMax : null,
    forecast_today_min: fc ? fc.todayMin : null,
    forecast_tomorrow_max: fc ? fc.tomorrowMax : null,
    forecast_tomorrow_min: fc ? fc.tomorrowMin : null,

    // --- Bilan électrique ---
    solar_power: msg.solar,
    grid_power: msg.gridPower,
    recoverable_w: msg.recoverable || 0,
    clim_power_total_w: msg.climTotal || 0,
    metered: msg.metered === true,
    groups: (msg.groups || []).map(gr => ({
        name: gr.name, breaker: gr.switchId, breaker_on: gr.breakerOn, power: gr.power, units: gr.units
    })),
    clim_kwh_today: msg.climKwhToday,
    clim_solar_share_today: msg.climSolarShareToday,

    // --- Eau chaude (lecture seule) ---
    cumulus_sensor: msg.cumulusSensor,
    cumulus_found: msg.cumulusFound === true,
    cumulus_heating: msg.cumulusHeating === true,
    cumulus_draw_w: msg.cumulus ? Math.round(msg.cumulus.draw || 0) : 0,
    cumulus_yield_w: msg.cumulusYieldW || 0,

    no_temp_hours: msg.noTempHours || 0,
    any_temp_available: msg.anyTempAvailable === true,

    last_action_at: msg.lastActionAt ? new Date(msg.lastActionAt).toISOString() : null,
    last_action: msg.lastActionSummary,
    last_action_reason: msg.lastActionReason,
    last_update: new Date(msg.now || Date.now()).toISOString(),
    friendly_name: 'Clim Automation'
};

for (const k of Object.keys(attrs)) {
    if (attrs[k] === null || attrs[k] === undefined) delete attrs[k];
}
msg.payload = { state: msg.state || msg.reason || 'Inconnu', attributes: attrs };
return msg;
