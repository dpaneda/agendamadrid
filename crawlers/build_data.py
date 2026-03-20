"""Run all crawlers and write events.json + calendar.json."""

import hashlib
import json
import os
import sys
from datetime import datetime, date as date_type, UTC

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.runner import discover_crawlers
from crawlers.generate_seo import run as generate_seo

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
CALENDAR_PATH = os.path.join(DATA_DIR, "calendar.json")

RICHNESS_FIELDS = ["description", "start_time", "end_time", "location_name", "address",
                   "latitude", "longitude", "url", "district"]


def cal_entries_for_date(ev, eid, ds):
    """Return list of calendar entries for event ev on date string ds."""
    schedule = ev.get("schedule") or {}
    try:
        weekday = datetime.strptime(ds, "%Y-%m-%d").weekday()
    except ValueError:
        weekday = None
    day_times = (schedule.get(weekday) or schedule.get(str(weekday)) or []) if weekday is not None else []
    if day_times:
        return [{"event_id": eid, "start_time": t} for t in day_times]
    entry = {"event_id": eid}
    if ev.get("start_time"):
        entry["start_time"] = ev["start_time"]
    if ev.get("end_time"):
        entry["end_time"] = ev["end_time"]
    return [entry]


def make_event_id(title):
    """Generate a stable ID from the event title (date-independent)."""
    title_norm = title.strip().lower()
    return hashlib.sha256(title_norm.encode()).hexdigest()[:16]


def richness(ev):
    """Score how complete an event record is."""
    return sum(1 for f in RICHNESS_FIELDS if ev.get(f))


def merge_event(existing, new):
    """Keep the richer record, merging categories and sources."""
    if richness(new) > richness(existing):
        base = {**new}
    else:
        base = {**existing}

    cats = list(dict.fromkeys(existing.get("categories", []) + new.get("categories", [])))
    base["categories"] = cats

    # Always take the newer schedule if present (existing may predate schedule parsing)
    if new.get("schedule"):
        base["schedule"] = new["schedule"]

    sources = set()
    for ev in [existing, new]:
        s = ev.get("source", "")
        if "," in s:
            sources.update(s.split(","))
        else:
            sources.add(s)
    base["source"] = ",".join(sorted(sources))

    return base


def load_existing():
    """Load existing events.json and calendar.json."""
    events = {}
    calendar = {}
    known_source_urls = set()

    if os.path.exists(EVENTS_PATH):
        try:
            with open(EVENTS_PATH) as f:
                events = json.load(f)
            for ev in events.values():
                url = ev.get("source_url") or ev.get("url")
                if url:
                    known_source_urls.add(url)
        except (json.JSONDecodeError, OSError):
            pass

    if os.path.exists(CALENDAR_PATH):
        try:
            with open(CALENDAR_PATH) as f:
                calendar = json.load(f)
        except (json.JSONDecodeError, OSError):
            pass

    return events, calendar, known_source_urls


def run(only=None, force=False):
    crawlers = discover_crawlers()
    if only:
        crawlers = [c for c in crawlers if c.name == only]
    print(f"Found {len(crawlers)} crawler(s)")

    events, calendar, known_source_urls = load_existing()
    if events:
        print(f"Loaded {len(events)} existing events, {len(calendar)} calendar days")

    if force and only:
        # Remove known URLs belonging to the forced crawler so they get re-scraped
        forced_eids = {eid for eid, ev in events.items() if only in (ev.get("source") or "")}
        forced_urls = {ev.get("source_url") or ev.get("url") for eid, ev in events.items() if eid in forced_eids}
        known_source_urls -= forced_urls
        print(f"  Force mode: cleared {len(forced_urls)} known URLs for '{only}'")

    now = datetime.now(UTC).isoformat()

    # Build URL -> event_id index for fast lookup
    url_to_eid = {}
    for eid, ev in events.items():
        url = ev.get("source_url") or ev.get("url")
        if url:
            url_to_eid[url] = eid

    for crawler in crawlers:
        print(f"\nRunning: {crawler.name}")
        try:
            if hasattr(crawler, 'crawl_incremental'):
                raw_events = crawler.crawl_incremental(known_source_urls)
            else:
                raw_events = crawler.crawl()

            print(f"  Got {len(raw_events)} event entries")
            for ev in raw_events:
                # Handle stubs from known URLs (event already in DB)
                if "_known_url" in ev:
                    known_url = ev["_known_url"]
                    start_date = ev.get("start_date", "")
                    eid = url_to_eid.get(known_url)
                    if start_date and eid:
                        if start_date not in calendar:
                            calendar[start_date] = []
                        calendar[start_date] = [e for e in calendar[start_date] if e["event_id"] != eid]
                        calendar[start_date].extend(cal_entries_for_date(events[eid], eid, start_date))
                    continue

                title = ev.get("title", "")
                start_date = ev.get("start_date", "")
                if not title or not start_date:
                    continue

                eid = make_event_id(title)

                # Add to calendar (one entry per time slot, replacing old entries)
                if start_date not in calendar:
                    calendar[start_date] = []
                calendar[start_date] = [e for e in calendar[start_date] if e["event_id"] != eid]
                calendar[start_date].extend(cal_entries_for_date(ev, eid, start_date))

                # Build event data (without date-specific fields)
                event_data = {k: v for k, v in ev.items()
                              if k not in ("start_date", "end_date", "start_time",
                                           "end_time", "id", "created_at", "updated_at",
                                           "open_days")}
                event_data["id"] = eid
                event_data.setdefault("created_at", now)
                event_data["updated_at"] = now

                if eid in events:
                    events[eid] = merge_event(events[eid], event_data)
                else:
                    events[eid] = event_data

                url = ev.get("source_url") or ev.get("url")
                if url:
                    known_source_urls.add(url)
                    url_to_eid[url] = eid

        except Exception as e:
            print(f"  Error: {e}")

    # Sort calendar dates
    calendar = dict(sorted(calendar.items()))

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(EVENTS_PATH, "w") as f:
        json.dump(events, f, indent=2, ensure_ascii=False, default=str)

    with open(CALENDAR_PATH, "w") as f:
        json.dump(calendar, f, indent=2, ensure_ascii=False, default=str)

    total_entries = sum(len(v) for v in calendar.values())
    print(f"\nWrote {len(events)} events, {len(calendar)} days ({total_entries} calendar entries)")

    generate_seo()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="Run only this crawler (e.g. esmadrid)")
    parser.add_argument("--force", action="store_true", help="Force re-scrape of known events")
    args = parser.parse_args()
    run(only=args.only, force=args.force)
