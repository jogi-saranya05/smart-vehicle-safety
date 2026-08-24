/**
 * RoadGuard — Global Emergency / SOS Modal
 * -----------------------------------------------------------------------
 * A single, reusable, framework-free overlay that reacts to
 * VehicleState.sos.status (js/vehicle-state.js) from ANY page. This is
 * what lets a crash triggered on the Dashboard interrupt whichever page
 * the driver is currently looking at (Trips, Authority, Settings, ...)
 * instead of requiring them to navigate to Alerts and scroll down to find
 * an SOS card.
 *
 * There is exactly ONE copy of this logic. Every page that should
 * participate in the global emergency flow just includes:
 *
 *   <script src="js/vehicle-state.js"></script>
 *   <script src="js/map-engine.js"></script>   (optional — enables the
 *                                                mini location map in the
 *                                                SOS ACTIVATED state)
 *   <script src="js/emergency-modal.js"></script>
 *
 * in that order (vehicle-state.js must load first). This file injects its
 * own <style> block and modal markup into the page on load — no page HTML
 * needs to be hand-edited beyond the <script> tag above.
 *
 * States mirror VehicleState.sos.status exactly, the same state machine
 * already driving the Alerts page's Emergency Response panel:
 *
 *   idle      -> modal hidden
 *   counting  -> "ACCIDENT DETECTED" + 10s countdown + CANCEL SOS
 *   cancelled -> "SOS Cancelled" + Return to Dashboard
 *   activated -> "SOS Activated" checklist + location panel + mini map
 *
 * The Alerts page keeps its own copy of this same state (js/alerts.js) as
 * a history/status view — that is intentional per the brief ("Alerts can
 * remain as the incident history/status page") and is NOT a second,
 * independent crash system: both read from the one VehicleState store.
 * -----------------------------------------------------------------------
 */
