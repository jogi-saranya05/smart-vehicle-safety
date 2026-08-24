/**
 * RoadGuard — Authority Intelligence page
 * -----------------------------------------------------------------------
 * Loads the SAME dataset already used by Trips/Dashboard
 * (data/accidents_delhi.json) — no separate dataset is introduced. Every
 * number on this page (total incidents, casualties, severity distribution,
 * top causes, high-risk zone ranking, trend) comes directly from that
 * file's `meta` object and `zones` array.
 *
 * The dataset is a structured, synthetic demo dataset (see meta.source_note
 * in the JSON itself). This page surfaces that fact explicitly in the UI
 * rather than presenting the numbers as real government accident records.
 *
 * The "Priority Intervention Recommendation" is a simple RULE-BASED
 * heuristic (not an LLM call, not a trained model): it filters zones to
 * HIGH/CRITICAL severity, ranks them by 30-day incident trend, and maps
 * the resulting zone's top recorded cause to a small fixed set of
 * plausible interventions. See buildRecommendation() below.
 * -----------------------------------------------------------------------
 */

const AUTHORITY_DATA_URL = "data/accidents_delhi.json";

/** Rule-based mapping from a zone's recorded top cause to a concrete,
 *  data-grounded intervention suggestion. Deliberately simple and
 *  auditable — a hackathon prototype, not a trained model. */
const CAUSE_INTERVENTIONS = {
  overspeeding: "speed-calming measures (rumble strips, speed cameras) and stricter speed-limit enforcement",
  "poor road": "road-surface repair, pothole remediation, and improved lane markings",
  distraction: "additional signage, mobile-use enforcement checkpoints, and driver-awareness campaigns",
  "drunk driving": "randomized breathalyzer checkpoints and stricter night-time enforcement",
  weather: "improved drainage, better street lighting, and weather-linked warning signage",
};

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString() : n;
}

async function loadData() {
  const res = await fetch(AUTHORITY_DATA_URL);
  if (!res.ok) throw new Error("Failed to load accident dataset");
  return res.json();
}

function renderDatasetNotice(meta) {
  setText(
    "datasetNoticeText",
    `${meta.city} · ${fmt(meta.total_incidents)} records · ${meta.date_range[0]} to ${meta.date_range[1]}. ${meta.source_note}`
  );
}

function renderKpis(meta) {
  setText("kpiTotalIncidents", fmt(meta.total_incidents));
  setText("kpiDateRange", `${meta.date_range[0]} → ${meta.date_range[1]}`);

  setText("kpiHighRiskZones", fmt(meta.high_risk_zones));

  const trendSign = meta.monthly_trend_pct >= 0 ? "+" : "";
  const trendEl = document.getElementById("kpiMonthlyTrend");
  if (trendEl) {
    trendEl.textContent = `${trendSign}${meta.monthly_trend_pct}%`;
    // Rising incidents (positive trend) is bad news -> red; falling is good -> green.
    trendEl.style.color = meta.monthly_trend_pct > 0 ? "var(--red)" : "var(--green)";
  }
  setText(
    "kpiMonthlyTrendNote",
    meta.monthly_trend_pct > 0 ? "Incidents rising citywide" : "Incidents falling citywide"
  );

  setText("kpiCasualties", fmt(meta.total_casualties));
}

function renderSeverityBars(meta) {
  const container = document.getElementById("severityBars");
  if (!container) return;

  const dist = meta.severity_distribution;
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
  const order = ["fatal", "major", "minor"]; // most severe first

  container.innerHTML = order
    .map((key) => {
      const count = dist[key] || 0;
      const pct = Math.round((count / total) * 100);
      return `
        <div class="severity-bar-row">
          <div class="severity-bar-label ${key}">
            <span>${key.toUpperCase()}</span>
            <span class="count">${fmt(count)} &middot; ${pct}%</span>
          </div>
          <div class="severity-bar-track">
            <div class="severity-bar-fill ${key}" style="width:${pct}%;"></div>
          </div>
        </div>`;
    })
    .join("");
}

function renderCauseList(meta) {
  const container = document.getElementById("causeList");
  if (!container) return;

  const causes = Object.entries(meta.top_causes).sort((a, b) => b[1] - a[1]);

  container.innerHTML = causes
    .map(
      ([cause, count], i) => `
        <div class="cause-row">
          <span class="cause-rank">#${i + 1}</span>
          <span class="cause-name">${cause}</span>
          <span class="cause-count">${fmt(count)} incidents</span>
        </div>`
    )
    .join("");
}

