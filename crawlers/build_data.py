"""Run all crawlers and write events directly to frontend/data/events.json."""

import hashlib
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.runner import discover_crawlers

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "frontend", "data", "events.json")


def make_id(source, title, start_date):
    title_norm = title.strip().lower()
    raw = f"{source}:{title_norm}:{start_date}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def run():
    crawlers = discover_crawlers()
    print(f"Found {len(crawlers)} crawler(s)")

    all_events = {}
    now = datetime.utcnow().isoformat()

    for crawler in crawlers:
        print(f"\nRunning: {crawler.name}")
        try:
            raw_events = crawler.crawl()
            print(f"  Got {len(raw_events)} events")
            for ev in raw_events:
                eid = make_id(ev.get("source", ""), ev.get("title", ""), ev.get("start_date", ""))
                ev["id"] = eid
                ev.setdefault("created_at", now)
                ev["updated_at"] = now
                all_events[eid] = ev
        except Exception as e:
            print(f"  Error: {e}")

    events_list = sorted(all_events.values(), key=lambda e: (e.get("start_date", ""), e.get("start_time") or ""))

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(events_list, f, indent=2, ensure_ascii=False, default=str)

    print(f"\nWrote {len(events_list)} events to {OUTPUT_PATH}")


if __name__ == "__main__":
    run()
