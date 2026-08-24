/**
 * RoadGuard — Alerts page: Crash Detection & SOS flow
 * -----------------------------------------------------------------------
 * Renders one of four Emergency Response panel states, driven entirely by
 * VehicleState.sos.status (js/vehicle-state.js):
 *
 *   idle      -> "SYSTEM ARMED"        (default)
 *   counting  -> "CRASH DETECTED" + 10s countdown + CANCEL SOS
 *   cancelled -> "SOS Cancelled"        (driver cancelled in time)
 *   activated -> "SOS Activated" checklist (Family notified / Location
 *                shared / Incident registered — all simulated)
 *
 * The event that starts this flow (VehicleState.triggerCrash) is fired by
 * the Dashboard's "ACCIDENT DETECTED" control (js/dashboard.js). Because
 * VehicleState persists to localStorage and syncs across tabs, this page
 * picks up a crash whether it was already open when the crash was
 * triggered, or opened afterwards, or open in a different tab entirely.
 *
 * The countdown is computed from the crash's stored timestamp rather than
 * a fixed local counter, so remaining time is correct even if this page
 * loads a few seconds after the crash was actually triggered elsewhere.
 * -----------------------------------------------------------------------
 */

let countdownTimer = null;
let loggedCrashId = null; // last crash whose result we've written to the alert list

function clearCountdownTimer() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function formatLocation(location) {
  if (!location || typeof location.lat !== "number" || typeof location.lon !== "number") {
    return "Unknown";
  }
  return `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`;
}

function showState(name) {
  ["emergencyArmed", "emergencyCrash", "emergencyCancelled", "emergencyActivated"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = id !== name;
  });
}

/** Prepend a new entry to the "Recent Alerts" list, matching the existing markup. */
function logAlert({ icon, cssClass, badgeClass, badgeText, title, description }) {
  const list = document.getElementById("alertList");
  if (!list) return;

  const article = document.createElement("article");
  article.className = `alert-item ${cssClass} just-logged`;
  article.innerHTML = `
    <div class="alert-icon">${icon}</div>
    <div class="alert-content">
      <div class="alert-title-row">
        <h3>${title}</h3>
        <span class="alert-badge ${badgeClass}">${badgeText}</span>
      </div>
      <p>${description}</p>
      <span class="alert-time">Just now · Toyota Hilux</span>
    </div>
    <button class="alert-action">View</button>
  `;
  list.prepend(article);

  const activeCount = document.getElementById("activeAlertsCount");
  if (activeCount) activeCount.textContent = String(Number(activeCount.textContent) + 1);
}

function bumpCriticalCount() {
  const criticalCount = document.getElementById("criticalEventsCount");
  if (criticalCount) criticalCount.textContent = String(Number(criticalCount.textContent) + 1);
  const subtext = document.getElementById("criticalEventsSubtext");
  if (subtext) subtext.textContent = "Last event just now";
}

function revealChecklist() {
  const items = document.querySelectorAll("#sosChecklist .sos-check-item");
  items.forEach((item, i) => {
    item.classList.remove("visible");
    setTimeout(() => item.classList.add("visible"), 250 + i * 400);
  });
}

function renderCountdown(sos) {
  const secondsElapsed = (Date.now() - sos.crashTimestamp) / 1000;
  const remaining = Math.max(0, Math.ceil(sos.secondsTotal - secondsElapsed));

  setText("crashSeverity", sos.severity || "Severe");
  setText("crashLocation", formatLocation(sos.location));
  setText("countdownNumber", String(remaining));

  return remaining;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Starts (or restarts) the interval that ticks the visible countdown down
 *  to zero, then automatically activates SOS. */
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

function renderEmergencyPanel(state) {
  const sos = state.sos;

  if (sos.status === "counting") {
    showState("emergencyCrash");
    renderCountdown(sos);
    startCountdownTicker();
    return;
  }

  clearCountdownTimer();

  if (sos.status === "cancelled") {
    showState("emergencyCancelled");
    if (loggedCrashId !== sos.crashId) {
      loggedCrashId = sos.crashId;
      logAlert({
        icon: "✓",
        cssClass: "resolved-alert",
        badgeClass: "resolved",
        badgeText: "RESOLVED",
        title: "SOS Cancelled by Driver",
        description: `Crash detected at ${formatLocation(sos.location)} — driver cancelled the automated SOS before activation. Logged as a false alarm. (Simulated)`,
      });
    }
    return;
  }

  if (sos.status === "activated") {
    showState("emergencyActivated");
    if (loggedCrashId !== sos.crashId) {
      loggedCrashId = sos.crashId;
      revealChecklist();
      bumpCriticalCount();
      logAlert({
        icon: "!",
        cssClass: "critical-alert",
        badgeClass: "critical",
        badgeText: "CRITICAL",
        title: "Crash Detected — SOS Activated",
        description: `Impact severity: ${sos.severity || "Severe"} at ${formatLocation(sos.location)}. Family notified, location shared, and incident registered. (Simulated)`,
      });
    } else {
      // Re-render (e.g. page just loaded into an already-activated state)
      // without re-animating or re-logging.
      document.querySelectorAll("#sosChecklist .sos-check-item").forEach((el) => el.classList.add("visible"));
    }
    return;
  }

  // idle
  showState("emergencyArmed");
}

function wireControls() {
  document.getElementById("cancelSosBtn")?.addEventListener("click", () => {
    VehicleState.cancelSOS();
  });
  document.getElementById("rearmBtnCancelled")?.addEventListener("click", () => {
    VehicleState.returnToSafe();
  });
  document.getElementById("rearmBtnActivated")?.addEventListener("click", () => {
    VehicleState.returnToSafe();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // Only run on pages that actually have the Emergency panel markup.
  if (!document.getElementById("emergencyPanel")) return;

  wireControls();
  VehicleState.subscribe(renderEmergencyPanel);
});
