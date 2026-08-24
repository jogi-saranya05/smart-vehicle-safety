/**
 * RoadGuard — Route Risk Comparison (Part 3: unified navigation map)
 * -----------------------------------------------------------------------
 * Compares predefined demo routes and scores each one with the SAME
 * RiskEngine used by the Dashboard and Trips page. Distance/ETA per route
 * is still prototype demo data (no live routing API in this hackathon
 * build), but each route:
 *
 *   1. Has real geographic waypoints, drawn as Leaflet polylines on the
 *      Dashboard's single "Active Route" map (js/map-engine.js) — this
 *      module no longer creates its own separate map/section. It MOUNTS
 *      onto whatever map js/dashboard.js already initialized, so vehicle
 *      position, destination, danger zones and routes are all one
 *      coherent picture instead of two disconnected map cards.
 *   2. Is modeled as several SEGMENTS (waypoint-to-waypoint legs), each
 *      either passing a real marked zone from data/accidents_delhi.json
 *      or passing no marked zone at all ("clean" leg).
 *
 * HOW ROUTE RISK IS CALCULATED (unchanged from Part 2)
 * ---------------------------------------------------------------------
 * For each route:
 *   a. Resolve every segment's zoneName (if any) against the real
 *      dataset's zones array. Unmatched segments contribute risk 0.
 *   b. avgRisk  = mean(avg_risk_score across ALL segments, 0 for unmatched)
 *      maxRisk  = the single highest avg_risk_score among the route's
 *                 segments (0 if none matched)
 *      aggregateAvgRisk = 0.65 * avgRisk + 0.35 * maxRisk
 *   c. severity_breakdown for the aggregate zone is the incident-count
 *      SUM of only the segments that matched a real zone.
 *   d. That aggregate object is fed into RiskEngine.computeRiskScore() —
 *      the exact same function/formula used everywhere else in the app.
 *
 * PUBLIC API (consumed by js/dashboard.js)
 *   Routes.ORIGIN / Routes.DESTINATION   — shared start/destination coords
 *   Routes.scoreRoutes(allZones)         — score every demo route
 *   Routes.pickRecommendedRoute(scored)  — lowest-risk route
 *   Routes.mount(map, allZones)          — draw routes + zone markers on
 *                                           an EXISTING map, render the
 *                                           comparison cards/banner, and
 *                                           wire click-to-highlight.
 *                                           Returns { scoredRoutes,
 *                                           recommended, matchedZones }.
 *   Routes.selectRoute(routeId)          — highlight one route on the map
 *                                           (used by card clicks, exposed
 *                                           in case other UI wants it).
 *
 * Does not modify js/risk-engine.js, js/heatmap.js, js/map-engine.js,
 * dashboard.js's vehicle/destination markers, or the dataset.
 * -----------------------------------------------------------------------
 */
