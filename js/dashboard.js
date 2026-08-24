/**
 * RoadGuard — Dashboard wiring
 * -----------------------------------------------------------------------
 * Connects index.html to the existing RiskEngine (js/risk-engine.js) and
 * VehicleState (js/vehicle-state.js). Every number shown on the Dashboard
 * now comes from RiskEngine.computeRiskScore() — nothing here is a
 * hardcoded display value.
 *
 * The SAFE / HIGH-RISK WARNING / ACCIDENT DETECTED buttons set a demo
 * "phase" preset (speed, selected zone, behavior flags). The Simulate
 * Sudden Braking / Simulate Sharp Turn / Return to Normal buttons layer
 * abnormal-behavior signals on top of whatever phase is active, so the
 * demo can show the risk score responding to BOTH historical geography
 * and live vehicle behavior — matching the project's core "vehicle
 * behavior is a risk signal, not proof of an accident-prone area" idea.
 *
 * Reuses the same dataset as Trips (data/accidents_delhi.json) but does
 * not modify it, and does not touch js/heatmap.js or js/risk-engine.js.
 *
 * PART 3 — UNIFIED NAVIGATION MAP: this file now owns ONE map
 * (#dashboardMap) that shows the vehicle, destination, danger zones AND
 * the full route comparison (Route A/B/C) together — js/routes.js no
 * longer creates a second, separate map. js/routes.js's Routes.mount()
 * draws the routes + zone markers onto the map created here; this file
 * keeps owning the vehicle/destination markers and the phase-based
 * "high-risk zone ahead" highlight, since those are tied to VehicleState.
 * -----------------------------------------------------------------------
 */

const DASHBOARD_DATA_URL = "data/accidents_delhi.json";

let dashboardZones = null;

/**
 * Simulated demo route (Part 1: static geometry, no live routing API /
 * animation). Shared with js/routes.js (Routes.ORIGIN / Routes.DESTINATION)
 * so the vehicle position, the drawn routes and the destination all agree
 * with each other on the one map. The demo high-risk zone (getDemoZone(),
 * rank #1, "Nehru Place") sits on Route A, so "approaching the danger
 * zone" and "driving the current route" are the same event, matching the
 * project's demo story.
 */
const DASHBOARD_ROUTE_START = Routes.ORIGIN;
const DASHBOARD_ROUTE_DESTINATION = Routes.DESTINATION;

async function loadDashboardData() {
  const res = await fetch(DASHBOARD_DATA_URL);
  if (!res.ok) throw new Error("Failed to load accident dataset");
  const data = await res.json();
  dashboardZones = data.zones || [];
  return data;
}

/** The zone used for the "high-risk zone ahead" demo narrative. */
function getDemoZone() {
  if (!dashboardZones || dashboardZones.length === 0) return null;
  return dashboardZones.find((z) => z.rank === 1) || dashboardZones[0];
}

