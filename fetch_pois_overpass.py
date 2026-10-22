#!/usr/bin/env python3
"""
Phase 1 & Phase 2 Helper: Overpass API POI Extractor & Cleaner for Italy (Milan, Rome)
and Spain (Madrid, Barcelona).

Queries OpenStreetMap Overpass API for target tags:
- shop=supermarket, shop=bakery, shop=clothes
- amenity=pharmacy, amenity=fuel, amenity=restaurant, amenity=cafe
Cleans and normalizes brand/commercial names and maps them to MySpendLens standard categories.
"""

import json
import re
import urllib.parse
import urllib.request
from collections import Counter
import csv

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Bounding boxes: (south, west, north, east)
BOUNDING_BOXES = {
    "IT": {
        "Milan": (45.40, 9.10, 45.53, 9.28),
        "Rome": (41.80, 12.40, 41.97, 12.60),
    },
    "ES": {
        "Madrid": (40.36, -3.76, 40.49, -3.62),
        "Barcelona": (41.34, 2.10, 41.45, 2.23),
    },
}

TAG_TO_CATEGORY = {
    ("shop", "supermarket"): "Groceries",
    ("shop", "bakery"): "Groceries",
    ("amenity", "pharmacy"): "Healthcare",
    ("amenity", "fuel"): "Transport & Auto",
    ("amenity", "restaurant"): "Dining Out",
    ("amenity", "cafe"): "Dining Out",
    ("shop", "clothes"): "Shopping",
}


def build_overpass_query(bbox: tuple[float, float, float, float]) -> str:
    s, w, n, e = bbox
    bbox_str = f"({s},{w},{n},{e})"
    return f"""
    [out:json][timeout:60];
    (
      node["shop"="supermarket"]{bbox_str};
      way["shop"="supermarket"]{bbox_str};
      node["shop"="bakery"]{bbox_str};
      node["amenity"="pharmacy"]{bbox_str};
      node["amenity"="fuel"]{bbox_str};
      node["amenity"="restaurant"]{bbox_str};
      node["amenity"="cafe"]{bbox_str};
      node["shop"="clothes"]{bbox_str};
    );
    out tags;
    """


def clean_poi_name(raw_name: str) -> str:
    """Keep only uppercase alphanumeric characters and spaces."""
    upper = raw_name.upper()
    cleaned = re.sub(r"[^A-Z0-9\s]", " ", upper)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def fetch_city_pois(country: str, city: str, bbox: tuple[float, float, float, float]) -> list[tuple[str, str]]:
    query = build_overpass_query(bbox)
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(
        OVERPASS_URL,
        data=data,
        headers={
            "User-Agent": "MySpendLens-DataPipeline/1.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=65) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    results = []
    for el in payload.get("elements", []):
        tags = el.get("tags", {})
        raw_name = tags.get("brand") or tags.get("operator") or tags.get("name")
        if not raw_name:
            continue
        clean_name = clean_poi_name(raw_name)
        if len(clean_name) < 2:
            continue

        for (tag_k, tag_v), category in TAG_TO_CATEGORY.items():
            if tags.get(tag_k) == tag_v:
                results.append((clean_name, category))
                break
    return results


if __name__ == "__main__":
    print("Overpass QL Query Generator & POI Cleaner initialized.")
    for country, cities in BOUNDING_BOXES.items():
        for city, bbox in cities.items():
            print(f"--- Overpass QL for {city} ({country}) ---")
            print(build_overpass_query(bbox).strip())
