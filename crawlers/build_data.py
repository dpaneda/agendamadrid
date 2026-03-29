"""Run all crawlers and consolidate into frontend data files.

This is the main entry point for the build pipeline:
  1. crawl_source: fetch events from each source, save to data/sources/{name}.json
  2. consolidate: merge all sources into events.json + calendar.json + locations.json

Usage:
  python crawlers/build_data.py              # crawl all + consolidate
  python crawlers/build_data.py --only X     # crawl one source + consolidate
  python crawlers/build_data.py --consolidate # only consolidate (no crawling)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.crawl_source import run as crawl_sources
from crawlers.consolidate import run as consolidate


def run(only=None, force=False, consolidate_only=False):
    if not consolidate_only:
        names = [only] if only else None
        crawl_sources(names=names, force=force)

    print("\n--- Consolidating ---")
    consolidate()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="Run only this crawler (e.g. esmadrid)")
    parser.add_argument("--force", action="store_true", help="Force re-scrape of known events")
    parser.add_argument("--consolidate", action="store_true", help="Only consolidate, skip crawling")
    args = parser.parse_args()
    run(only=args.only, force=args.force, consolidate_only=args.consolidate)
