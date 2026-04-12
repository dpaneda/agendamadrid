"""Enrich existing source events with LLM data, saving to a separate file.

Reads a source JSON, downloads each event's source_url, sends to LLM,
and saves the enrichment data to crawlers/data/enrich/{source}.json.
Source files are never modified.

Usage:
  GEMINI_API_KEY=key python -m crawlers.enrich_source esmadrid --limit 5
"""

import json
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.base import make_event_id
from crawlers.llm_enrich import enrich, _get_client

SOURCES_DIR = os.path.join(os.path.dirname(__file__), "data", "sources")
ENRICH_DIR = os.path.join(os.path.dirname(__file__), "data", "enrich")
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}


def run(source_name, limit=0, force=False):
    source_path = os.path.join(SOURCES_DIR, f"{source_name}.json")
    enrich_path = os.path.join(ENRICH_DIR, f"{source_name}.json")

    if not os.path.exists(source_path):
        print(f"Source file not found: {source_path}")
        sys.exit(1)

    if not _get_client():
        print("Error: set GEMINI_API_KEY env var")
        sys.exit(1)

    with open(source_path) as f:
        events = json.load(f)

    # Load existing enrichments
    existing_enrich = {}
    if not force and os.path.exists(enrich_path):
        with open(enrich_path) as f:
            existing_enrich = json.load(f)

    print(f"Loaded {len(events)} events from {source_name}, {len(existing_enrich)} already enriched")

    enriched_count = 0
    errors = 0
    skipped = 0
    SAVE_EVERY = 10

    def save():
        os.makedirs(ENRICH_DIR, exist_ok=True)
        with open(enrich_path, "w") as f:
            json.dump(existing_enrich, f, indent=2, ensure_ascii=False, default=str)

    for ev in events:
        if limit and enriched_count >= limit:
            break

        eid = ev.get("id") or make_event_id(ev.get("title", ""))
        url = ev.get("source_url") or ev.get("url")

        if not url or not url.startswith("http"):
            skipped += 1
            continue

        if not force and eid in existing_enrich:
            skipped += 1
            continue

        title = ev.get("title", "???")
        print(f"\n  [{enriched_count+1}/{limit or '∞'}] {title}")

        try:
            resp = requests.get(url, timeout=15, headers=HEADERS)
            resp.raise_for_status()

            llm_data = enrich(resp.text)
            if llm_data:
                existing_enrich[eid] = llm_data
                enriched_count += 1
                parts = []
                if llm_data.get("price"):
                    parts.append(f"price={llm_data['price']}")
                if llm_data.get("schedule"):
                    parts.append(f"schedule={len(llm_data['schedule'])} days")
                if llm_data.get("categories"):
                    parts.append(f"cats={','.join(llm_data['categories'])}")
                if llm_data.get("is_multi_event"):
                    parts.append("multi-event")
                print(f"    OK: {' | '.join(parts) or 'no new data'}")
                if enriched_count % SAVE_EVERY == 0:
                    save()
                    print(f"    💾 Saved ({len(existing_enrich)} total)")
            else:
                errors += 1
                print(f"    No LLM data returned")

        except requests.exceptions.HTTPError as e:
            errors += 1
            status = e.response.status_code if e.response is not None else "?"
            print(f"    HTTP {status}: {e}")
        except Exception as e:
            errors += 1
            print(f"    Error: {e}")

    print(f"\nDone: {enriched_count} enriched, {errors} errors, {skipped} skipped")

    save()
    print(f"Saved {len(existing_enrich)} enrichments to {enrich_path}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Source name (e.g. esmadrid)")
    parser.add_argument("--limit", type=int, default=0, help="Max events to enrich (0=all)")
    parser.add_argument("--force", action="store_true", help="Re-enrich all events")
    args = parser.parse_args()
    run(args.source, limit=args.limit, force=args.force)
