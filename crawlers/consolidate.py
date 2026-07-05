"""Consolidate source JSONs + enrich into events.json + calendar.json + locations.json.

Reads all files in data/sources/*.json and data/enrich/*.json, merges them
into the final output. This step is fast and doesn't hit any external APIs.

Usage:
  python -m crawlers.consolidate
"""

import html
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta, UTC
from glob import glob

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.base import make_event_id
from crawlers.categories import normalize, CATEGORIES
from crawlers.generate_seo import run as generate_seo
from crawlers.venues import canonicalize as canonicalize_venues

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "data")
SOURCES_DIR = os.path.join(os.path.dirname(__file__), "data", "sources")
ENRICH_DIR = os.path.join(os.path.dirname(__file__), "data", "enrich")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
CALENDAR_PATH = os.path.join(DATA_DIR, "calendar.json")
LOCATIONS_PATH = os.path.join(DATA_DIR, "locations.json")

LOC_FIELDS = ("location_name", "address", "district", "latitude", "longitude")

RICHNESS_FIELDS = ["description", "start_time", "end_time", "location_name", "address",
                   "latitude", "longitude", "url", "district", "image"]


# Retention window: keep 7 days of past events (so recently-expired favourites
# and marks stay visible on the site) plus 30 days ahead.
PAST_DAYS = 7
FUTURE_DAYS = 30


def calendar_window(now=None):
    """Return (min_date, max_date) date strings bounding the calendar window."""
    now = now or datetime.now(UTC)
    min_date = (now - timedelta(days=PAST_DAYS)).strftime("%Y-%m-%d")
    max_date = (now + timedelta(days=FUTURE_DAYS)).strftime("%Y-%m-%d")
    return min_date, max_date


def richness(ev):
    return sum(1 for f in RICHNESS_FIELDS if ev.get(f))


def merge_event(existing, new):
    if richness(new) > richness(existing):
        base = {**new}
    else:
        base = {**existing}

    cats = list(dict.fromkeys(existing.get("categories", []) + new.get("categories", [])))
    base["categories"] = cats

    old_sched = existing.get("schedule") or {}
    new_sched = new.get("schedule") or {}
    old_score = sum(len(v) for v in old_sched.values()) if isinstance(old_sched, dict) else 0
    new_score = sum(len(v) for v in new_sched.values()) if isinstance(new_sched, dict) else 0
    if new_score >= old_score and new_sched:
        base["schedule"] = new_sched
    elif old_sched:
        base["schedule"] = old_sched

    sources = set()
    for ev in [existing, new]:
        s = ev.get("source", "")
        if "," in s:
            sources.update(s.split(","))
        else:
            sources.add(s)
    base["source"] = ",".join(sorted(sources))

    return base


# Words too generic to be a matching signal (Spanish stopwords + event-type and
# venue-type words). Removed before comparing titles.
_STOPWORDS = set(
    "de la el los las en y a un una del con por para al sala teatro centro cultural "
    "concierto conciertos taller talleres exposicion exposiciones museo biblioteca "
    "espacio madrid ciclo".split())


def _content_tokens(title, venue_name=""):
    """Significant words of a title (accents/punctuation stripped, stopwords and
    venue-name words removed) for fuzzy title matching. Short all-digit tokens
    (ages, levels) are kept so they can act as discriminators."""
    def fold(s):
        return "".join(c for c in unicodedata.normalize("NFD", html.unescape(s or "").lower())
                       if unicodedata.category(c) != "Mn")
    venue_tokens = set(fold(venue_name).split())
    words = re.sub(r"[^a-z0-9 ]", " ", fold(title)).split()
    return {w for w in words
            if (len(w) > 2 or w.isdigit()) and w not in _STOPWORDS and w not in venue_tokens}


def _title_similarity(a, b):
    """Jaccard overlap of two content-token sets (0..1)."""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