function renderRiskTable(data) {
  const body = document.getElementById("authorityRiskTableBody");
  if (!body) return;

  const topZones = data.zones.slice(0, 8); // zones[] is already rank-ordered

  body.innerHTML = topZones
    .map((zone) => {
      const sevClass = zone.severity_level.toLowerCase();
      const trendClass = zone.trend_pct >= 0 ? "trend-up" : "trend-down";
      const trendSign = zone.trend_pct >= 0 ? "+" : "";
      return `
        <div class="risk-row">
          <span>#${zone.rank}</span>
          <strong>${zone.name}</strong>
          <span class="severity ${sevClass}">${zone.severity_level}</span>
          <span>${fmt(zone.incidents)}</span>
          <span class="${trendClass}">${trendSign}${zone.trend_pct}%</span>
          <span class="cause-cell">${zone.top_cause}</span>
        </div>`;
    })
    .join("");
}

/**
 * Rule-based recommendation:
 *   1. Keep only zones already flagged HIGH/CRITICAL severity.
 *   2. Rank them by 30-day incident trend (fastest-worsening first), then
 *      by raw incident count as a tiebreaker.
 *   3. Turn the top zone's actual recorded top cause into a concrete
 *      intervention suggestion via CAUSE_INTERVENTIONS.
 *   4. Add a short citywide-trend line for context.
 * No numbers here are invented — everything traces back to a zone object
 * or meta field from the loaded dataset.
 */
function buildRecommendation(data) {
  const { zones, meta } = data;
  const priorityZones = zones
    .filter((z) => z.severity_level === "HIGH" || z.severity_level === "CRITICAL")
    .sort((a, b) => (b.trend_pct - a.trend_pct) || (b.incidents - a.incidents));

  if (priorityZones.length === 0) {
    return {
      text: "No zones currently meet the HIGH/CRITICAL severity threshold in this dataset — no priority intervention is flagged this period.",
      basis: `Basis: ${fmt(meta.total_incidents)} incident dataset, ${meta.date_range[0]} to ${meta.date_range[1]}`,
    };
  }

  const top = priorityZones[0];
  const intervention =
    CAUSE_INTERVENTIONS[top.top_cause] ||
    "targeted enforcement and infrastructure review specific to this corridor's recorded cause";

  const trendDescription =
    top.trend_pct > 0
      ? `has seen a ${top.trend_pct}% increase in incidents over the last 30 days`
      : top.trend_pct < 0
      ? `has seen a ${Math.abs(top.trend_pct)}% decrease in incidents over the last 30 days, but remains a ${top.severity_level.toLowerCase()}-severity corridor`
      : `has held steady in incident volume over the last 30 days but remains a ${top.severity_level.toLowerCase()}-severity corridor`;

  const cityTrend =
    meta.monthly_trend_pct > 0
      ? `Citywide incidents are up ${meta.monthly_trend_pct}% this month, reinforcing the need for prioritized action.`
      : `Citywide incidents are down ${Math.abs(meta.monthly_trend_pct)}% this month, though this corridor is an exception worth monitoring closely.`;

  const text = `${top.name} ${trendDescription} (${fmt(top.incidents)} recorded incidents, top recorded cause: ${top.top_cause}). Authorities should prioritize ${intervention} in this corridor. ${cityTrend}`;

  const basis = `Basis: zone rank #${top.rank} of ${zones.length} · ${top.severity_level} severity · ${fmt(top.incidents)} incidents · ${top.trend_pct >= 0 ? "+" : ""}${top.trend_pct}% 30-day trend`;

  return { text, basis };
}

function renderRecommendation(data) {
  const { text, basis } = buildRecommendation(data);
  setText("recommendationText", text);
  setText("recommendationBasis", basis);
  setText(
    "recommendationTimestamp",
    `Generated from ${fmt(data.meta.total_incidents)}-record dataset`
  );
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!document.getElementById("kpiSection")) return;

  try {
    const data = await loadData();
    renderDatasetNotice(data.meta);
    renderKpis(data.meta);
    renderSeverityBars(data.meta);
    renderCauseList(data.meta);
    renderRiskTable(data);
    renderRecommendation(data);
  } catch (err) {
    console.error("RoadGuard Authority: failed to load accident dataset", err);
    setText("datasetNoticeText", "Could not load accident dataset.");
    setText("recommendationText", "Recommendation unavailable — dataset failed to load.");
  }
});
