"""Discover and run all crawlers, then send events to the API."""

import importlib
import os
import sys
import pkgutil
import requests

API_URL = os.getenv("API_URL", "http://localhost:8000")
API_KEY = os.getenv("API_KEY", "test")


def discover_crawlers():
    """Import all modules in crawlers/sources/ and return BaseCrawler subclass instances."""
    from crawlers.base import BaseCrawler

    sources_dir = os.path.join(os.path.dirname(__file__), "sources")
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

    crawlers = []
    for importer, name, _ in pkgutil.iter_modules([sources_dir]):
        mod = importlib.import_module(f"crawlers.sources.{name}")
        for attr in dir(mod):
            obj = getattr(mod, attr)
            if isinstance(obj, type) and issubclass(obj, BaseCrawler) and obj is not BaseCrawler:
                crawlers.append(obj())
    return crawlers


def run():
    crawlers = discover_crawlers()
    print(f"Found {len(crawlers)} crawler(s)")

    for crawler in crawlers:
        print(f"\nRunning: {crawler.name}")
        try:
            events = crawler.crawl()
            print(f"  Got {len(events)} events")
            if events:
                resp = requests.post(
                    f"{API_URL}/api/events/bulk",
                    json=events,
                    headers={"X-API-Key": API_KEY},
                )
                resp.raise_for_status()
                print(f"  Upserted: {resp.json()['upserted']}")
        except Exception as e:
            print(f"  Error: {e}")


if __name__ == "__main__":
    run()