# Words/patterns that, if they are what DIFFERS between two titles, mean the
# events are distinct variants (different level/session/age/edition/status),
# not duplicates — so they must not be merged.
_DISCRIMINATORS = {
    "avanzado", "avanzada", "intermedio", "intermedia", "iniciacion", "inicial",
    "basico", "basica", "principiantes", "nivel", "manana", "tarde", "mediodia",
    "matinal", "infantil", "adultos", "suspendido", "suspendida", "cancelado",
    "cancelada", "aplazado", "aplazada",
}


def _has_discriminator(diff_tokens):
    """True if the differing tokens include a level/session/age/status marker."""
    return any(t in _DISCRIMINATORS or (t.isdigit() and len(t) <= 2) for t in diff_tokens)


def dedup_cross_source(events, calendar, locations=None, threshold=0.6):
    """Merge events that are the same real event arriving from different sources.

    Two events are merged only when ALL hold: same canonical venue (lid), at
    least one shared calendar date, and title content-word overlap (Jaccard) at
    or above `threshold`. The venue + date guard keeps concurrent-but-different
    activities at the same building apart. Mutates events and calendar in place;
    returns the {dropped_id: canonical_id} remap.
    """
    locations = locations or {}
    dates = defaultdict(set)
    for ds, entries in calendar.items():
        for e in entries:
            dates[e["event_id"]].add(ds)

    by_lid = defaultdict(list)
    for eid, ev in events.items():
        if ev.get("lid"):
            by_lid[ev["lid"]].append(eid)

    remap = {}
    for lid, ids in by_lid.items():
        if len(ids) < 2:
            continue
        venue_name = locations.get(lid, {}).get("location_name", "")
        tokens = {eid: _content_tokens(events[eid].get("title", ""), venue_name) for eid in ids}
        # union-find: merge ids with overlapping dates and similar titles, unless
        # the differing words are a discriminator (level/session/age/status).
        parent = {i: i for i in ids}
        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a, b = ids[i], ids[j]
                if not (dates[a] & dates[b]):
                    continue
                if _title_similarity(tokens[a], tokens[b]) < threshold:
                    continue
                if _has_discriminator(tokens[a] ^ tokens[b]):
                    continue
                parent[find(a)] = find(b)
        clusters = defaultdict(list)
        for i in ids:
            clusters[find(i)].append(i)
        for members in clusters.values():
            if len(members) < 2:
                continue
            # canonical = richest, then most dates, then stable by id
            canon = max(members, key=lambda e: (richness(events[e]), len(dates[e]), e))
            for other in members:
                if other == canon:
                    continue
                print(f"  merge: {events[other].get('title')!r} -> {events[canon].get('title')!r}")
                events[canon] = merge_event(events[canon], events[other])
                events[canon]["lid"] = events[canon].get("lid") or events[other].get("lid")
                remap[other] = canon

    if not remap:
        return remap

    # Drop merged events and remap their calendar entries onto the canonical id
    for d in remap:
        events.pop(d, None)
    for ds, entries in calendar.items():
        merged, seen = [], {}
        for e in entries:
            eid = remap.get(e["event_id"], e["event_id"])
            key = (eid, e.get("start_time", ""))
            if key in seen:
                if e.get("end_time") and not seen[key].get("end_time"):
                    seen[key]["end_time"] = e["end_time"]
                continue
            entry = {**e, "event_id": eid}
            seen[key] = entry
            merged.append(entry)
        calendar[ds] = merged

    print(f"Cross-source dedup: merged {len(remap)} duplicate event(s)")
    return remap


