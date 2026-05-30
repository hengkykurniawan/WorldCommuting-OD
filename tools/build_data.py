"""Build web-friendly JSON data for the WorldCommuting-OD dashboard.

Scans CityAndRegionSplit/ (region polygons, per-city UTM CRS) and
CommutingODFlows/ (N x N OD matrices in .npy) and produces:

  docs/data/cities.json        -- one summary record per city (overview map)
  docs/data/cities/<idx>.json  -- per-city detail: region centroids + outlines
                                  + top-K strongest OD flows (thresholded)

Run from the repo root:  python tools/build_data.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

import numpy as np
import geopandas as gpd
import pycountry
from pycountry_convert import (
    country_alpha2_to_continent_code,
    convert_continent_code_to_continent_name,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGION_DIR = os.path.join(ROOT, "CityAndRegionSplit")
OD_DIR = os.path.join(ROOT, "CommutingODFlows")
OUT_DIR = os.path.join(ROOT, "docs", "data")
CITY_OUT_DIR = os.path.join(OUT_DIR, "cities")

# How many of the strongest OD flows to keep per city for the arc map.
TOP_K_FLOWS = 400
# Polygon simplification tolerance in degrees (~0.0004 deg ~ 40 m) and
# coordinate rounding (decimal places) to keep per-city files small.
SIMPLIFY_DEG = 0.0004
COORD_DP = 5

# Continents pycountry_convert can't resolve.
CONTINENT_OVERRIDE = {"TL": "Asia"}

_continent_cache: dict[str, str | None] = {}


def country_info(folder: str):
    """Return (iso2_or_iso3, country_name, continent, group) for a folder name."""
    if folder.startswith("GHSL-"):
        m = re.match(r"^GHSL-(\d+)_([A-Z]{3})_(.+)$", folder)
        if not m:
            return None
        cid, code, name = m.groups()
        group = "ghsl"
        co = pycountry.countries.get(alpha_3=code)
        a2 = co.alpha_2 if co else None
    else:
        m = re.match(r"^(\d+)_([A-Z]{2})_(.+)$", folder)
        if not m:
            return None
        cid, code, name = m.groups()
        group = "global"
        co = pycountry.countries.get(alpha_2=code)
        a2 = code

    country_name = co.name if co else code
    continent = None
    if a2:
        if a2 in _continent_cache:
            continent = _continent_cache[a2]
        else:
            try:
                continent = convert_continent_code_to_continent_name(
                    country_alpha2_to_continent_code(a2)
                )
            except Exception:
                continent = CONTINENT_OVERRIDE.get(a2)
            _continent_cache[a2] = continent
    continent = continent or CONTINENT_OVERRIDE.get(a2 or "", "Other")

    return {
        "id": int(cid),
        "code": code,
        "name": name.replace("_", " "),
        "country": country_name,
        "continent": continent,
        "group": group,
    }


def ring_coords(geom, dp=COORD_DP):
    """Return a list of [lon, lat] rings for a (multi)polygon, rounded."""
    rings = []
    if geom is None or geom.is_empty:
        return rings
    geoms = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    for g in geoms:
        if g.is_empty:
            continue
        ext = [[round(x, dp), round(y, dp)] for x, y in g.exterior.coords]
        if len(ext) >= 4:
            rings.append(ext)
    return rings


def process_city(folder: str, idx: int):
    info = country_info(folder)
    if info is None:
        return None

    shp = os.path.join(REGION_DIR, folder, "regions.shp")
    if not os.path.exists(shp):
        return None

    try:
        gdf = gpd.read_file(shp).to_crs(4326)
    except Exception as e:
        print(f"  ! shp read failed {folder}: {e}", file=sys.stderr)
        return None

    n_regions = len(gdf)
    cents = gdf.geometry.centroid
    lons = cents.x.to_numpy()
    lats = cents.y.to_numpy()
    city_lat = float(np.nanmean(lats))
    city_lon = float(np.nanmean(lons))

    # Region centroids (rounded) for the detail arc map.
    region_pts = [[round(float(lats[i]), COORD_DP), round(float(lons[i]), COORD_DP)]
                  for i in range(n_regions)]

    # Simplified region outlines for context.
    simp = gdf.geometry.simplify(SIMPLIFY_DEG, preserve_topology=True)
    polys = [ring_coords(g) for g in simp]

    # OD flows.
    flows_summary = {"total": 0, "intra": 0, "inter": 0, "maxf": 0, "has_od": False}
    top_flows = []
    od_path = os.path.join(OD_DIR, folder, "generation.npy")
    if os.path.exists(od_path):
        try:
            M = np.load(od_path).astype(np.float64)
            if M.shape[0] == M.shape[1]:
                total = float(M.sum())
                intra = float(np.trace(M))
                flows_summary = {
                    "total": round(total),
                    "intra": round(intra),
                    "inter": round(total - intra),
                    "maxf": round(float(M.max())),
                    "has_od": True,
                }
                # Top-K off-diagonal flows by value.
                m = M.copy()
                np.fill_diagonal(m, 0)
                k = min(TOP_K_FLOWS, m.size)
                if k > 0 and m.max() > 0:
                    flat = m.ravel()
                    idxs = np.argpartition(flat, -k)[-k:]
                    cols = m.shape[1]
                    for fi in idxs:
                        v = flat[fi]
                        if v <= 0:
                            continue
                        o, d = divmod(int(fi), cols)
                        top_flows.append([o, d, round(float(v), 1)])
                    top_flows.sort(key=lambda t: -t[2])
        except Exception as e:
            print(f"  ! npy failed {folder}: {e}", file=sys.stderr)

    # Per-city detail file.
    detail = {
        "name": info["name"],
        "country": info["country"],
        "regions": region_pts,
        "polys": polys,
        "flows": top_flows,
    }
    with open(os.path.join(CITY_OUT_DIR, f"{idx}.json"), "w", encoding="utf-8") as f:
        json.dump(detail, f, separators=(",", ":"))

    summary = {
        "idx": idx,
        "id": info["id"],
        "name": info["name"],
        "code": info["code"],
        "country": info["country"],
        "continent": info["continent"],
        "group": info["group"],
        "lat": round(city_lat, 5),
        "lon": round(city_lon, 5),
        "n": n_regions,
        **flows_summary,
    }
    return summary


def main():
    os.makedirs(CITY_OUT_DIR, exist_ok=True)
    folders = sorted(
        d for d in os.listdir(REGION_DIR)
        if os.path.isdir(os.path.join(REGION_DIR, d))
    )
    print(f"Found {len(folders)} city folders.")

    summaries = []
    t0 = time.time()
    for i, folder in enumerate(folders):
        rec = process_city(folder, len(summaries))
        if rec is not None:
            summaries.append(rec)
        if (i + 1) % 100 == 0:
            dt = time.time() - t0
            print(f"  {i+1}/{len(folders)}  ({dt:.0f}s, {len(summaries)} ok)")

    with open(os.path.join(OUT_DIR, "cities.json"), "w", encoding="utf-8") as f:
        json.dump(summaries, f, separators=(",", ":"))

    # Small meta file for the frontend.
    meta = {
        "n_cities": len(summaries),
        "n_with_od": sum(1 for s in summaries if s.get("has_od")),
        "countries": sorted({s["country"] for s in summaries}),
        "continents": sorted({s["continent"] for s in summaries}),
        "groups": sorted({s["group"] for s in summaries}),
        "total_flow": sum(s.get("total", 0) for s in summaries),
    }
    with open(os.path.join(OUT_DIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, separators=(",", ":"))

    print(f"Done: {len(summaries)} cities in {time.time()-t0:.0f}s")
    print(f"  -> docs/data/cities.json")
    print(f"  -> docs/data/cities/<idx>.json")


if __name__ == "__main__":
    main()
