"""Enrich existing source events with LLM data.

Reads a source JSON, downloads each event's source_url, sends to LLM,
and merges the result back. Saves enriched events to the same file.

Usage:
  GEMINI_API_KEY=key python -m crawlers.enrich_source esmadrid --limit 5
"""

import json
import os
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.llm_enrich import enrich, merge_llm_data, _clean_html, _get_client

SOURCES_DIR = os.path.join(os.path.dirname(__file__), "data", "sources")
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}


def run(source_name, limit=0, skip_enriched=True):
    path = os.path.join(SOURCES_DIR, f"{source_name}.json")
    if not os.path.exists(path):
        print(f"Source file not found: {path}")
        sys.exit(1)

    if not _get_client():
        print("Error: set GEMINI_API_KEY env var")
        sys.exit(1)

    with open(path) as f:
        events = json.load(f)

    print(f"Loaded {len(events)} events from {source_name}")

    enriched = 0
    errors = 0
    skipped = 0

    for i, ev in enumerate(events):
        if limit and enriched >= limit:
            break

        url = ev.get("source_url") or ev.get("url")
        if not url or not url.startswith("http"):
            skipped += 1
            continue

        if skip_enriched and ev.get("_enriched"):
            skipped += 1
            continue

        title = ev.get("title", "???")
        print(f"\n  [{enriched+1}/{limit or '∞'}] {title}")

        try:
            resp = requests.get(url, timeout=15, headers=HEADERS)
            resp.raise_for_status()
            html = resp.text

            llm_data = enrich(html)
            if llm_data:
                events[i] = merge_llm_data(ev, llm_data)
                events[i]["_enriched"] = True
                enriched += 1
                parts = []
                if llm_data.get("price"):
                    parts.append(f"💰 {llm_data['price']}")
                if llm_data.get("schedule"):
                    parts.append(f"🕐 {len(llm_data['schedule'])} días")
                if llm_data.get("categories"):
                    parts.append(f"🏷 {','.join(llm_data['categories'])}")
                if llm_data.get("is_multi_event"):
                    parts.append("📦 multi-evento")
                print(f"    ✓ {' | '.join(parts) or 'sin datos nuevos'}")
            else:
                errors += 1
                print(f"    ✗ No LLM data returned")


        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code in (403, 404, 410):
                events[i] = None  # mark for removal
                errors += 1
                print(f"    🗑 Removed (HTTP {e.response.status_code})")
            else:
                errors += 1
                events[i]["_broken"] = str(e)[:100]
                print(f"    ✗ {e}")
        except Exception as e:
            errors += 1
            print(f"    ✗ {e}")

    events = [ev for ev in events if ev is not None]
    removed = len(json.load(open(path))) - len(events) if os.path.exists(path) else 0
    print(f"\nDone: {enriched} enriched, {errors} errors, {skipped} skipped, {removed} removed")

    with open(path, "w") as f:
        json.dump(events, f, indent=2, ensure_ascii=False, default=str)
    print(f"Saved {len(events)} events to {path}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Source name (e.g. esmadrid)")
    parser.add_argument("--limit", type=int, default=0, help="Max events to enrich (0=all)")
    parser.add_argument("--all", action="store_true", help="Re-enrich already enriched events")
    args = parser.parse_args()
    run(args.source, limit=args.limit, skip_enriched=not args.all)
