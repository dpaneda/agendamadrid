"""Patch existing events.json with og:image from source_url or destination url."""

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

    # Find events without image — try source_url first, then destination url
    to_fetch = {}
    for eid, ev in events.items():
        if ev.get("image"):
            continue
        url = ev.get("source_url") or ""
        if url:
            to_fetch[eid] = url
        elif ev.get("url"):
            to_fetch[eid] = ev["url"]

    print(f"Found {len(to_fetch)} events without image")

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

    print(f"Patched {count} events with images (pass 1: source_url/url)")

    # Pass 2: for events that still have no image, try destination url if different
    to_fetch2 = {}
    for eid, ev in events.items():
        if ev.get("image"):
            continue
        dest_url = ev.get("url") or ""
        source_url = ev.get("source_url") or ""
        if dest_url and dest_url != source_url:
            to_fetch2[eid] = dest_url

    if to_fetch2:
        print(f"Pass 2: trying {len(to_fetch2)} destination URLs")
        count2 = 0
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(fetch_image, url): eid for eid, url in to_fetch2.items()}
            for future in as_completed(futures):
                eid = futures[future]
                img = future.result()
                if img:
                    events[eid]["image"] = img
                    count2 += 1
        print(f"Patched {count2} more events (pass 2: destination url)")
        count += count2

    with open(EVENTS_PATH, "w") as f:
        json.dump(events, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Done! Total: {count} images patched")


if __name__ == "__main__":
    main()