def cal_entries_for_date(ev, eid, ds):
    schedule = ev.get("schedule") or {}
    try:
        weekday = datetime.strptime(ds, "%Y-%m-%d").weekday()
    except ValueError:
        weekday = None

    day_times = None
    if weekday is not None and isinstance(schedule, dict):
        day_times = schedule.get(weekday) or schedule.get(str(weekday))
    if day_times:
        day_times = sorted(day_times)
        entries = []
        for i in range(0, len(day_times), 2):
            entry = {"event_id": eid, "start_time": day_times[i]}
            if i + 1 < len(day_times):
                entry["end_time"] = day_times[i + 1]
            entries.append(entry)
        return entries
    if schedule and isinstance(schedule, dict):
        if weekday is None or not (weekday in schedule or str(weekday) in schedule):
            return []
    entry = {"event_id": eid}
    if ev.get("start_time"):
        entry["start_time"] = ev["start_time"]
    if ev.get("end_time"):
        entry["end_time"] = ev["end_time"]
    return [entry]


def _apply_enrich(event_data, enrich_data):
    """Apply enrich data: LLM fills gaps, never overwrites scraper dates."""
    if not enrich_data:
        return event_data

    merged = {**event_data}

    # LLM wins for description and price (better quality)
    for field in ("description", "price"):
        if enrich_data.get(field):
            merged[field] = enrich_data[field]

    # LLM wins for title on datos.madrid (titles are poor quality)
    if enrich_data.get("title") and "madrid_agenda" in event_data.get("source", ""):
        merged["title"] = enrich_data["title"]

    # LLM wins for categories (better classification)
    if enrich_data.get("categories"):
        merged["categories"] = enrich_data["categories"]

    # LLM fills gaps only — never overwrite scraper data
    for field in ("location_name", "address"):
        if enrich_data.get(field) and not event_data.get(field):
            merged[field] = enrich_data[field]

    # LLM never touches dates — those come from the scraper only

    if enrich_data.get("is_multi_event"):
        merged["is_multi_event"] = True

    return merged


