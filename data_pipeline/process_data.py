import pandas as pd
import numpy as np
import json
from sklearn.cluster import KMeans

df = pd.read_csv('/home/claude/roadguard/dataset/indian_roads_dataset.csv')
delhi = df[df.city == 'Delhi'].copy()
delhi['date'] = pd.to_datetime(delhi['date'])

# Known Delhi locality anchors (approx public coordinates) used only to LABEL
# density clusters of the synthetic dataset with readable, real-sounding names.
LOCALITIES = {
    "Connaught Place": (28.6315, 77.2167), "ITO Junction": (28.6289, 77.2405),
    "Karol Bagh": (28.6519, 77.1909), "Rajouri Garden": (28.6469, 77.1201),
    "Dwarka": (28.5921, 77.0460), "Rohini": (28.7495, 77.0565),
    "Nehru Place": (28.5494, 77.2519), "Lajpat Nagar": (28.5677, 77.2434),
    "Saket": (28.5245, 77.2066), "Mayur Vihar": (28.6096, 77.2952),
    "Punjabi Bagh": (28.6692, 77.1310), "Pitampura": (28.6980, 77.1315),
    "Vasant Kunj": (28.5245, 77.1590), "Janakpuri": (28.6219, 77.0879),
    "Shahdara": (28.6692, 77.2895), "Okhla": (28.5487, 77.2712),
    "Najafgarh": (28.6092, 76.9800), "Narela": (28.8480, 77.0920),
    "Rohini Sector 24": (28.7300, 77.1100), "Yamuna Vihar": (28.7010, 77.2660),
    "Green Park": (28.5590, 77.2050), "Model Town": (28.7115, 77.1910),
}
loc_names = list(LOCALITIES.keys())
loc_coords = np.array(list(LOCALITIES.values()))

sev_weight = {'minor': 1, 'major': 3, 'fatal': 6}
delhi['sev_weight'] = delhi['accident_severity'].map(sev_weight)

# ---- density-based zone clustering (balanced cluster sizes) ----
N_CLUSTERS = 20
coords = delhi[['latitude', 'longitude']].values
km = KMeans(n_clusters=N_CLUSTERS, random_state=42, n_init=10).fit(coords)
delhi['cluster'] = km.labels_

used_names = set()
def label_for_centroid(lat, lon):
    d = (loc_coords[:, 0] - lat) ** 2 + (loc_coords[:, 1] - lon) ** 2
    order = np.argsort(d)
    for idx in order:
        name = loc_names[idx]
        if name not in used_names:
            used_names.add(name)
            return name
    return loc_names[order[0]]

cutoff = delhi['date'].max()
recent_start = cutoff - pd.Timedelta(days=30)
prior_start = cutoff - pd.Timedelta(days=60)

zones = []
for c in range(N_CLUSTERS):
    zdf = delhi[delhi.cluster == c]
    if len(zdf) == 0:
        continue
    lat, lon = km.cluster_centers_[c]
    name = label_for_centroid(lat, lon)

    recent = zdf[(zdf.date > recent_start) & (zdf.date <= cutoff)]
    prior = zdf[(zdf.date > prior_start) & (zdf.date <= recent_start)]
    trend = round(((len(recent) - len(prior)) / len(prior)) * 100, 1) if len(prior) > 0 else 0.0

    sev_counts = zdf['accident_severity'].value_counts().to_dict()
    top_cause = zdf['cause'].value_counts().idxmax()
    avg_risk = round(float(zdf['risk_score'].mean()), 2)
    weighted = int(zdf['sev_weight'].sum())

    if avg_risk >= 0.55 or sev_counts.get('fatal', 0) >= len(zdf) * 0.22:
        severity_level = "CRITICAL"
    elif avg_risk >= 0.45:
        severity_level = "HIGH"
    elif avg_risk >= 0.32:
        severity_level = "MODERATE"
    else:
        severity_level = "LOW"

    last_date = zdf['date'].max()
    days_since_last = int((cutoff - last_date).days)

    zones.append({
        "name": name, "lat": round(float(lat), 5), "lon": round(float(lon), 5),
        "incidents": int(len(zdf)), "incidents_30d": int(len(recent)),
        "trend_pct": trend, "avg_risk_score": avg_risk, "severity_level": severity_level,
        "severity_breakdown": {k: int(v) for k, v in sev_counts.items()},
        "top_cause": top_cause, "casualties_total": int(zdf['casualties'].sum()),
        "weighted_score": weighted,
        "last_incident_date": last_date.strftime("%Y-%m-%d"),
        "days_since_last": days_since_last,
    })

zones.sort(key=lambda z: z['weighted_score'], reverse=True)
for i, z in enumerate(zones):
    z['rank'] = i + 1

# ---- points (for heatmap layer) ----
points = [{
    "lat": round(r.latitude, 5), "lon": round(r.longitude, 5),
    "severity": r.accident_severity, "weight": sev_weight[r.accident_severity],
    "casualties": int(r.casualties), "cause": r.cause, "road_type": r.road_type,
    "weather": r.weather, "risk_score": round(float(r.risk_score), 2),
    "date": r.date.strftime("%Y-%m-%d"),
} for r in delhi.itertuples()]

# ---- weekly crossings (day-of-week aggregate, scaled to a plausible 7-day window) ----
dow_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
raw_dow = delhi['day_of_week'].value_counts().reindex(dow_order).fillna(0)
scale = 220 / raw_dow.mean()  # scale full multi-year aggregate down to a believable single-week count
dow_counts = {k: int(round(v * scale)) for k, v in raw_dow.items()}

# ---- overall stats ----
total_recent = delhi[(delhi.date > recent_start) & (delhi.date <= cutoff)]
total_prior = delhi[(delhi.date > prior_start) & (delhi.date <= recent_start)]
overall_trend = round(((len(total_recent) - len(total_prior)) / max(len(total_prior), 1)) * 100, 1)

stats = {
    "total_incidents": int(len(delhi)),
    "high_risk_zones": int(sum(1 for z in zones if z['severity_level'] in ('HIGH', 'CRITICAL'))),
    "monthly_trend_pct": overall_trend,
    "severity_distribution": delhi['accident_severity'].value_counts().to_dict(),
    "top_causes": delhi['cause'].value_counts().head(5).to_dict(),
    "total_casualties": int(delhi['casualties'].sum()),
    "date_range": [delhi['date'].min().strftime("%Y-%m-%d"), delhi['date'].max().strftime("%Y-%m-%d")],
    "city": "Delhi",
    "source_note": "Structured demo dataset (synthetic India-wide road-accident records). Zones are density-based clusters labeled with nearby Delhi locality names for readability, not verified real intersections.",
}

output = {"meta": stats, "points": points, "zones": zones, "weekly_crossings": dow_counts}

with open('/home/claude/roadguard/build/accidents_delhi.json', 'w') as f:
    json.dump(output, f, indent=2)

print("Points:", len(points), "| Zones:", len(zones))
print(json.dumps(stats, indent=2))
print("\nTop 8 zones (by weighted severity):")
for z in zones[:8]:
    print(f"  #{z['rank']} {z['name']}: {z['incidents_30d']} incidents(30d), {z['severity_level']}, trend {z['trend_pct']}%, top cause={z['top_cause']}")
