# IITJ Maps 🗺️

**Smart campus navigation for IIT Jodhpur** — interactive map, real road-network routing, full-text search, GPS tracking, and dark mode.

---

## Features

| Feature | Status |
|---------|--------|
| Interactive MapLibre GL map | ✅ |
| 94 campus buildings with category colors | ✅ |
| 271 roads & footpaths from OSM | ✅ |
| 154 searchable places (OSM + KML + curated) | ✅ |
| Dijkstra road-network routing (2084 node graph) | ✅ |
| Turn-by-turn walking directions | ✅ |
| GPS location + live position tracking | ✅ |
| Auto-reroute on deviation (>40m) | ✅ |
| Fuzzy + keyword search | ✅ |
| Category filter chips | ✅ |
| Layer toggle (buildings / roads / markers) | ✅ |
| Dark mode | ✅ |
| Proposed buildings (from Phase 3B KML) | ✅ |
| Responsive mobile-first UI | ✅ |

---

## Quick Start

### Prerequisites
- Node.js 18+

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Run the data pipeline (only needed once, or when map data changes)
```bash
npm run parse-data
```
This parses `map.osm` + `Copy of Phase 3B.kml` → generates GeoJSON + road graph in `backend/data/`.

### 3. Start the server
```bash
npm start
```

Open **http://localhost:3000** in your browser.

---

## Project Structure

```
iitj-maps/
├── backend/
│   ├── src/
│   │   └── index.js          # Express API + Dijkstra routing engine
│   ├── scripts/
│   │   └── parse-osm-data.js # GIS data pipeline (OSM + KML → GeoJSON)
│   ├── data/                 # Generated data files
│   │   ├── buildings.geojson   (94 building polygons)
│   │   ├── roads.geojson       (271 road/path linestrings)
│   │   ├── places.geojson      (154 named places)
│   │   ├── search-index.json   (search tokens)
│   │   ├── road-graph.json     (2084-node Dijkstra graph)
│   │   └── categories.json
│   ├── Dockerfile
│   └── package.json
├── web/
│   ├── index.html            # Single-page app
│   ├── css/app.css           # Responsive styles + dark mode
│   └── js/app.js             # MapLibre + routing + search UI
├── map.osm                   # OSM campus data (1MB, 4389 nodes, 488 ways)
├── Copy of Phase 3B.kml      # Proposed/future buildings KML
├── docker-compose.yml
└── implementation_plan.md
```

---

## API Reference

Base URL: `http://localhost:3000/api/v1`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health + stats |
| GET | `/categories` | All place categories |
| GET | `/places` | All places (filter: `?category=academic`) |
| GET | `/places/:id` | Single place by OSM ID or name |
| GET | `/search?q=&limit=` | Fuzzy full-text search |
| GET | `/nearby?lat=&lng=&radius=&limit=` | Places within radius (metres) |
| GET | `/map/buildings` | Building polygons GeoJSON |
| GET | `/map/roads` | Roads/paths GeoJSON |
| GET | `/route?from=lat,lng&to=lat,lng` | Walking route (Dijkstra on road network) |

### Route Response
```json
{
  "distance": 1374,
  "duration": 981,
  "eta_minutes": 16,
  "geometry": { "type": "LineString", "coordinates": [...] },
  "instructions": [
    { "type": "depart", "text": "Head north", "distance": 0 },
    { "type": "turn",   "text": "Turn right", "distance": 56 },
    { "type": "arrive", "text": "Arrive at destination (1374m · 16 min walk)", "distance": 1374 }
  ],
  "profile": "walking",
  "using_road_network": true
}
```

---

## Data Sources

| Source | Contents |
|--------|----------|
| `map.osm` | OSM XML export — 4389 nodes, 488 ways, 94 buildings, 273 highways |
| `Copy of Phase 3B.kml` | 19 KML placemarks — proposed dining halls, hostels, admin wing, etc. |
| Curated data | 30 hand-verified campus places with precise coordinates + search keywords |

---

## Docker

```bash
# Build & run
docker compose up --build

# Or just run (uses pre-built image)
docker compose up
```

---

## Roadmap

### Done (Phase 1–3)
- [x] GIS data pipeline (OSM DOM parser + KML)
- [x] 94 buildings, 271 roads from real OSM data
- [x] Dijkstra routing on 2084-node road graph
- [x] Turn-by-turn navigation with auto-reroute
- [x] Web app with MapLibre GL

### Next (Phase 4)
- [ ] Offline MBTiles bundle (tilemaker)
- [ ] Service worker for offline-first support
- [ ] React admin dashboard for place editing
- [ ] Flutter mobile app (Android + iOS)
- [ ] Indoor floor plans for key buildings
