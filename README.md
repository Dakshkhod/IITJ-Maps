# IITJ Maps 🗺️

Smart campus navigation for **IIT Jodhpur** — an interactive, mobile-first map
with real road-network routing, full-text search, live GPS tracking, optional 3D
landmarks, and dark mode. The app is fully client-side: all map data ships as
static files and all routing and search run in the browser.

## What it does

- Interactive vector map of the IITJ campus (buildings, roads, footpaths, green
  areas, and perimeter berms) built from OpenStreetMap data
- Full-text and fuzzy search across campus places, with category filters
- Walking directions with turn-by-turn steps, live GPS location and heading, and
  auto-reroute on deviation
- Lazy-loaded 3D landmark models, dark mode, and an installable (add-to-home-screen) PWA

## Under the hood

Vanilla JavaScript, HTML and CSS with no build step. Map rendering uses MapLibre
GL JS and 3D landmarks use Three.js (both self-hosted). The map data is
pre-generated static GeoJSON/JSON, so routing and search run entirely in the
browser. The site is hosted as a static deployment on Vercel, with a serverless
function and edge-middleware auth gate powering the admin overlay tool.

## Attribution

Map data © OpenStreetMap contributors (ODbL). Base map tiles © CARTO and Esri.

---

© IIT Jodhpur. This is a proprietary project for IIT Jodhpur campus navigation;
it is not open-source and no license to use, copy, or redistribute the source is
granted.
