import json
import os
from abc import ABC, abstractmethod

SOURCES_DIR = os.path.join(os.path.dirname(__file__), "data", "sources")


class BaseCrawler(ABC):
    name: str = "base"

    @abstractmethod
    def crawl(self) -> list[dict]:
        """Return a list of event dicts."""
        ...

    def load(self):
        """Load previously saved results."""
        path = os.path.join(SOURCES_DIR, f"{self.name}.json")
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
        return []

    def save(self, events):
        """Save results to JSON."""
        os.makedirs(SOURCES_DIR, exist_ok=True)
        path = os.path.join(SOURCES_DIR, f"{self.name}.json")
        with open(path, "w") as f:
            json.dump(events, f, indent=2, ensure_ascii=False, default=str)
        print(f"Saved {len(events)} events to {path}")

    def run(self, force=False):
        """Crawl and save. Merges with existing data unless force=True."""
        existing = [] if force else self.load()
        known_urls = set()
        by_title = {}
        for ev in existing:
            url = ev.get("source_url") or ev.get("url")
            if url:
                known_urls.add(url)
            t = ev.get("title", "").strip().lower()
            if t:
                by_title[t] = ev

        print(f"Running: {self.name}")
        if hasattr(self, "crawl_incremental"):
            new_events = self.crawl_incremental(known_urls)
        else:
            new_events = self.crawl()
        print(f"  Got {len(new_events)} events")

        for ev in new_events:
            if "_known_url" in ev:
                continue
            t = ev.get("title", "").strip().lower()
            if t:
                by_title[t] = ev

        merged = list(by_title.values())
        self.save(merged)
        return merged
