"""Run all crawlers (or only consolidate) for the frontend data files.

Each crawler can also be run independently:
  python crawlers/sources/madrid_agenda.py
  python crawlers/sources/esmadrid.py

Usage:
  python crawlers/build_data.py              # only crawl -> crawlers/data/sources/*.json
  python crawlers/build_data.py --consolidate # only consolidate -> frontend/data/*.json + SEO

Crawling and consolidating are separate steps: run this without flags to crawl,
then with --consolidate to regenerate the frontend data (or use crawlers.consolidate).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.runner import discover_crawlers
from crawlers.consolidate import run as consolidate


def run(consolidate_only=False):
    if not consolidate_only:
        crawlers = discover_crawlers()
        print(f"Found {len(crawlers)} crawler(s)")
        failed = []
        for crawler in crawlers:
            try:
                crawler.run()
            except Exception as e:
                print(f"  Error in {crawler.name}: {e}")
                failed.append(crawler.name)
        if failed:
            print(f"\n⚠ {len(failed)}/{len(crawlers)} crawler(s) failed: {', '.join(failed)}")
        if crawlers and len(failed) == len(crawlers):
            print("✗ All crawlers failed; aborting before consolidation")
            sys.exit(1)
    else:
        print("\n--- Consolidating ---")
        consolidate()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--consolidate", action="store_true", help="Only consolidate, skip crawling")
    args = parser.parse_args()
    run(consolidate_only=args.consolidate)
