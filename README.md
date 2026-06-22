# IITJ Maps 🗺️

Smart campus navigation for **IIT Jodhpur** — an interactive, mobile-first map with
real road-network routing, full-text search, live GPS tracking, optional 3D landmarks,
and dark mode. The app is fully client-side: all map data ships as static files and
all routing and search run in the browser.

## Features

- **Interactive vector map** of the IITJ campus (MapLibre GL)
- **Buildings, roads, footpaths, green areas, and perimeter berms** rendered from OpenStreetMap data
- **Full-text + fuzzy search** across campus places, with category filter chips
- **Walking directions** via Dijkstra routing on the campus road graph, with turn-by-turn steps
- **Live GPS** location, heading, and auto-reroute on deviation
- **3D landmark models** (lazy-loaded, so 2D-only sessions stay light)
- **Installable PWA** with offline caching via a service worker
- **Dark mode** and responsive, touch-friendly UI

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Map rendering | MapLibre GL JS |
| 3D landmarks | Three.js (lazy-loaded) |
| App code | Vanilla JavaScript, HTML, CSS (no framework, no build step) |
| Map data | Static GeoJSON / JSON (OpenStreetMap + curated) |
| Routing & search | Client-side, in-browser |
| Hosting | Static site on Vercel |
| Admin publishing | Vercel serverless function + edge middleware |
| Data pipeline | Node.js scripts (OSM/KML → GeoJSON + road graph) |

## Getting Started

Requires Node.js 18+.

```bash
npm install
npm start        # serves the web/ app at http://localhost:3000
```

### Regenerating map data

Map data is pre-generated and committed under `web/data/`. To rebuild it from the
OpenStreetMap source after editing `map.osm`:

```bash
cd backend
npm install
npm run parse-data
```

## Project Structure

```
web/            Static single-page app (HTML, CSS, JS) and map data
  data/         GeoJSON / JSON consumed directly by the browser
  js/           Map UI, search, routing, 3D landmarks, admin
api/            Serverless admin publishing endpoint (Vercel)
middleware.js   Edge auth gate for the admin page
backend/        OSM/KML → GeoJSON data pipeline (build-time only)
```

## License

Map data derived from © OpenStreetMap contributors (ODbL).