/** Straight-line distance in degrees — good enough for picking "nearby" zones on a small map, not for real routing. */
function degDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function lerpLatLng(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * ---------------------------------------------------------------------
 * Dashboard live map (js/map-engine.js wrapper around the shared Leaflet
 * setup). This is now the ONE navigation map for the whole page: it
 * shows the simulated vehicle position, destination, ALL compared routes
 * (drawn by Routes.mount, colored per-segment by risk, recommended route
 * emphasized), and the real danger zones those routes pass through — with
 * the zone the vehicle is approaching becoming visually prominent once
 * phase != SAFE.
 * ---------------------------------------------------------------------
 */
let dashboardMap = null;
let dashboardVehicleMarker = null;
let dashboardDestinationMarker = null;
let dashboardZoneMarkersByName = {};
let dashboardRouteZones = [];
let dashboardHighlightedZoneName = null;

function initDashboardMap() {
  const note = document.getElementById("dashboardMapNote");

  dashboardMap = MapEngine.initMap("dashboardMap", {
    center: DASHBOARD_ROUTE_START,
    zoom: 10,
  });
  if (!dashboardMap) {
    if (note) note.textContent = "Could not load map.";
    return;
  }

  // Draws Route A/B/C (segment-colored, recommended emphasized) + the
  // real zone markers those routes pass through, and wires the route
  // comparison cards below the map to highlight a route on click.
  const { routeLatLngs, zoneMarkersByName, matchedZones } = Routes.mount(
    dashboardMap,
    dashboardZones || []
  );
  dashboardZoneMarkersByName = zoneMarkersByName;
  dashboardRouteZones = matchedZones;

  dashboardVehicleMarker = MapEngine.setVehicleMarker(dashboardMap, DASHBOARD_ROUTE_START, {
    label: "Toyota Hilux (simulated position)",
  });
  dashboardDestinationMarker = MapEngine.setDestinationMarker(dashboardMap, DASHBOARD_ROUTE_DESTINATION, {
    label: "Destination (demo)",
  });

  MapEngine.fitToBounds(dashboardMap, [
    DASHBOARD_ROUTE_START,
    DASHBOARD_ROUTE_DESTINATION,
    ...routeLatLngs,
  ]);

  if (note) {
    note.textContent =
      "Simulated vehicle position \u00b7 both routes scored live by RiskEngine \u00b7 click a route card to highlight it on the map";
  }
}

/**
 * Reflect the current VehicleState phase on the map: move the vehicle
 * marker along the static demo route (SAFE = start, WARNING = approaching
 * the zone, ACCIDENT = at the zone) and highlight the active danger zone.
 * No animation/tweening yet (Part 1 scope) — the marker jumps between
 * three fixed points on phase change.
 */
function updateDashboardMap(state) {
  if (!dashboardMap) return;

  const zone = state.selectedZone;
  const waypoint = zone ? [zone.lat, zone.lon] : DASHBOARD_ROUTE_START;

  let vehiclePos = DASHBOARD_ROUTE_START;
  if (state.phase === "WARNING") vehiclePos = lerpLatLng(DASHBOARD_ROUTE_START, waypoint, 0.7);
  else if (state.phase === "ACCIDENT") vehiclePos = waypoint;

  dashboardVehicleMarker = MapEngine.setVehicleMarker(dashboardMap, vehiclePos, {
    existing: dashboardVehicleMarker,
  });

  // Un-highlight whichever zone was previously prominent, if any.
  if (dashboardHighlightedZoneName && dashboardHighlightedZoneName !== zone?.name) {
    const prevZone = (dashboardZones || []).find((z) => z.name === dashboardHighlightedZoneName);
    const prevMarker = dashboardZoneMarkersByName[dashboardHighlightedZoneName];
    if (prevZone && prevMarker) MapEngine.unhighlightZone(prevMarker, prevZone);
    dashboardHighlightedZoneName = null;
  }

  if (state.phase !== "SAFE" && zone) {
    const marker = dashboardZoneMarkersByName[zone.name];
    if (marker) {
      MapEngine.highlightZone(marker, zone);
      dashboardHighlightedZoneName = zone.name;
    }
  }
}

/**
 * Demo phase presets. These set plausible telemetry for each narrative
 * beat described in the project brief (SAFE 24 -> WARNING 61 -> ACCIDENT).
 * Sudden braking / sharp turn flags set by the simulation buttons are
 * preserved across a phase change unless the phase itself overrides them
 * (ACCIDENT always forces both on, to guarantee a compelling demo state).
 */
function applyPhasePreset(phase) {
  const zone = getDemoZone();
  const current = VehicleState.getState();

  if (phase === "SAFE") {
    // Full reset: re-arms the Crash/SOS flow on the Alerts page too, so
    // switching back to SAFE always leaves the system ready for the next
    // demo run.
    VehicleState.returnToSafe();
  } else if (phase === "WARNING") {
    VehicleState.setState({
      phase,
      selectedZone: zone,
      // Entering a marked danger zone: driver is above the zone's lower
      // recommended pace. Historical risk for this dataset tops out
      // around avg_risk_score 0.46, so speed/behavior signals carry more
      // of the weight here — matching the brief's "behavior is a signal,
      // not proof" framing.
      speed: 70,
      recommendedSpeed: 40,
      // preserve any braking/turn flags already toggled by sim controls
      suddenBraking: current.suddenBraking,
      sharpTurn: current.sharpTurn,
      weather: "clear",
      roadType: "urban",
      visibility: "high",
    });
  } else if (phase === "ACCIDENT") {
    VehicleState.setState({
      selectedZone: zone,
      speed: 92,
      recommendedSpeed: 45,
      suddenBraking: true,
      sharpTurn: true,
      // Simulated adverse context accompanying the crash event.
      weather: "fog",
      roadType: "highway",
      visibility: "low",
    });
    // Arms the 10-second SOS countdown (sets phase to ACCIDENT itself) and
    // hands the event to the Alerts page's Crash/SOS panel, whichever tab
    // it's opened in.
    VehicleState.triggerCrash({
      location: zone ? { lat: zone.lat, lon: zone.lon } : { lat: 28.6139, lon: 77.209 },
      severity: "Severe",
    });
  }
}

function levelClass(level) {
  return (level || "").toLowerCase();
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderDashboard(state, result) {
  const zone = state.selectedZone;
  const phase = state.phase;

  // ---- Risk score / level (top status card) ----
  setText("riskLevelInline", result.level);
  const riskScoreBig = document.getElementById("riskScoreBig");
  if (riskScoreBig) {
    riskScoreBig.innerHTML =
      `${result.score} <span style="font-size:13px;color:var(--muted);font-weight:600;">/100 &middot; <span id="riskLevelInline">${result.level}</span></span>`;
  }
  setText("stateSubtext", phase === "ACCIDENT"
    ? "Abnormal impact-pattern detected — SOS flow available on Alerts"
    : `${result.level === "LOW" ? "No" : result.level.toLowerCase()} speed/behavior risk currently detected`);

  // ---- ALL CLEAR card <-> crash mode ----
  const allClearCard = document.getElementById("allClearCard");
  const statusDot = document.getElementById("statusDot");
  const statusMainText = document.getElementById("statusMainText");
  const allClearLabel = document.getElementById("allClearLabel");
  const allClearSubtext = document.getElementById("allClearSubtext");
  if (phase === "ACCIDENT") {
    allClearCard && allClearCard.classList.add("crash-mode");
    statusDot && statusDot.classList.replace("green", "red");
    setText("statusMainText", "CRASH DETECTED");
    setText("allClearLabel", "EMERGENCY");
    setText("allClearSubtext", "Simulated impact event — see Alerts for SOS flow");
  } else {
    allClearCard && allClearCard.classList.remove("crash-mode");
    statusDot && statusDot.classList.replace("red", "green");
    setText("statusMainText", "LIVE");
    setText("allClearLabel", "ALL CLEAR");
    setText("allClearSubtext", phase === "WARNING" ? "High-risk zone ahead" : "No Threats Detected");
  }

  // ---- state buttons active styling ----
  ["safeStateBtn", "warningStateBtn", "accidentStateBtn"].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle("is-active", btn.dataset.phase === phase);
  });

  // ---- speed telemetry ----
  setText("speedValue", Math.round(state.speed));
  setText("speedTargetText", `${state.recommendedSpeed} km/h recommended`);
  const over = state.speed - state.recommendedSpeed;
  setText(
    "safeMarginText",
    over > 0
      ? `${Math.round(over)} km/h over recommended speed`
      : `${Math.round(Math.abs(over))} km/h under recommended speed`
  );

  // ---- simulation flags summary ----
  const flags = [];
  if (state.suddenBraking) flags.push("Sudden braking");
  if (state.sharpTurn) flags.push("Sharp turn");
  setText("telemetryFlagsText", flags.length ? `${flags.join(" + ")} detected` : "No abnormal driving behavior detected");

  // ---- route card danger-zone label ----
  setText("routeDangerZoneLabel", zone ? zone.name : "No active zone");

  // ---- high-risk zone panel ----
  setText("riskZoneName", zone ? zone.name : "No Active Zone");
  setText("riskScoreValue", result.score);
  const riskLevelBadge = document.getElementById("riskLevelBadge");
  if (riskLevelBadge) {
    riskLevelBadge.textContent = result.level;
    riskLevelBadge.className = `risk-level ${levelClass(result.level)}`;
  }
  setText(
    "riskDescriptionText",
    zone
      ? `${zone.incidents} incidents recorded \u00b7 top cause: ${zone.top_cause}`
      : "No active high-risk zone nearby"
  );

  // ---- breakdown ----
  setText("breakdownHistorical", result.breakdown.historical);
  setText("breakdownSpeed", result.breakdown.speed);
  setText("breakdownBraking", result.breakdown.braking);
  setText("breakdownTurning", result.breakdown.turning);
  setText("breakdownContext", result.breakdown.context);

  // ---- alert-sent badge ----
  const alertSent = document.getElementById("alertSentBadge");
  if (alertSent) alertSent.style.display = phase === "SAFE" ? "none" : "inline-block";
}

