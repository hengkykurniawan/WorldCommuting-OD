# World Commuting OD Flows — Interactive Dashboard

A static, GitHub Pages–hostable dashboard for exploring the global commuting
origin–destination (OD) flow dataset (2,368 cities across 163 countries).

- **World overview map** — every city as a bubble, sized & coloured by a chosen
  metric (total flow, inter-/intra-region flow, region count). Filter by
  continent, country and dataset; search by name.
- **City drill-down** — click *Explore OD flows* on any city to load its region
  boundaries and the strongest origin→destination commuting arcs, with summary
  statistics.

Built with plain HTML/CSS/JS + [Leaflet](https://leafletjs.com/) (CDN, no build
step). Basemap tiles by CARTO/OpenStreetMap.

## Live site

Once GitHub Pages is enabled (see below) the dashboard is served from this
`docs/` folder.

## Data

The frontend reads pre-generated JSON in [`data/`](data/):

| File | Contents |
|------|----------|
| `data/cities.json` | One summary record per city: name, country, continent, dataset group, centroid lat/lon, region count and OD flow totals. |
| `data/meta.json` | Aggregate counts used to populate filters. |
| `data/cities/<idx>.json` | Per-city detail: region centroids, simplified region outlines, and the top-K strongest OD flows. |

These are produced from the raw shapefiles + `.npy` OD matrices by
[`../tools/build_data.py`](../tools/build_data.py). To regenerate:

```bash
pip install -r tools/requirements.txt
python tools/build_data.py
```

Tunable constants live at the top of the build script (`TOP_K_FLOWS`,
`SIMPLIFY_DEG`, `COORD_DP`).

## Enabling GitHub Pages

In the repository: **Settings → Pages → Build and deployment**

- **Source:** *Deploy from a branch*
- **Branch:** `main` · **Folder:** `/docs`

Save, then the site publishes at
`https://<user>.github.io/<repo>/`. Only the `docs/` folder is served — the
multi-GB raw `CityAndRegionSplit/` and `CommutingODFlows/` data is **not**
published.

## Local preview

```bash
cd docs
python -m http.server 8000
# open http://localhost:8000
```
