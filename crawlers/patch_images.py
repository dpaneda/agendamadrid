"""Patch existing events.json with og:image from source_url (esmadrid events)."""

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup

EVENTS_PATH = os.path.join(os.path.dirname(__file__), "..", "frontend", "data", "events.json")
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"}


def fetch_image(url):
    """Fetch og:image from a URL."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

        # Try JSON-LD first
        ld_script = soup.find("script", type="application/ld+json")
        if ld_script:
            try:
                ld = json.loads(ld_script.string)
                if "@graph" in ld:
                    for item in ld["@graph"]:
                        if item.get("@type") == "Event":
                            ld = item
                            break
                img = ld.get("image")
                if isinstance(img, list) and img:
                    img = img[0] if isinstance(img[0], str) else img[0].get("url")
                elif isinstance(img, dict):
                    img = img.get("url")
                if img:
                    return img
            except (json.JSONDecodeError, TypeError):
                pass

        # Fallback to og:image
        og = soup.find("meta", property="og:image")
        if og and og.get("content"):
            return og["content"]
    except Exception:
        pass
    return None


def main():
    with open(EVENTS_PATH) as f:
        events = json.load(f)

    # Find esmadrid events without image
    to_fetch = {}
    for eid, ev in events.items():
        if ev.get("image"):
            continue
        url = ev.get("source_url") or ""
        if "esmadrid.com" in url:
            to_fetch[eid] = url

    print(f"Found {len(to_fetch)} esmadrid events without image")

    count = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_image, url): eid for eid, url in to_fetch.items()}
        for future in as_completed(futures):
            eid = futures[future]
            img = future.result()
            if img:
                events[eid]["image"] = img
                count += 1
            if (count % 50) == 0 and count > 0:
                print(f"  {count} images found...")

    print(f"Patched {count} events with images")

    with open(EVENTS_PATH, "w") as f:
        json.dump(events, f, ensure_ascii=False, separators=(",", ":"))

    print("Done!")


if __name__ == "__main__":
    main()