def run():
    # Load source files (lower-quality first so higher-quality wins in merge)
    SOURCE_PRIORITY = {"esmadrid": 1}
    source_files = sorted(glob(os.path.join(SOURCES_DIR, "*.json")),
                          key=lambda p: SOURCE_PRIORITY.get(os.path.splitext(os.path.basename(p))[0], 0))
    if not source_files:
        print("No source files found in", SOURCES_DIR)
        return

    # Load all enrich files
    all_enrich = {}
    for path in glob(os.path.join(ENRICH_DIR, "*.json")):
        with open(path) as f:
            all_enrich.update(json.load(f))
    if all_enrich:
        print(f"Loaded {len(all_enrich)} enrichments")

    raw_events = {}  # id -> raw event (with schedule, dates — for calendar)
    events = {}      # id -> event data (for events.json)
    calendar = {}

    for path in source_files:
        source_name = os.path.splitext(os.path.basename(path))[0]
        print(f"Loading: {source_name}")
        with open(path) as f:
            source_events = json.load(f)
        print(f"  {len(source_events)} events")

        for ev in source_events:
            title = ev.get("title", "")
            start_date = ev.get("start_date", "")
            if not title or not start_date:
                continue
            if ev.get("is_multi_event") and not ev.get("schedule") and not ev.get("start_time"):
                continue

            eid = ev.get("id") or make_event_id(title)

            # Raw events: keep full data for calendar generation
            if eid in raw_events:
                raw_events[eid] = merge_event(raw_events[eid], ev)
            else:
                raw_events[eid] = {**ev}

            # Build event data (without date/schedule fields)
            event_data = {k: v for k, v in ev.items()
                          if k not in ("start_date", "end_date", "schedule",
                                       "id", "created_at", "updated_at",
                                       "open_days", "end_time")
                          and v is not None}

            # Upgrade http to https
            if event_data.get("url", "").startswith("http://"):
                event_data["url"] = "https://" + event_data["url"][7:]

            # Apply enrich
            enrich_data = all_enrich.get(eid)
            if enrich_data:
                event_data = _apply_enrich(event_data, enrich_data)

            if eid in events:
                events[eid] = merge_event(events[eid], event_data)
            else:
                events[eid] = event_data

    # Normalize categories, infer parent category from tags, remove redundant "otros"
    TAG_PARENT = {
        "danza": "teatro", "circo": "teatro", "ópera": "conciertos",
        "monólogos": "teatro", "cine": "teatro", "musicales": "teatro",
        "magia": "teatro", "flamenco": "conciertos",
        "fotografía": "exposiciones", "gastronomía": "ferias",
        "literatura": "ferias", "mercados": "ferias", "fiestas": "ferias",
    }
    for eid, ev in events.items():
        ev["categories"] = normalize(ev.get("categories", []))
        cats = ev["categories"]
        # If event only has tags but no main category, add the parent
        if not any(c in CATEGORIES for c in cats):
            for tag, parent in TAG_PARENT.items():
                if tag in cats:
                    cats.insert(0, parent)
                    break
        if "otros" in cats and any(c in CATEGORIES and c != "otros" for c in cats):
            cats.remove("otros")

    # Generate calendar from raw events (with original dates and schedules)
    min_date, max_date = calendar_window()
    min_dt = datetime.strptime(min_date, "%Y-%m-%d")
    max_dt = datetime.strptime(max_date, "%Y-%m-%d")

    for eid, ev in raw_events.items():
        start_date = ev.get("start_date", "")
        end_date = ev.get("end_date") or start_date

        # Expand date range
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        except ValueError:
            continue

        # Cap to our window (keeps PAST_DAYS of past + FUTURE_DAYS ahead)
        d = max(start_dt, min_dt)
        end_dt = min(end_dt, max_dt)

        while d <= end_dt:
            ds = d.strftime("%Y-%m-%d")
            entries = cal_entries_for_date(ev, eid, ds)
            if entries:
                if ds not in calendar:
                    calendar[ds] = []
                # Remove existing entries for this event on this day
                calendar[ds] = [e for e in calendar[ds] if e["event_id"] != eid]
                calendar[ds].extend(entries)
            d += timedelta(days=1)

    calendar = dict(sorted((k, v) for k, v in calendar.items() if min_date <= k <= max_date))

    # Keep only events with at least one calendar entry in the window. Sources
    # accumulate past events forever; without this, events.json grows unbounded
    # and global search surfaces thousands of expired ("sin fecha") events.
    live_ids = {e["event_id"] for entries in calendar.values() for e in entries}
    dropped = sum(1 for eid in events if eid not in live_ids)
    events = {eid: ev for eid, ev in events.items() if eid in live_ids}
    print(f"Pruned {dropped} events without calendar entries (kept {len(events)})")

    # Extract + canonicalize locations (cluster same-building name/coord variants)
    venue_recs = {}
    for ev in events.values():
        loc_name = (ev.get("location_name") or "").strip()
        if not loc_name:
            continue
        r = venue_recs.setdefault(
            loc_name, {"rec": {k: ev.get(k) for k in LOC_FIELDS if ev.get(k) is not None}, "count": 0})
        r["count"] += 1

    name_to_lid, locations = canonicalize_venues(venue_recs)

    for ev in events.values():
        loc_name = (ev.get("location_name") or "").strip()
        lid = name_to_lid.get(loc_name) if loc_name else None
        if lid:
            ev["lid"] = lid
            for k in LOC_FIELDS:
                ev.pop(k, None)
        # else: not a canonical venue -> keep location fields inline on the event

    # Cross-source dedup: same venue + overlapping date + similar title -> one event
    dedup_cross_source(events, calendar, locations)

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(EVENTS_PATH, "w") as f:
        json.dump(events, f, indent=2, ensure_ascii=False, default=str)

    with open(CALENDAR_PATH, "w") as f:
        json.dump(calendar, f, indent=2, ensure_ascii=False, default=str)

    with open(LOCATIONS_PATH, "w") as f:
        json.dump(locations, f, indent=2, ensure_ascii=False, default=str)

    total_entries = sum(len(v) for v in calendar.values())
    print(f"\nWrote {len(events)} events, {len(locations)} locations, {len(calendar)} days ({total_entries} calendar entries)")

    generate_seo()


if __name__ == "__main__":
    run()
