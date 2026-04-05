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

        # Index existing events by source_url for stub matching
        by_url = {}
        for t, ev in by_title.items():
            url = ev.get("source_url") or ev.get("url")
            if url:
                by_url[url] = t

        for ev in new_events:
            # Stubs from known URLs: extend end_date of existing event
            if "_known_url" in ev:
                t = by_url.get(ev["_known_url"])
                if t and t in by_title:
                    ds = ev.get("start_date", "")
                    old_ed = by_title[t].get("end_date", "")
                    if ds and (not old_ed or ds > old_ed):
                        by_title[t]["end_date"] = ds
                continue
            t = ev.get("title", "").strip().lower()
            if not t:
                continue
            if t in by_title:
                old = by_title[t]
                # Expand date range: keep earliest start, latest end
                old_sd = old.get("start_date", "")
                new_sd = ev.get("start_date", "")
                old_ed = old.get("end_date", "")
                new_ed = ev.get("end_date", "")
                by_title[t] = ev
                if old_sd and (not new_sd or old_sd < new_sd):
                    by_title[t]["start_date"] = old_sd
                if old_ed and (not new_ed or old_ed > new_ed):
                    by_title[t]["end_date"] = old_ed
            else:
                by_title[t] = ev
            # Update url index
            url = ev.get("source_url") or ev.get("url")
            if url:
                by_url[url] = t

        merged = list(by_title.values())
        self.save(merged)
        return merged
