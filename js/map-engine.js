/**
 * RoadGuard — Map Engine
 * -----------------------------------------------------------------------
 * Small, reusable Leaflet helpers built around the SAME Leaflet setup and
 * dark CARTO basemap already used by js/heatmap.js on the Trips page. This
 * module does not replace js/heatmap.js and does not introduce a second
 * mapping library — it just gives other pages (starting with the
 * Dashboard) composable functions instead of copy-pasting map boilerplate.
 *
 * Every page that includes this file must also include the Leaflet
 * <script>/<link> tags (see trips.html / index.html <head>) before it.
 *
 * Provided functions:
 *   initMap(containerId, opts)          — create a map with the dark basemap
 *   addAccidentPoints(map, points)      — plot raw accident points as dots
 *   addRiskZones(map, zones, opts)      — plot zone markers w/ popups
 *   highlightZone(marker, zone)         — make one zone marker prominent
 *   unhighlightZone(marker, zone)       — return it to its normal style
 *   setVehicleMarker(map, latlng, opts) — create/move the vehicle marker
 *   setDestinationMarker(map, latlng)   — create/move the destination marker
 *   drawRoute(map, latlngs, opts)       — draw/redraw a route polyline
 *   clearLayer(map, layer)              — remove any layer safely
 *   fitToBounds(map, latlngsArray)      — fit the view to a set of points
 * -----------------------------------------------------------------------
 */
const MapEngine = (() => {

  const SEVERITY_COLOR = {
    CRITICAL: "#ff5d6c",
    HIGH: "#ff8d68",
    MODERATE: "#f5bd55",
    LOW: "#35d89a",
  };

  function severityColor(level) {
    return SEVERITY_COLOR[(level || "").toUpperCase()] || SEVERITY_COLOR.MODERATE;
  }

  function zoneRadius(zone) {
    return 8 + Math.min((zone.incidents || 0) / 20, 10);
  }

  /** Create a Leaflet map on `containerId` using RoadGuard's dark basemap. */
  function initMap(containerId, { center = [28.6139, 77.209], zoom = 11, zoomControl = true } = {}) {
    if (typeof L === "undefined") {
      console.error("MapEngine: Leaflet is not loaded on this page");
      return null;
    }
    const el = document.getElementById(containerId);
    if (!el) {
      console.error(`MapEngine: no element with id "${containerId}"`);
      return null;
    }

    const map = L.map(el, { zoomControl, attributionControl: true }).setView(center, zoom);

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 18,
        subdomains: "abcd",
      }
    ).addTo(map);

    return map;
  }

  /** Plot raw accident points as small dots, colored by severity. */
  function addAccidentPoints(map, points = [], { radius = 3, fillOpacity = 0.5 } = {}) {
    if (!map) return null;
    const layer = L.layerGroup();
    points.forEach((p) => {
      L.circleMarker([p.lat, p.lon], {
        radius,
        weight: 0,
        fillColor: severityColor(p.severity),
        fillOpacity,
      }).addTo(layer);
    });
    layer.addTo(map);
    return layer;
  }

  function buildZonePopup(zone) {
    return `<div class="risk-popup">
      <strong>${zone.name}</strong>
      <span>${zone.severity_level} &middot; ${zone.incidents} incidents recorded</span>
      <span>Top cause: ${zone.top_cause}</span>
    </div>`;
  }

  /**
   * Plot risk zones as circle markers, colored + sized by severity.
   * Returns { layer, markersByName } so callers (e.g. Dashboard) can look
   * up and highlight a specific zone marker later.
   */
  function addRiskZones(map, zones = [], { onClick } = {}) {
    if (!map) return { layer: null, markersByName: {} };
    const layer = L.layerGroup();
    const markersByName = {};

    zones.forEach((zone) => {
      const marker = L.circleMarker([zone.lat, zone.lon], {
        radius: zoneRadius(zone),
        color: "#ffffff55",
        weight: 1,
        fillColor: severityColor(zone.severity_level),
        fillOpacity: 0.55,
      });

      marker.bindPopup(buildZonePopup(zone));
      if (onClick) marker.on("click", () => onClick(zone, marker));

      marker.addTo(layer);
      markersByName[zone.name] = marker;
    });

    layer.addTo(map);
    return { layer, markersByName };
  }

  /** Make one zone marker visually prominent (e.g. "high-risk zone ahead"). */
  function highlightZone(marker, zone) {
    if (!marker || !zone) return;
    marker.setStyle({ radius: zoneRadius(zone) + 6, weight: 3, color: "#ffffff" });
    marker.openPopup();
  }

  /** Return a previously-highlighted zone marker to its normal style. */
  function unhighlightZone(marker, zone) {
    if (!marker || !zone) return;
    marker.setStyle({ radius: zoneRadius(zone), weight: 1, color: "#ffffff55" });
    marker.closePopup();
  }

  /**
   * Create the vehicle marker, or move an existing one. Pass the marker
   * returned from a previous call back in via `existing` to move it
   * instead of creating a duplicate.
   */
  function setVehicleMarker(map, latlng, { existing = null, label = "Vehicle (simulated)" } = {}) {
    if (!map) return existing;
    if (existing) {
      existing.setLatLng(latlng);
      return existing;
    }
    const icon = L.divIcon({
      className: "rg-vehicle-marker",
      html: '<span class="rg-vehicle-dot"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    const marker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(map);
    marker.bindPopup(`<div class="risk-popup"><strong>${label}</strong></div>`);
    return marker;
  }

  /** Create the destination marker, or move an existing one. */
  function setDestinationMarker(map, latlng, { existing = null, label = "Destination" } = {}) {
    if (!map) return existing;
    if (existing) {
      existing.setLatLng(latlng);
      return existing;
    }
    const icon = L.divIcon({
      className: "rg-destination-marker",
      html: '<span class="rg-destination-dot"></span>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const marker = L.marker(latlng, { icon }).addTo(map);
    marker.bindPopup(`<div class="risk-popup"><strong>${label}</strong></div>`);
    return marker;
  }

  /**
   * Draw a route polyline. If `existingLayer` is passed, it is removed
   * first so callers can simply call drawRoute() again to redraw.
   */
  function drawRoute(map, latlngs = [], { existingLayer = null, color = "#35d89a", weight = 4, dashed = false } = {}) {
    if (!map) return existingLayer;
    if (existingLayer) map.removeLayer(existingLayer);
    return L.polyline(latlngs, {
      color,
      weight,
      opacity: 0.85,
      dashArray: dashed ? "6 8" : null,
    }).addTo(map);
  }

  /** Remove a layer from the map if it exists, without throwing. */
  function clearLayer(map, layer) {
    if (map && layer && map.hasLayer(layer)) map.removeLayer(layer);
  }

  /** Fit the map view to a set of [lat, lon] pairs. */
  function fitToBounds(map, latlngsArray = [], opts = {}) {
    if (!map || !latlngsArray.length) return;
    const bounds = L.latLngBounds(latlngsArray);
    map.fitBounds(bounds, { padding: [30, 30], ...opts });
  }

  return {
    severityColor,
    initMap,
    addAccidentPoints,
    addRiskZones,
    highlightZone,
    unhighlightZone,
    setVehicleMarker,
    setDestinationMarker,
    drawRoute,
    clearLayer,
    fitToBounds,
    buildZonePopup,
  };
})();
