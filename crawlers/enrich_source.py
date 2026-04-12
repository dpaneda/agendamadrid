"""Enrich existing source events with LLM data, saving to a separate file.

Two modes:
- HTML mode (default for esmadrid): downloads each event page, sends HTML to LLM
- Batch mode (--batch, default for madrid_agenda): sends event metadata in batches

Usage:
  GEMINI_API_KEY=key python -m crawlers.enrich_source esmadrid
  GEMINI_API_KEY=key python -m crawlers.enrich_source madrid_agenda --batch
"""

import json
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.base import make_event_id
from crawlers.llm_enrich import enrich, enrich_batch, _get_client

SOURCES_DIR = os.path.join(os.path.dirname(__file__), "data", "sources")
ENRICH_DIR = os.path.join(os.path.dirname(__file__), "data", "enrich")
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}

BATCH_SIZE = 10


def _save(enrich_path, data):
    os.makedirs(ENRICH_DIR, exist_ok=True)
    with open(enrich_path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)


def run_html(source_name, limit=0, force=False):
    """Enrich by downloading each event's page and sending HTML to LLM."""
    source_path = os.path.join(SOURCES_DIR, f"{source_name}.json")
    enrich_path = os.path.join(ENRICH_DIR, f"{source_name}.json")

    with open(source_path) as f:
        events = json.load(f)

    existing_enrich = {}
    if not force and os.path.exists(enrich_path):
        with open(enrich_path) as f:
            existing_enrich = json.load(f)

    print(f"Loaded {len(events)} events from {source_name}, {len(existing_enrich)} already enriched")

    enriched_count = 0
    errors = 0
    skipped = 0

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
                print(f"    OK: {' | '.join(parts) or 'no new data'}")
                if enriched_count % 10 == 0:
                    _save(enrich_path, existing_enrich)
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
    _save(enrich_path, existing_enrich)
    print(f"Saved {len(existing_enrich)} enrichments to {enrich_path}")


def run_batch(source_name, limit=0, force=False):
    """Enrich events in batches using metadata only (no HTML download)."""
    source_path = os.path.join(SOURCES_DIR, f"{source_name}.json")
    enrich_path = os.path.join(ENRICH_DIR, f"{source_name}.json")

    with open(source_path) as f:
        events = json.load(f)

    existing_enrich = {}
    if not force and os.path.exists(enrich_path):
        with open(enrich_path) as f:
            existing_enrich = json.load(f)

    # Filter to unenriched events
    pending = []
    for ev in events:
        eid = ev.get("id") or make_event_id(ev.get("title", ""))
        if not force and eid in existing_enrich:
            continue
        pending.append((eid, ev))
        if limit and len(pending) >= limit:
            break

    print(f"Loaded {len(events)} events from {source_name}, {len(existing_enrich)} already enriched, {len(pending)} pending")

    enriched_count = 0
    errors = 0

    for i in range(0, len(pending), BATCH_SIZE):
        batch = pending[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        total_batches = (len(pending) + BATCH_SIZE - 1) // BATCH_SIZE
        titles = [ev.get("title", "???")[:50] for _, ev in batch]
        print(f"\n  Batch {batch_num}/{total_batches} ({len(batch)} events): {titles[0]}...")

        batch_events = [ev for _, ev in batch]
        results = enrich_batch(batch_events)

        if results and len(results) == len(batch):
            for j, (eid, ev) in enumerate(batch):
                existing_enrich[eid] = results[j]
                enriched_count += 1
            cats = [r.get("categories", []) for r in results]
            print(f"    OK: {enriched_count} enriched so far")
            _save(enrich_path, existing_enrich)
            print(f"    💾 Saved ({len(existing_enrich)} total)")
        else:
            errors += len(batch)
            print(f"    ✗ Batch failed (got {len(results) if results else 0}/{len(batch)})")

    print(f"\nDone: {enriched_count} enriched, {errors} errors")
    _save(enrich_path, existing_enrich)
    print(f"Saved {len(existing_enrich)} enrichments to {enrich_path}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Source name (e.g. esmadrid, madrid_agenda)")
    parser.add_argument("--limit", type=int, default=0, help="Max events to enrich (0=all)")
    parser.add_argument("--force", action="store_true", help="Re-enrich all events")
    parser.add_argument("--batch", action="store_true", help="Use batch mode (no HTML, metadata only)")
    args = parser.parse_args()

    if not _get_client():
        print("Error: set GEMINI_API_KEY env var")
        sys.exit(1)

    if args.batch:
        run_batch(args.source, limit=args.limit, force=args.force)
    else:
        run_html(args.source, limit=args.limit, force=args.force)