function computeAndRender(state) {
  const result = RiskEngine.computeRiskScore({
    zone: state.selectedZone,
    speed: state.speed,
    recommendedSpeed: state.recommendedSpeed,
    suddenBraking: state.suddenBraking,
    sharpTurn: state.sharpTurn,
    context: { weather: state.weather, roadType: state.roadType, visibility: state.visibility },
  });
  renderDashboard(state, result);
  updateDashboardMap(state);
}

function wireControls() {
  document.getElementById("safeStateBtn")?.addEventListener("click", () => applyPhasePreset("SAFE"));
  document.getElementById("warningStateBtn")?.addEventListener("click", () => applyPhasePreset("WARNING"));
  document.getElementById("accidentStateBtn")?.addEventListener("click", () => applyPhasePreset("ACCIDENT"));

  document.getElementById("simulateBrakingBtn")?.addEventListener("click", () => VehicleState.simulateBraking());
  document.getElementById("simulateTurnBtn")?.addEventListener("click", () => VehicleState.simulateSharpTurn());
  document.getElementById("resetTelemetryBtn")?.addEventListener("click", () => VehicleState.resetTelemetry());
}

document.addEventListener("DOMContentLoaded", async () => {
  // Only run on the Dashboard page where the map container exists.
  if (!document.getElementById("dashboardMap")) return;

  try {
    await loadDashboardData();
    initDashboardMap();
  } catch (err) {
    console.error("RoadGuard Dashboard: failed to load accident dataset", err);
    const note = document.getElementById("dashboardMapNote");
    if (note) note.textContent = "Could not load accident dataset.";
  }

  wireControls();
  VehicleState.subscribe(computeAndRender);

  // Start the demo in the SAFE state (matches the brief's "Risk Score: 24/100 — LOW" opening beat).
  applyPhasePreset("SAFE");
});
