/**
 * RoadGuard — Shared Vehicle State
 * -----------------------------------------------------------------------
 * A single, framework-free state store representing the demo vehicle's
 * simulated telemetry. Any page can read the current state, subscribe to
 * changes, and dispatch updates — this is what lets the Dashboard's demo
 * controls (SAFE / HIGH-RISK WARNING / ACCIDENT DETECTED, Simulate Sudden
 * Braking, etc.) actually drive RiskEngine.computeRiskScore() instead of
 * being decorative buttons, and what lets the Alerts page's Crash/SOS flow
 * react to an ACCIDENT triggered from the Dashboard.
 *
 * This is intentionally NOT a framework: no build step, no dependencies.
 * State is held in a closure and mirrored into localStorage so it survives
 * navigation between pages (this is a multi-page site, not an SPA — each
 * page load re-runs this file) and stays in sync across tabs via the
 * browser's "storage" event. Include this script before any page-specific
 * script (dashboard.js, alerts.js, ...) that needs to read or write it.
 * -----------------------------------------------------------------------
 */
const VehicleState = (() => {

  const STORAGE_KEY = "roadguard.vehicleState.v1";

  const DEFAULT_STATE = {
    // telemetry
    speed: 45,
    recommendedSpeed: 50,
    suddenBraking: false,
    sharpTurn: false,
    weather: "clear",
    roadType: "urban",
    visibility: "high",

    // geographic risk context — a zone object from accidents_delhi.json,
    // or null when the vehicle isn't currently near a marked danger zone
    selectedZone: null,

    // demo narrative phase: "SAFE" | "WARNING" | "ACCIDENT"
    phase: "SAFE",

    // Crash detection + SOS flow (driven from Dashboard, consumed by
    // Alerts). "idle" = system armed, no active event.
    sos: {
      status: "idle", // "idle" | "counting" | "cancelled" | "activated"
      crashId: null,
      crashTimestamp: null,
      location: null,
      severity: null,
      secondsTotal: 10,
      activatedTimestamp: null,
      cancelledTimestamp: null,
    },
  };

  function loadPersisted() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Shallow-merge so a state shape saved by an older version of this
      // file (e.g. before `sos` existed) doesn't crash the current page.
      return { ...DEFAULT_STATE, ...parsed, sos: { ...DEFAULT_STATE.sos, ...(parsed.sos || {}) } };
    } catch (err) {
      console.error("VehicleState: failed to read persisted state", err);
      return null;
    }
  }

  function persist(snapshot) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (err) {
      console.error("VehicleState: failed to persist state", err);
    }
  }

  let state = loadPersisted() || { ...DEFAULT_STATE };
  const listeners = new Set();

  function getState() {
    return { ...state, sos: { ...state.sos } };
  }

  function notify() {
    const snapshot = getState();
    listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (err) {
        console.error("VehicleState listener error:", err);
      }
    });
  }

  /** Merge a partial update into state and notify subscribers. */
  function setState(partial) {
    state = { ...state, ...partial };
    persist(state);
    notify();
  }

  // Keep every open tab/page in sync: if the Dashboard (in one tab) writes
  // a new crash event, an Alerts tab already open elsewhere picks it up
  // immediately instead of only on next page load.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        state = JSON.parse(event.newValue);
        notify();
      } catch (err) {
        console.error("VehicleState: failed to apply cross-tab update", err);
      }
    });
  }

  /**
   * Subscribe to state changes. Immediately invokes the callback once with
   * the current state so consumers don't need a separate initial render
   * call. Returns an unsubscribe function.
   */
  function subscribe(fn) {
    listeners.add(fn);
    fn(getState());
    return () => listeners.delete(fn);
  }

  function simulateBraking() {
    setState({ suddenBraking: true });
  }

  function simulateSharpTurn() {
    setState({ sharpTurn: true });
  }

  /**
   * Clear abnormal-behavior flags, return speed to the recommended pace,
   * and reset context back to default conditions (so a prior ACCIDENT
   * preset's simulated fog/low-visibility context doesn't silently leak
   * into the next demo phase).
   */
  function resetTelemetry() {
    setState({
      suddenBraking: false,
      sharpTurn: false,
      speed: state.recommendedSpeed,
      weather: DEFAULT_STATE.weather,
      roadType: DEFAULT_STATE.roadType,
      visibility: DEFAULT_STATE.visibility,
    });
  }

  /**
   * Start a crash/SOS event: sets phase to ACCIDENT and arms a fresh
   * 10-second SOS countdown. Called from the Dashboard's "ACCIDENT
   * DETECTED" control; consumed by the Alerts page's Crash/SOS panel,
   * whichever page is open (or next opened).
   */
  function triggerCrash({ location = null, severity = "Severe", secondsTotal = 10 } = {}) {
    setState({
      phase: "ACCIDENT",
      sos: {
        status: "counting",
        crashId: `crash_${Date.now()}`,
        crashTimestamp: Date.now(),
        location,
        severity,
        secondsTotal,
        activatedTimestamp: null,
        cancelledTimestamp: null,
      },
    });
  }

  /** Driver cancels before the countdown reaches zero. No-op once resolved. */
  function cancelSOS() {
    if (state.sos.status !== "counting") return;
    setState({ sos: { ...state.sos, status: "cancelled", cancelledTimestamp: Date.now() } });
  }

  /** Countdown reached zero without cancellation. No-op once resolved. */
  function activateSOS() {
    if (state.sos.status !== "counting") return;
    setState({ sos: { ...state.sos, status: "activated", activatedTimestamp: Date.now() } });
  }

  /** Re-arm the system and return the vehicle to a clean SAFE state. */
  function returnToSafe() {
    setState({
      phase: "SAFE",
      selectedZone: null,
      speed: DEFAULT_STATE.speed,
      recommendedSpeed: DEFAULT_STATE.recommendedSpeed,
      suddenBraking: false,
      sharpTurn: false,
      weather: DEFAULT_STATE.weather,
      roadType: DEFAULT_STATE.roadType,
      visibility: DEFAULT_STATE.visibility,
      sos: { ...DEFAULT_STATE.sos },
    });
  }

  return {
    getState,
    setState,
    subscribe,
    simulateBraking,
    simulateSharpTurn,
    resetTelemetry,
    triggerCrash,
    cancelSOS,
    activateSOS,
    returnToSafe,
    DEFAULT_STATE,
  };
})();