const Routes = (() => {

  const ROUTE_DATA_URL = "data/accidents_delhi.json";

  // Same simulated "current position" used by the Dashboard, so the
  // routes, the vehicle marker and the destination all agree with each
  // other on one map.
  const ORIGIN = [28.402, 77.245];
  const DESTINATION = [28.6315, 77.2167];

  /**
   * Demo route definitions. Each route is a list of waypoints; consecutive
   * waypoints form a SEGMENT. `zoneName` on a waypoint means "this segment
   * arrives at / passes through that real marked zone" — omit it (or use
   * null) for a clean leg with no marked danger zone.
   */
  const DEMO_ROUTES = [
    {
      id: "routeA",
      name: "Route A — Direct via Nehru Place",
      distanceKm: 8.2,
      etaMin: 18,
      roadType: "urban",
      assumedSpeed: 60,
      recommendedSpeed: 35,
      waypoints: [
        { lat: 28.402, lon: 77.245, zoneName: null }, // start
        { lat: 28.46093, lon: 77.23843, zoneName: "Nehru Place" },
        { lat: 28.5942, lon: 77.25739, zoneName: "Lajpat Nagar" },
        { lat: 28.58161, lon: 77.15755, zoneName: "Green Park" },
        { lat: 28.6315, lon: 77.2167, zoneName: null }, // destination
      ],
    },
    {
      id: "routeB",
      name: "Route B — Ring Road Bypass",
      distanceKm: 8.7,
      etaMin: 20,
      roadType: "highway",
      assumedSpeed: 55,
      recommendedSpeed: 60,
      waypoints: [
        { lat: 28.402, lon: 77.245, zoneName: null }, // start
        { lat: 28.45323, lon: 76.98747, zoneName: "Vasant Kunj" },
        { lat: 28.52, lon: 77.02, zoneName: null }, // clean ring-road stretch
        { lat: 28.55459, lon: 77.04677, zoneName: "Dwarka" },
        { lat: 28.6315, lon: 77.2167, zoneName: null }, // destination
      ],
    },
    {
      id: "routeC",
      name: "Route C — Inner City via Connaught Place",
      distanceKm: 7.5,
      etaMin: 22,
      roadType: "urban",
      assumedSpeed: 40,
      recommendedSpeed: 38,
      waypoints: [
        { lat: 28.402, lon: 77.245, zoneName: null }, // start
        { lat: 28.58161, lon: 77.15755, zoneName: "Green Park" },
        { lat: 28.66153, lon: 76.9765, zoneName: "Connaught Place" },
        { lat: 28.6315, lon: 77.2167, zoneName: null }, // destination
      ],
    },
  ];

  /** Resolve one waypoint's zoneName against the real dataset zones array. */
  function resolveZone(zoneName, allZones) {
    if (!zoneName) return null;
    return allZones.find((z) => z.name === zoneName) || null;
  }

  /** A segment's displayed risk level = the zone it arrives at, or LOW. */
  function segmentLevel(zone) {
    return zone ? zone.severity_level : "LOW";
  }

  function buildSegments(route, allZones) {
    const segments = [];
    for (let i = 0; i < route.waypoints.length - 1; i++) {
      const from = route.waypoints[i];
      const to = route.waypoints[i + 1];
      const zone = resolveZone(to.zoneName, allZones);
      segments.push({
        from: [from.lat, from.lon],
        to: [to.lat, to.lon],
        zone,
        level: segmentLevel(zone),
      });
    }
    return segments;
  }

  function buildRouteAggregateZone(segments) {
    const riskValues = segments.map((s) => (s.zone ? s.zone.avg_risk_score : 0));
    const avgRisk = riskValues.reduce((a, b) => a + b, 0) / riskValues.length;
    const maxRisk = Math.max(0, ...riskValues);
    const aggregateAvgRisk = avgRisk * 0.65 + maxRisk * 0.35;

    const matchedZones = [];
    const severity_breakdown = {};
    segments.forEach((s) => {
      if (!s.zone) return;
      if (!matchedZones.find((z) => z.name === s.zone.name)) matchedZones.push(s.zone);
    });
    matchedZones.forEach((zone) => {
      Object.entries(zone.severity_breakdown || {}).forEach(([k, v]) => {
        severity_breakdown[k] = (severity_breakdown[k] || 0) + v;
      });
    });

    return { avg_risk_score: aggregateAvgRisk, severity_breakdown, matchedZones };
  }

  /** Score every demo route against the real dataset via RiskEngine. */
  function scoreRoutes(allZones) {
    return DEMO_ROUTES.map((route) => {
      const segments = buildSegments(route, allZones);
      const aggregateZone = buildRouteAggregateZone(segments);

      const riskResult = RiskEngine.computeRiskScore({
        zone: aggregateZone,
        speed: route.assumedSpeed,
        recommendedSpeed: route.recommendedSpeed,
        suddenBraking: false,
        sharpTurn: false,
        context: { weather: "clear", roadType: route.roadType, visibility: "high" },
      });

      return { ...route, segments, matchedZones: aggregateZone.matchedZones, riskResult };
    });
  }

  function pickRecommendedRoute(scoredRoutes) {
    return scoredRoutes.reduce((best, r) =>
      r.riskResult.score < best.riskResult.score ? r : best
    );
  }

  function levelClass(level) {
    return (level || "").toLowerCase();
  }

  function buildRecommendationText(scoredRoutes, recommended) {
    const fastest = scoredRoutes.reduce((f, r) => (r.etaMin < f.etaMin ? r : f));

    if (recommended.id === fastest.id) {
      return `${recommended.name} is both the fastest option and the lowest predicted risk (${recommended.riskResult.score}/100, ${recommended.riskResult.level}).`;
    }

    const extraMin = recommended.etaMin - fastest.etaMin;
    const riskDrop = fastest.riskResult.score - recommended.riskResult.score;
    const riskDropPct =
      fastest.riskResult.score > 0 ? Math.round((riskDrop / fastest.riskResult.score) * 100) : 0;

    const timePhrase =
      extraMin > 0
        ? `adds about ${extraMin} min`
        : extraMin < 0
        ? `is actually ${Math.abs(extraMin)} min faster`
        : "takes the same time";

    const riskPhrase =
      riskDropPct > 0
        ? `${riskDropPct}% lower predicted risk`
        : `a predicted risk score of ${recommended.riskResult.score} vs ${fastest.riskResult.score}`;

    return `Take ${recommended.name} — ${timePhrase} compared to ${fastest.name}, for ${riskPhrase}.`;
  }

  // ---- module state (the one map instance we mount onto) ----
  let currentMap = null;
  let scoredRoutesCache = [];
  let recommendedRoute = null;
  let selectedRouteId = null;
  let routeLayersById = {};
  let routeCardsById = {};

  function renderRouteCard(route, isRecommended) {
    const { riskResult } = route;
    const zoneNote = route.matchedZones.length
      ? `Passes: ${route.matchedZones.map((z) => `${z.name} (${z.severity_level})`).join(", ")}`
      : "No marked high-risk zones on this dataset's route";

    const card = document.createElement("div");
    card.className = `route-compare-card${isRecommended ? " is-recommended" : ""}`;
    card.dataset.routeId = route.id;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.innerHTML = `
      <div class="route-compare-header">
        <span class="route-compare-name">${route.name}</span>
        ${isRecommended ? '<span class="recommended-badge">RECOMMENDED</span>' : ""}
      </div>
      <div class="route-compare-stats">
        <div>
          <span>Distance</span>
          <strong>${route.distanceKm} km</strong>
        </div>
        <div>
          <span>ETA</span>
          <strong>${route.etaMin} min</strong>
        </div>
        <div>
          <span>Risk</span>
          <strong>
            ${riskResult.score}/100
            <span class="route-compare-risk-badge risk-level ${levelClass(riskResult.level)}">${riskResult.level}</span>
          </strong>
        </div>
      </div>
      <p class="route-compare-note">${zoneNote}</p>
    `;

    card.addEventListener("click", () => selectRoute(route.id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectRoute(route.id);
      }
    });

    return card;
  }

  function renderRouteComparison(scoredRoutes, recommended) {
    const grid = document.getElementById("routeCompareGrid");
    const banner = document.getElementById("routeRecommendBanner");
    if (!grid || !banner) return;

    grid.innerHTML = "";
    routeCardsById = {};
    scoredRoutes
      .slice()
      .sort((a, b) => a.riskResult.score - b.riskResult.score)
      .forEach((route) => {
        const card = renderRouteCard(route, route.id === recommended.id);
        routeCardsById[route.id] = card;
        grid.appendChild(card);
      });

    const allHighRisk = scoredRoutes.every((r) => r.riskResult.score > 55);
    banner.classList.toggle("high-risk-all", allHighRisk);
    banner.innerHTML = `<span class="route-recommend-label">${buildRecommendationText(scoredRoutes, recommended)}</span>`;
  }

  function buildRouteZonePopup(zone) {
    const trend =
      typeof zone.trend_pct === "number"
        ? `${zone.trend_pct > 0 ? "+" : ""}${zone.trend_pct}% (30d)`
        : "n/a";
    return `<div class="risk-popup">
      <strong>${zone.name}</strong>
      <span>Risk score: ${Math.round((zone.avg_risk_score || 0) * 100)}/100 &middot; ${zone.severity_level}</span>
      <span>${zone.incidents} incidents recorded</span>
      <span>Casualties: ${zone.casualties_total ?? "n/a"}</span>
      <span>Trend: ${trend}</span>
      <span>Top cause: ${zone.top_cause || "n/a"}</span>
    </div>`;
  }

  /** Base (non-selected) style for a route's segments. */
  function baseStyleFor(routeId) {
    const isRecommended = recommendedRoute && routeId === recommendedRoute.id;
    return { weight: isRecommended ? 6 : 3, opacity: isRecommended ? 0.95 : 0.5 };
  }

  /**
   * Highlight one route on the map (used by route-card clicks). Clicking
   * the already-selected route deselects back to the default
   * recommended/alternative styling.
   */
  function selectRoute(routeId) {
    if (!currentMap) return;
    selectedRouteId = selectedRouteId === routeId ? null : routeId;

    Object.entries(routeLayersById).forEach(([id, layers]) => {
      const isSelected = id === selectedRouteId;
      const base = baseStyleFor(id);
      layers.forEach((line) => {
        line.setStyle({
          weight: isSelected ? 7 : base.weight,
          opacity: isSelected ? 1 : base.opacity,
        });
        if (isSelected) line.bringToFront();
      });
    });

    Object.entries(routeCardsById).forEach(([id, card]) => {
      card.classList.toggle("is-selected", id === selectedRouteId);
    });
  }

  /**
   * Draw every scored route as one Leaflet polyline PER SEGMENT (so each
   * leg can carry its own risk color) onto the map js/dashboard.js already
   * created. The recommended route starts out thicker/brighter; the
   * others start out thinner/muted so it stays obvious even with
   * risk-colored segments — selectRoute() can override this per click.
   */
  function drawRoutesOnMap(map, scoredRoutes, recommended) {
    routeLayersById = {};
    const allLatLngs = [];

    // Draw the recommended route LAST so it renders on top of the others
    // at the shared start/destination anchor points.
    const drawOrder = scoredRoutes
      .slice()
      .sort((a, b) => (a.id === recommended.id ? 1 : 0) - (b.id === recommended.id ? 1 : 0));

    drawOrder.forEach((route) => {
      const base = baseStyleFor(route.id);
      const layers = [];
      route.segments.forEach((seg) => {
        const line = MapEngine.drawRoute(map, [seg.from, seg.to], {
          color: MapEngine.severityColor(seg.level),
          weight: base.weight,
          dashed: route.id !== recommended.id,
        });
        line.setStyle({ opacity: base.opacity });
        line.on("click", () => selectRoute(route.id));
        layers.push(line);
        allLatLngs.push(seg.from, seg.to);
      });
      routeLayersById[route.id] = layers;
    });

    return allLatLngs;
  }

  /** Draw one marker per unique real zone touched by ANY route. */
  function drawRouteZones(map, scoredRoutes) {
    const uniqueZoneNames = new Set();
    const zonesOnMap = [];
    scoredRoutes.forEach((route) => {
      route.matchedZones.forEach((zone) => {
        if (!uniqueZoneNames.has(zone.name)) {
          uniqueZoneNames.add(zone.name);
          zonesOnMap.push(zone);
        }
      });
    });

    const { markersByName } = MapEngine.addRiskZones(map, zonesOnMap);
    Object.entries(markersByName).forEach(([name, marker]) => {
      const zone = zonesOnMap.find((z) => z.name === name);
      if (!zone) return;
      marker.unbindPopup();
      marker.bindPopup(buildRouteZonePopup(zone));
    });

    return { markersByName, zones: zonesOnMap };
  }

  /**
   * Mount the route comparison (map layer + cards + banner) onto an
   * EXISTING map that js/dashboard.js already created and centered.
   * Does NOT call MapEngine.initMap, and does NOT touch the vehicle or
   * destination markers — those stay owned by dashboard.js.
   */
  function mount(map, allZones) {
    currentMap = map;
    scoredRoutesCache = scoreRoutes(allZones);
    recommendedRoute = pickRecommendedRoute(scoredRoutesCache);
    selectedRouteId = null;

    renderRouteComparison(scoredRoutesCache, recommendedRoute);
    const routeLatLngs = drawRoutesOnMap(map, scoredRoutesCache, recommendedRoute);
    const { markersByName, zones } = drawRouteZones(map, scoredRoutesCache);

    return {
      scoredRoutes: scoredRoutesCache,
      recommended: recommendedRoute,
      routeLatLngs,
      zoneMarkersByName: markersByName,
      matchedZones: zones,
    };
  }

  return {
    ORIGIN,
    DESTINATION,
    scoreRoutes,
    pickRecommendedRoute,
    mount,
    selectRoute,
  };
})();
