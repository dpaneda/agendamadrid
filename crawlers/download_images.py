"""Download event images locally and update events.json."""

import hashlib
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO

import requests
from PIL import Image

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
IMG_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "images", "events")
MAX_WIDTH = 400
QUALITY = 80
TIMEOUT = 15


def img_filename(url):
    """Generate a stable filename from the image URL."""
    return hashlib.sha256(url.encode()).hexdigest()[:12] + ".jpg"


def download_and_resize(url, dest):
    """Download image, resize to MAX_WIDTH, save as JPEG."""
    if os.path.exists(dest):
        return True
    try:
        headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        resp = requests.get(url, timeout=TIMEOUT, headers=headers)
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

    with open(EVENTS_PATH) as f:
        events = json.load(f)

    # Collect unique URLs (skip already-local paths)
    url_to_file = {}
    for ev in events.values():
        url = ev.get("image")
        if not url or not isinstance(url, str) or not url.startswith("http"):
            continue
        if url not in url_to_file:
            url_to_file[url] = img_filename(url)

    print(f"Downloading {len(url_to_file)} images...")

    ok = 0
    fail = 0
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {}
        for url, fname in url_to_file.items():
            dest = os.path.join(IMG_DIR, fname)
            futures[pool.submit(download_and_resize, url, dest)] = url

        for future in as_completed(futures):
            if future.result():
                ok += 1
            else:
                fail += 1
            if (ok + fail) % 50 == 0:
                print(f"  {ok + fail}/{len(url_to_file)}...")

    print(f"Done: {ok} ok, {fail} failed")

    # Update events.json with local paths
    for ev in events.values():
        url = ev.get("image")
        if not url or url not in url_to_file:
            continue
        fname = url_to_file[url]
        if os.path.exists(os.path.join(IMG_DIR, fname)):
            ev["image"] = f"images/events/{fname}"
        else:
            del ev["image"]

    with open(EVENTS_PATH, "w") as f:
        json.dump(events, f, indent=2, ensure_ascii=False)

    print(f"Updated events.json")


if __name__ == "__main__":
    run()
