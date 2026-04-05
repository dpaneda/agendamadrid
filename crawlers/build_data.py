"""Run all crawlers and consolidate into frontend data files.

Each crawler can also be run independently:
  python crawlers/sources/madrid_datos.py
  python crawlers/sources/esmadrid.py

Then consolidate:
  python crawlers/consolidate.py

This script does both:
  python crawlers/build_data.py              # crawl all + consolidate
  python crawlers/build_data.py --consolidate # only consolidate
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
        for crawler in crawlers:
            try:
                crawler.run()
            except Exception as e:
                print(f"  Error in {crawler.name}: {e}")
    else:
        print("\n--- Consolidating ---")
        consolidate()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--consolidate", action="store_true", help="Only consolidate, skip crawling")
    args = parser.parse_args()
    run(consolidate_only=args.consolidate)
