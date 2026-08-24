/**
 * RoadGuard — Trips page data wiring
 * Loads data/accidents_delhi.json and renders:
 *   1. A real Leaflet heatmap + zone markers (replaces the old fake CSS map)
 *   2. The Top Risk Zones table
 *   3. The weekly crossings bar chart + trip metrics
 *
 * Dataset: structured demo dataset (synthetic India-wide road-accident
 * records), scoped to Delhi. Zones are density-based clusters labeled with
 * nearby locality names for readability — not verified real intersections.
 */

const SEVERITY_COLOR = {
  CRITICAL: "#ff5d6c",
  HIGH: "#ff8d68",
  MODERATE: "#f5bd55",
  LOW: "#35d89a",
};

async function loadAccidentData() {
  const res = await fetch("data/accidents_delhi.json");
  if (!res.ok) throw new Error("Failed to load accident dataset");
  return res.json();
}

function renderMap(data) {
  const mapEl = document.getElementById("riskMap");
  if (!mapEl || typeof L === "undefined") return;

  const map = L.map(mapEl, {
    zoomControl: true,
    attributionControl: true,
  }).setView([28.6139, 77.2090], 11);

  // Dark basemap to match the dashboard's visual identity
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 18,
      subdomains: "abcd",
    }
  ).addTo(map);

  // Heat layer from raw accident points, weighted by severity
  const heatPoints = data.points.map((p) => [p.lat, p.lon, p.weight / 6]);
  L.heatLayer(heatPoints, {
    radius: 22,
    blur: 28,
    maxZoom: 13,
    gradient: { 0.2: "#35d89a", 0.5: "#f5bd55", 0.75: "#ff8d68", 1: "#ff5d6c" },
  }).addTo(map);

  // Zone markers (clustered locality-level hotspots)
  data.zones.forEach((zone) => {
    const color = SEVERITY_COLOR[zone.severity_level] || SEVERITY_COLOR.MODERATE;
    const radius = 8 + Math.min(zone.incidents / 20, 10);

    const marker = L.circleMarker([zone.lat, zone.lon], {
      radius,
      color: "#ffffff55",
      weight: 1,
      fillColor: color,
      fillOpacity: 0.55,
    }).addTo(map);

    marker.bindPopup(
      `<div class="risk-popup">
        <strong>${zone.name}</strong>
        <span>${zone.severity_level} · ${zone.incidents} incidents recorded</span>
        <span>Top cause: ${zone.top_cause}</span>
        <span>Trend (30d vs prior 30d): ${zone.trend_pct > 0 ? "+" : ""}${zone.trend_pct}%</span>
      </div>`
    );
  });

  const note = document.getElementById("mapSourceNote");
  if (note) {
    note.textContent = `${data.meta.city} · ${data.meta.total_incidents.toLocaleString()} records · ${data.meta.date_range[0]} to ${data.meta.date_range[1]} · ${data.meta.source_note}`;
  }
}

function renderRiskTable(data) {
  const body = document.getElementById("riskTableBody");
  if (!body) return;

  const top5 = data.zones.slice(0, 5);
  body.innerHTML = top5
    .map((zone) => {
      const trendClass = zone.trend_pct >= 0 ? "trend-up" : "trend-down";
      const trendSign = zone.trend_pct >= 0 ? "+" : "";
      const sevClass = zone.severity_level.toLowerCase();
      return `
        <div class="risk-row">
          <span>#${zone.rank}</span>
          <strong>${zone.name}</strong>
          <span class="severity ${sevClass}">${zone.severity_level}</span>
          <span>${zone.incidents} incidents</span>
          <span>${zone.last_incident_date} (${zone.days_since_last}d ago)</span>
          <span class="${trendClass}">${trendSign}${zone.trend_pct}%</span>
        </div>`;
    })
    .join("");
}

function renderWeeklyChart(data) {
  const chart = document.getElementById("weeklyBarChart");
  if (!chart) return;

  const days = [
    ["Monday", "Mon"], ["Tuesday", "Tue"], ["Wednesday", "Wed"],
    ["Thursday", "Thu"], ["Friday", "Fri"], ["Saturday", "Sat"], ["Sunday", "Sun"],
  ];
  const counts = data.weekly_crossings;
  const max = Math.max(...Object.values(counts));
  const peakEntry = Object.entries(counts).reduce((a, b) => (b[1] > a[1] ? b : a));

  chart.innerHTML = days
    .map(([full, short]) => {
      const val = counts[full] || 0;
      const pct = Math.round((val / max) * 100);
      const isActive = full === peakEntry[0];
      return `
        <div class="bar-column${isActive ? " active" : ""}">
          <span class="bar-value">${val}</span>
          <div class="bar" style="height:${pct}%;"></div>
          <span>${short}</span>
        </div>`;
    })
    .join("");

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const avg = Math.round(total / 7);
  document.getElementById("totalCrossings").textContent = total.toLocaleString();
  document.getElementById("avgDailyCrossings").textContent = avg.toLocaleString();
  document.getElementById("peakDay").textContent = days.find((d) => d[0] === peakEntry[0])[1];
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const data = await loadAccidentData();
    renderMap(data);
    renderRiskTable(data);
    renderWeeklyChart(data);
  } catch (err) {
    console.error("RoadGuard: failed to load accident data", err);
    const note = document.getElementById("mapSourceNote");
    if (note) note.textContent = "Could not load accident dataset.";
  }
});
