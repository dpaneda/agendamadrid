"""Run a single crawler and save raw results to data/sources/{name}.json.

Usage:
  python crawlers/crawl_source.py esmadrid
  python crawlers/crawl_source.py madrid_agenda
  python crawlers/crawl_source.py --all
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.runner import discover_crawlers

SOURCES_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "data", "sources")


def crawl_one(crawler, known_urls=None):
    """Run a single crawler, return list of raw events."""
    print(f"Running: {crawler.name}")
    if known_urls and hasattr(crawler, "crawl_incremental"):
        events = crawler.crawl_incremental(known_urls)
    else:
        events = crawler.crawl()
    print(f"  Got {len(events)} events")
    return events


def load_existing_source(name):
    """Load previously saved source data."""
    path = os.path.join(SOURCES_DIR, f"{name}.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return []


def save_source(name, events):
    """Save source data to JSON."""
    os.makedirs(SOURCES_DIR, exist_ok=True)
    path = os.path.join(SOURCES_DIR, f"{name}.json")
    with open(path, "w") as f:
        json.dump(events, f, indent=2, ensure_ascii=False, default=str)
    print(f"  Saved {len(events)} events to {path}")


def merge_source_events(existing, new_events):
    """Merge new events into existing source data by title."""
    by_title = {}
    for ev in existing:
        t = ev.get("title", "").strip().lower()
        if t:
            by_title[t] = ev

    for ev in new_events:
        if "_known_url" in ev:
            continue
        t = ev.get("title", "").strip().lower()
        if t:
            by_title[t] = ev

    return list(by_title.values())


def run(names=None, force=False):
    crawlers = discover_crawlers()

    if names:
        crawlers = [c for c in crawlers if c.name in names]
        if not crawlers:
            print(f"No crawlers found for: {names}")
            sys.exit(1)

    for crawler in crawlers:
        existing = [] if force else load_existing_source(crawler.name)
        known_urls = set()
        for ev in existing:
            url = ev.get("source_url") or ev.get("url")
            if url:
                known_urls.add(url)

        try:
            new_events = crawl_one(crawler, known_urls)
            merged = merge_source_events(existing, new_events)
            save_source(crawler.name, merged)
        except Exception as e:
            print(f"  Error: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="*", help="Source names to crawl (e.g. esmadrid madrid_agenda)")
    parser.add_argument("--all", action="store_true", help="Crawl all sources")
    parser.add_argument("--force", action="store_true", help="Ignore existing data, re-crawl everything")
    args = parser.parse_args()

    if args.all:
        run(force=args.force)
    elif args.sources:
        run(names=args.sources, force=args.force)
    else:
        parser.print_help()