(function () {

  if (typeof VehicleState === "undefined") {
    console.error("emergency-modal.js: VehicleState is not loaded — include js/vehicle-state.js first.");
    return;
  }

  // Never build the overlay twice (e.g. a page accidentally including this
  // script more than once).
  if (document.getElementById("emergencyModalOverlay")) return;

  const DEMO_VEHICLE_LABEL = "Toyota Hilux (demo vehicle)";

  // ---- Styles -----------------------------------------------------------
  // Injected once, ahead of the markup, so every page gets the same look
  // without needing its own <link> tag added by hand.
  const STYLE = `
    .rg-emergency-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;

      display: flex;
      align-items: center;
      justify-content: center;

      padding: 24px;

      background: rgba(4, 9, 13, 0.82);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);

      font-family: inherit;
    }
    .rg-emergency-overlay[hidden] { display: none; }

    .rg-emergency-modal {
      width: 100%;
      max-width: 460px;
      max-height: calc(100vh - 48px);
      overflow-y: auto;

      background: var(--panel, #0d202d);
      border: 1px solid rgba(255, 93, 108, 0.4);
      border-radius: 20px;
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);

      padding: 28px 26px;

      color: var(--text, #edf7ff);
      text-align: center;
    }

    .rg-emergency-state[hidden] { display: none; }

    .rg-siren { font-size: 34px; line-height: 1; margin-bottom: 6px; }

    .rg-kicker {
      color: var(--red, #ff5d6c);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.1em;
      margin-bottom: 8px;
    }

    .rg-crash-title {
      margin: 0 0 18px;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: 0.02em;
      color: var(--red, #ff5d6c);
      animation: rg-crash-pulse 1s ease-in-out infinite;
    }
    @keyframes rg-crash-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }

    .rg-crash-meta {
      display: flex;
      flex-direction: column;
      gap: 10px;

      padding: 14px 16px;
      margin-bottom: 20px;

      border-radius: 12px;
      background: rgba(255, 93, 108, 0.08);
      border: 1px solid rgba(255, 93, 108, 0.18);
    }
    .rg-crash-meta > div {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .rg-crash-meta span {
      color: #8499a7;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .rg-crash-meta strong {
      color: var(--text, #edf7ff);
      font-size: 12px;
      font-weight: 700;
      text-align: right;
    }

    .rg-countdown-wrap { margin-bottom: 18px; }
    .rg-countdown-label {
      color: #8499a7;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      margin-bottom: 4px;
    }
    .rg-countdown-number {
      font-size: 72px;
      font-weight: 800;
      line-height: 1;
      color: var(--red, #ff5d6c);
      text-shadow: 0 0 30px rgba(255, 93, 108, 0.45);
    }

    .rg-cancel-btn {
      width: 100%;
      padding: 16px;
      margin-bottom: 14px;

      border-radius: 12px;
      border: 1px solid rgba(255, 93, 108, 0.5);
      background: var(--red, #ff5d6c);

      color: #150406;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.04em;

      cursor: pointer;
      transition: transform 0.1s ease, background 0.15s ease;
    }
    .rg-cancel-btn:hover { background: #ff7684; }
    .rg-cancel-btn:active { transform: scale(0.98); }

    .rg-fineprint {
      margin: 0;
      color: #8499a7;
      font-size: 10.5px;
      line-height: 1.5;
    }
    .rg-fineprint em { color: #5e7584; font-style: normal; }

    .rg-state-cancelled .rg-check-icon,
    .rg-state-activated .rg-siren {
      font-size: 34px;
      margin-bottom: 8px;
    }
    .rg-state-cancelled .rg-check-icon {
      color: var(--yellow, #f5bd55);
    }
    .rg-state-cancelled h1 { color: var(--yellow, #f5bd55); }
    .rg-state-activated h1 { color: var(--green, #35d89a); }

    .rg-emergency-state h1 {
      margin: 0 0 10px;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .rg-emergency-state > p {
      margin: 0 0 20px;
      color: #a9bac7;
      font-size: 12px;
      line-height: 1.6;
    }

    .rg-checklist {
      list-style: none;
      margin: 0 0 20px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      text-align: left;
    }
    .rg-checklist li {
      padding: 10px 14px;
      border-radius: 10px;
      background: var(--green-soft, rgba(53, 216, 154, 0.12));
      color: var(--green, #35d89a);
      font-size: 11.5px;
      font-weight: 800;
      letter-spacing: 0.02em;

      opacity: 0;
      transform: translateX(8px);
      transition: opacity 0.35s ease, transform 0.35s ease;
    }
    .rg-checklist li.rg-visible { opacity: 1; transform: translateX(0); }

    .rg-location-panel {
      text-align: left;
      margin-bottom: 20px;
      padding: 14px 16px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--line, rgba(150, 180, 200, 0.16));
    }
    .rg-location-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 0;
    }
    .rg-location-row span {
      color: #8499a7;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .rg-location-row strong {
      color: var(--text, #edf7ff);
      font-size: 11.5px;
      font-weight: 700;
      text-align: right;
    }
    .rg-mini-map {
      margin-top: 10px;
      height: 140px;
      border-radius: 10px;
      overflow: hidden;
      background: #0b1c28;
      border: 1px solid var(--line, rgba(150, 180, 200, 0.16));
    }

    .rg-return-btn {
      width: 100%;
      padding: 13px;
      border-radius: 12px;
      border: 1px solid var(--line, rgba(150, 180, 200, 0.16));
      background: rgba(255, 255, 255, 0.04);
      color: var(--text, #edf7ff);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.03em;
      cursor: pointer;
    }
    .rg-return-btn:hover { background: rgba(255, 255, 255, 0.08); }

    @media (max-width: 480px) {
      .rg-emergency-modal { padding: 22px 18px; }
      .rg-countdown-number { font-size: 58px; }
      .rg-crash-title { font-size: 21px; }
    }
  `;

  const styleEl = document.createElement("style");
  styleEl.id = "emergency-modal-styles";
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  // ---- Markup -------------------------------------------------------------
  const MARKUP = `
    <div class="rg-emergency-modal" role="alertdialog" aria-modal="true" aria-live="assertive" aria-labelledby="rgModalHeading">

      <!-- CRASH DETECTED + COUNTDOWN -->
      <div class="rg-emergency-state rg-state-crash" id="rgModalCrash" hidden>
        <div class="rg-siren">🚨</div>
        <div class="rg-kicker">SIMULATED EMERGENCY EVENT</div>
        <h1 id="rgModalHeading">ACCIDENT DETECTED</h1>

        <div class="rg-crash-meta">
          <div><span>Impact severity</span><strong id="rgCrashSeverity">—</strong></div>
          <div><span>Location</span><strong id="rgCrashLocation">—</strong></div>
          <div><span>Vehicle</span><strong id="rgCrashVehicle">—</strong></div>
        </div>

        <div class="rg-countdown-wrap">
          <div class="rg-countdown-label">SOS WILL ACTIVATE IN</div>
          <div class="rg-countdown-number" id="rgCountdownNumber">10</div>
        </div>

        <button class="rg-cancel-btn" id="rgCancelSosBtn">CANCEL SOS</button>

        <p class="rg-fineprint">
          Emergency services and emergency contacts will be notified if SOS is not cancelled.
          <em>Prototype — simulated. No real emergency services are contacted.</em>
        </p>
      </div>

      <!-- CANCELLED -->
      <div class="rg-emergency-state rg-state-cancelled" id="rgModalCancelled" hidden>
        <div class="rg-check-icon">✓</div>
        <h1>SOS CANCELLED</h1>
        <p>Emergency response was cancelled by the user.</p>
        <button class="rg-return-btn" id="rgReturnBtnCancelled">RETURN TO DASHBOARD</button>
      </div>

      <!-- SOS ACTIVATED -->
      <div class="rg-emergency-state rg-state-activated" id="rgModalActivated" hidden>
        <div class="rg-siren">🚨</div>
        <h1>SOS ACTIVATED</h1>
        <p class="rg-fineprint">RoadGuard has simulated the full emergency response sequence for this prototype demo. No real notifications were sent.</p>

        <ul class="rg-checklist" id="rgChecklist">
          <li data-check="incident">✓ EMERGENCY INCIDENT REGISTERED</li>
          <li data-check="location">✓ LOCATION SHARED</li>
          <li data-check="family">✓ FAMILY / EMERGENCY CONTACT NOTIFIED</li>
          <li data-check="authority">✓ INCIDENT SENT TO AUTHORITY DASHBOARD</li>
        </ul>

        <div class="rg-location-panel">
          <div class="rg-location-row"><span>Current location</span><strong id="rgCurrentLoc">—</strong></div>
          <div class="rg-location-row"><span>Accident location</span><strong id="rgAccidentLoc">—</strong></div>
          <div class="rg-location-row"><span>Timestamp</span><strong id="rgTimestamp">—</strong></div>
          <div class="rg-mini-map" id="rgMiniMap"></div>
        </div>

        <button class="rg-return-btn" id="rgReturnBtnActivated">RETURN TO DASHBOARD</button>
      </div>

    </div>
  `;

  const overlay = document.createElement("div");
  overlay.id = "emergencyModalOverlay";
  overlay.className = "rg-emergency-overlay";
  overlay.hidden = true;
  overlay.innerHTML = MARKUP;
  document.body.appendChild(overlay);

  // ---- Helpers ------------------------------------------------------------

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function formatLocation(location) {
    if (!location || typeof location.lat !== "number" || typeof location.lon !== "number") {
      return "Unknown";
    }
    return `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`;
  }

  function showModalState(name) {
    ["rgModalCrash", "rgModalCancelled", "rgModalActivated"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = id !== name;
    });
  }

  let countdownTimer = null;
  function clearCountdownTimer() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function renderCountdown(sos) {
    const secondsElapsed = (Date.now() - sos.crashTimestamp) / 1000;
    const remaining = Math.max(0, Math.ceil(sos.secondsTotal - secondsElapsed));
    setText("rgCrashSeverity", sos.severity || "Severe");
    setText("rgCrashLocation", formatLocation(sos.location));
    setText("rgCrashVehicle", DEMO_VEHICLE_LABEL);
    setText("rgCountdownNumber", String(remaining));
    return remaining;
  }

  function startCountdownTicker() {
    clearCountdownTimer();
    countdownTimer = setInterval(() => {
      const state = VehicleState.getState();
      if (state.sos.status !== "counting") {
        clearCountdownTimer();
        return;
      }
      const remaining = renderCountdown(state.sos);
      if (remaining <= 0) {
        clearCountdownTimer();
        VehicleState.activateSOS();
      }
    }, 250);
  }

  function revealChecklist() {
    const items = document.querySelectorAll("#rgChecklist li");
    items.forEach((item, i) => {
      item.classList.remove("rg-visible");
      setTimeout(() => item.classList.add("rg-visible"), 200 + i * 300);
    });
  }

  // ---- Mini location map (STATE 4) ----------------------------------------
  // Lazily loads Leaflet from the CDN if this page didn't already include
  // it, then reuses MapEngine (js/map-engine.js) — the same helper the
  // Dashboard/Trips maps use — instead of standing up a second mapping
  // approach.
  let miniMap = null;
  let leafletLoadPromise = null;

  function loadLeafletIfNeeded() {
    if (typeof L !== "undefined") return Promise.resolve();
    if (leafletLoadPromise) return leafletLoadPromise;

    leafletLoadPromise = new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);

      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Leaflet"));
      document.head.appendChild(script);
    });
    return leafletLoadPromise;
  }

  function renderMiniMap(location) {
    const container = document.getElementById("rgMiniMap");
    if (!container || typeof MapEngine === "undefined") return;
    if (!location || typeof location.lat !== "number") return;

    loadLeafletIfNeeded()
      .then(() => {
        if (!miniMap) {
          miniMap = MapEngine.initMap("rgMiniMap", {
            center: [location.lat, location.lon],
            zoom: 14,
            zoomControl: false,
          });
        } else {
          miniMap.setView([location.lat, location.lon], 14);
        }
        if (miniMap) {
          MapEngine.setVehicleMarker(miniMap, [location.lat, location.lon], {
            label: "Accident location (simulated)",
          });
          // The overlay is `display:none` while hidden, so Leaflet needs a
          // nudge to compute correct tile bounds once it becomes visible.
          setTimeout(() => miniMap && miniMap.invalidateSize(), 60);
        }
      })
      .catch((err) => console.error("emergency-modal: could not load map", err));
  }

  // ---- Main render ----------------------------------------------------------

  let loggedCrashId = null;

  function render(state) {
    const sos = state.sos;

    if (sos.status === "counting") {
      overlay.hidden = false;
      showModalState("rgModalCrash");
      renderCountdown(sos);
      startCountdownTicker();
      return;
    }

    clearCountdownTimer();

    if (sos.status === "cancelled") {
      overlay.hidden = false;
      showModalState("rgModalCancelled");
      return;
    }

    if (sos.status === "activated") {
      overlay.hidden = false;
      showModalState("rgModalActivated");

      const locationText = formatLocation(sos.location);
      setText("rgCurrentLoc", locationText);
      setText("rgAccidentLoc", locationText);
      setText(
        "rgTimestamp",
        sos.activatedTimestamp ? new Date(sos.activatedTimestamp).toLocaleTimeString() : "—"
      );
      renderMiniMap(sos.location);

      if (loggedCrashId !== sos.crashId) {
        loggedCrashId = sos.crashId;
        revealChecklist();
      } else {
        document.querySelectorAll("#rgChecklist li").forEach((el) => el.classList.add("rg-visible"));
      }
      return;
    }

    // idle — no active emergency, keep the app interface fully visible.
    overlay.hidden = true;
  }

  // ---- Controls -------------------------------------------------------------

  document.getElementById("rgCancelSosBtn").addEventListener("click", () => {
    VehicleState.cancelSOS();
  });

  function returnToDashboard() {
    VehicleState.returnToSafe();
    const onDashboard = /(^|\/)index\.html$/.test(window.location.pathname) || window.location.pathname.endsWith("/");
    if (!onDashboard) {
      window.location.href = "index.html";
    }
  }

  document.getElementById("rgReturnBtnCancelled").addEventListener("click", returnToDashboard);
  document.getElementById("rgReturnBtnActivated").addEventListener("click", returnToDashboard);

  // Deliberately no backdrop-click-to-close and no Escape-to-close handler:
  // during a live crash/SOS countdown the only way out is CANCEL SOS, so a
  // stray click or key press behind the modal can't dismiss it by accident.

  // ---- Sidebar "SOS Trigger" button ----------------------------------------
  // Present in the sidebar on every page. Fires the exact same
  // VehicleState.triggerCrash() the Dashboard's "ACCIDENT DETECTED" demo
  // control uses, so it's driven by the one shared crash/SOS state machine
  // rather than a second, page-local trigger. A no-op while an event is
  // already in progress, so repeat clicks (or clicking it from the Alerts
  // page while a crash is already counting down) can't stomp on an active
  // countdown/checklist.
  const sidebarSosBtn = document.getElementById("sidebarSosBtn");
  if (sidebarSosBtn) {
    sidebarSosBtn.addEventListener("click", () => {
      if (VehicleState.getState().sos.status !== "idle") return;
      VehicleState.triggerCrash({
        location: { lat: 28.6139, lon: 77.209 },
        severity: "Severe",
      });
    });
  }

  VehicleState.subscribe(render);
})();
