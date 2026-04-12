"""Consolidate source JSONs + enrich into events.json + calendar.json + locations.json.

Reads all files in data/sources/*.json and data/enrich/*.json, merges them
into the final output. This step is fast and doesn't hit any external APIs.

Usage:
  python -m crawlers.consolidate
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, UTC
from glob import glob

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.base import make_event_id
from crawlers.categories import normalize, CATEGORIES
from crawlers.generate_seo import run as generate_seo

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "data")
SOURCES_DIR = os.path.join(os.path.dirname(__file__), "data", "sources")
ENRICH_DIR = os.path.join(os.path.dirname(__file__), "data", "enrich")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
CALENDAR_PATH = os.path.join(DATA_DIR, "calendar.json")
LOCATIONS_PATH = os.path.join(DATA_DIR, "locations.json")

LOC_FIELDS = ("location_name", "address", "district", "latitude", "longitude")

RICHNESS_FIELDS = ["description", "start_time", "end_time", "location_name", "address",
                   "latitude", "longitude", "url", "district", "image"]


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
    TAG_PARENT = {"danza": "teatro", "circo": "teatro", "ópera": "conciertos", "monólogos": "teatro", "cine": "teatro"}
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
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    max_date = (datetime.now(UTC) + timedelta(days=30)).strftime("%Y-%m-%d")

    for eid, ev in raw_events.items():
        start_date = ev.get("start_date", "")
        end_date = ev.get("end_date") or start_date

        # Expand date range
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            today_dt = datetime.strptime(today, "%Y-%m-%d")
            max_dt = datetime.strptime(max_date, "%Y-%m-%d")
        except ValueError:
            continue

        # Cap to our window
        d = max(start_dt, today_dt)
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

    calendar = dict(sorted((k, v) for k, v in calendar.items() if today <= k <= max_date))

    # Extract locations
    locations = {}
    for ev in events.values():
        loc_name = (ev.get("location_name") or "").strip()
        if not loc_name:
            continue
        lid = hashlib.sha256(loc_name.lower().encode()).hexdigest()[:8]
        if lid not in locations:
            locations[lid] = {k: ev[k] for k in LOC_FIELDS if ev.get(k) is not None}
        ev["lid"] = lid
        for k in LOC_FIELDS:
            ev.pop(k, None)

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
