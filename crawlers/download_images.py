"""Download event images locally and update source JSONs.

Scans all source files in crawlers/data/sources/, downloads remote images,
resizes them, and updates the image field to local paths.

Usage:
  python -m crawlers.download_images
"""

import hashlib
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from glob import glob
from io import BytesIO

import requests
from PIL import Image

SOURCES_DIR = os.path.join(os.path.dirname(__file__), "data", "sources")
IMG_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "images", "events")
MAX_WIDTH = 400
QUALITY = 80
TIMEOUT = 15
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.esmadrid.com/",
}


def img_filename(url):
    return hashlib.sha256(url.encode()).hexdigest()[:12] + ".jpg"


def download_and_resize(url, dest):
    if os.path.exists(dest):
        return True
    try:
        resp = requests.get(url, timeout=TIMEOUT, headers=HEADERS)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content))
        img = img.convert("RGB")
        if img.width > MAX_WIDTH:
            ratio = MAX_WIDTH / img.width
            img = img.resize((MAX_WIDTH, int(img.height * ratio)), Image.LANCZOS)
        img.save(dest, "JPEG", quality=QUALITY, optimize=True)
        return True
    except Exception as e:
        print(f"  Failed: {url[:80]} — {e}")
        return False


def run():
    os.makedirs(IMG_DIR, exist_ok=True)

    source_files = glob(os.path.join(SOURCES_DIR, "*.json"))
    if not source_files:
        print("No source files found")
        return

    for path in sorted(source_files):
        source_name = os.path.splitext(os.path.basename(path))[0]
        with open(path) as f:
            events = json.load(f)

        # Collect remote URLs
        url_to_file = {}
        for ev in events:
            url = ev.get("image")
            if url and isinstance(url, str) and url.startswith("http"):
                if url not in url_to_file:
                    url_to_file[url] = img_filename(url)

        if not url_to_file:
            continue

        print(f"{source_name}: downloading {len(url_to_file)} images...")

        ok = 0
        fail = 0
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {}
            for url, fname in url_to_file.items():
                dest = os.path.join(IMG_DIR, fname)
                futures[pool.submit(download_and_resize, url, dest)] = url

            for future in as_completed(futures):
                if future.result():
                    ok += 1
                else:
                    fail += 1

        print(f"  {ok} ok, {fail} failed")

        # Update events with local paths
        changed = 0
        for ev in events:
            url = ev.get("image")
            if url and url in url_to_file:
                fname = url_to_file[url]
                if os.path.exists(os.path.join(IMG_DIR, fname)):
                    ev["image"] = f"images/events/{fname}"
                    changed += 1

        with open(path, "w") as f:
            json.dump(events, f, indent=2, ensure_ascii=False, default=str)
        print(f"  Updated {changed} image paths in {source_name}")


if __name__ == "__main__":
    run()
