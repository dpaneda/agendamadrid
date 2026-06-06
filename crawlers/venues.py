"""Venue canonicalization.

Cluster location records that refer to the same building and assign them a
single canonical id. Different sources (and datos.madrid itself) name the same
place differently ("Conde Duque" vs "Centro de Cultura Contemporánea Conde
Duque"), use different rooms ("Teatro Lara - Sala X") or geocode it a few metres
apart. We merge by normalized building name or nearby coordinates, with manual
overrides for the cases the heuristic gets wrong.
"""

import hashlib
import html
import re
import unicodedata
from math import asin, cos, radians, sin, sqrt

LOC_FIELDS = ("location_name", "address", "district", "latitude", "longitude")

# Venues within this distance, with a related name, are treated as one building.
MERGE_RADIUS_M = 60

# Building keys (output of venue_key) that are NOT real venues. Events keep the
# name inline as free text but it never becomes a filterable location.
EXCLUDE_KEYS = {"varios espacios"}

# Force raw names apart even if the heuristic would merge them: map a raw
# location_name to a group label; names with different labels are never merged.
SPLIT_OVERRIDES = {}


def _strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def venue_key(name):
    """Building-level normalized key: drops '(distrito)' and '- Sala ...' suffix."""
    n = _strip_accents(html.unescape(name or "").lower())
    n = re.sub(r"\(.*?\)", " ", n)               # (distrito)
    n = re.sub(r"\s*[-–]\s*sala\b.*$", " ", n)    # "- Sala ..."
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def building_display(name):
    """Human display name at building level (strip '- Sala ...')."""
    return re.sub(r"\s*[-–]\s*[Ss]ala\b.*$", "", (name or "").strip()).strip()


def _haversine_m(a, b):
    try:
        la1, lo1, la2, lo2 = float(a[0]), float(a[1]), float(b[0]), float(b[1])
    except (TypeError, ValueError):
        return float("inf")
    p1, p2 = radians(la1), radians(la2)
    dp, dl = radians(la2 - la1), radians(lo2 - lo1)
    x = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * 6371000 * asin(sqrt(x))


def canonicalize(venues):
    """Cluster venues that are the same building.

    `venues` maps a raw location_name -> {"rec": {LOC_FIELDS...}, "count": int}.
    Returns (name_to_lid, locations). name_to_lid[name] is None for excluded
    (non-venue) names that should stay inline on the event.
    """
    names = list(venues)
    parent = {n: n for n in names}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def blocked(a, b):
        la, lb = SPLIT_OVERRIDES.get(a), SPLIT_OVERRIDES.get(b)
        return la is not None and lb is not None and la != lb

    def union(a, b):
        if blocked(a, b):
            return
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    keys = {n: venue_key(n) for n in names}
    coords = {n: (venues[n]["rec"].get("latitude"), venues[n]["rec"].get("longitude")) for n in names}

    # 1) Same building key -> merge.
    by_key = {}
    for n in names:
        by_key.setdefault(keys[n], []).append(n)
    for group in by_key.values():
        for other in group[1:]:
            union(group[0], other)

    # 2) Nearby coordinates + a related name -> merge (same building, different label).
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            ka, kb = keys[a], keys[b]
            if not ka or not kb or find(a) == find(b):
                continue
            if _haversine_m(coords[a], coords[b]) <= MERGE_RADIUS_M and (
                ka in kb or kb in ka or (set(ka.split()) & set(kb.split()))
            ):
                union(a, b)

    clusters = {}
    for n in names:
        clusters.setdefault(find(n), []).append(n)

    name_to_lid, locations = {}, {}
    for members in clusters.values():
        # Canonical = the variant with the most events that has coordinates.
        with_coords = [m for m in members if venues[m]["rec"].get("latitude")]
        canon = max(with_coords or members, key=lambda m: venues[m]["count"])
        if venue_key(canon) in EXCLUDE_KEYS:
            for m in members:
                name_to_lid[m] = None
            continue
        display = building_display(canon)
        rec = dict(venues[canon]["rec"])
        rec["location_name"] = display
        lid = hashlib.sha256(venue_key(display).encode()).hexdigest()[:8]
        locations[lid] = {k: rec[k] for k in LOC_FIELDS if rec.get(k) is not None}
        for m in members:
            name_to_lid[m] = lid

    return name_to_lid, locations
