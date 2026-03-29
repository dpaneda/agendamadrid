"""Consolidate source JSONs into events.json + calendar.json + locations.json.

Reads all files in data/sources/*.json and merges them into the final output.
This step is fast and doesn't hit any external APIs.

Usage:
  python crawlers/consolidate.py
"""

import hashlib
import json
import os
import sys
from datetime import datetime, UTC
from glob import glob

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.generate_seo import run as generate_seo

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "data")
SOURCES_DIR = os.path.join(os.path.dirname(__file__), "data", "sources")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
CALENDAR_PATH = os.path.join(DATA_DIR, "calendar.json")
LOCATIONS_PATH = os.path.join(DATA_DIR, "locations.json")

LOC_FIELDS = ("location_name", "address", "district", "latitude", "longitude")

RICHNESS_FIELDS = ["description", "start_time", "end_time", "location_name", "address",
                   "latitude", "longitude", "url", "district", "image"]


def make_event_id(title):
    title_norm = title.strip().lower()
    return hashlib.sha256(title_norm.encode()).hexdigest()[:16]


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


def run():
    # Load lower-quality sources first, so higher-quality ones win in merge
    SOURCE_PRIORITY = {"madrid_agenda": 0, "esmadrid": 1}
    source_files = sorted(glob(os.path.join(SOURCES_DIR, "*.json")),
                          key=lambda p: SOURCE_PRIORITY.get(os.path.splitext(os.path.basename(p))[0], 0))
    if not source_files:
        print("No source files found in", SOURCES_DIR)
        return

    events = {}
    calendar = {}

    for path in source_files:
        source_name = os.path.splitext(os.path.basename(path))[0]
        print(f"Loading: {source_name}")
        with open(path) as f:
            raw_events = json.load(f)
        print(f"  {len(raw_events)} events")

        for ev in raw_events:
            title = ev.get("title", "")
            start_date = ev.get("start_date", "")
            if not title or not start_date:
                continue

            eid = make_event_id(title)

            # Calendar entries
            if start_date not in calendar:
                calendar[start_date] = []
            calendar[start_date] = [e for e in calendar[start_date] if e["event_id"] != eid]
            calendar[start_date].extend(cal_entries_for_date(ev, eid, start_date))

            # Also add entries for date range (capped at 30 days from today)
            end_date = ev.get("end_date")
            if end_date and end_date > start_date:
                from datetime import timedelta
                today_dt = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                max_dt = today_dt + timedelta(days=30)
                d = max(datetime.strptime(start_date, "%Y-%m-%d"), today_dt)
                end_d = min(datetime.strptime(end_date, "%Y-%m-%d"), max_dt)
                d += timedelta(days=1)
                while d <= end_d:
                    ds = d.strftime("%Y-%m-%d")
                    if ds not in calendar:
                        calendar[ds] = []
                    calendar[ds] = [e for e in calendar[ds] if e["event_id"] != eid]
                    entries = cal_entries_for_date(ev, eid, ds)
                    if entries:
                        calendar[ds].extend(entries)
                    d += timedelta(days=1)

            # Build event data (without date-specific fields)
            event_data = {k: v for k, v in ev.items()
                          if k not in ("start_date", "end_date", "schedule",
                                       "id", "created_at", "updated_at",
                                       "open_days", "end_time")
                          and v is not None}

            # Upgrade http to https
            if event_data.get("url", "").startswith("http://"):
                event_data["url"] = "https://" + event_data["url"][7:]

            if eid in events:
                events[eid] = merge_event(events[eid], event_data)
            else:
                events[eid] = event_data

    # Keep only today + 30 days
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    max_date = (datetime.now(UTC) + timedelta(days=30)).strftime("%Y-%m-%d")
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
