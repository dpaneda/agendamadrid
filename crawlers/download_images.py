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


MAX_ASPECT = 1.3   # height/width — above this we try alternatives
REJECT_ASPECT = 1.5  # above this, discard the image entirely


def _download_image(url):
    """Download an image URL and return PIL Image or None."""
    try:
        resp = requests.get(url, timeout=TIMEOUT, headers=HEADERS)
        resp.raise_for_status()
        return Image.open(BytesIO(resp.content))
    except Exception as e:
        print(f"  Failed: {url[:80]} — {e}")
        return None


def _save_image(img, dest):
    """Resize and save a PIL Image to dest."""
    img = img.convert("RGB")
    if img.width > MAX_WIDTH:
        ratio = MAX_WIDTH / img.width
        img = img.resize((MAX_WIDTH, int(img.height * ratio)), Image.LANCZOS)
    img.save(dest, "JPEG", quality=QUALITY, optimize=True)


def download_and_resize(url, dest, candidates=None):
    if os.path.exists(dest):
        return dest
    img = _download_image(url)
    if not img:
        return None
    # If image is too vertical and there are alternatives, try them
    if candidates and img.height / img.width > MAX_ASPECT:
        for alt_url in candidates:
            if alt_url == url:
                continue
            alt_img = _download_image(alt_url)
            if alt_img and alt_img.height / alt_img.width < img.height / img.width:
                img = alt_img
                dest = os.path.join(os.path.dirname(dest), img_filename(alt_url))
                break
    # Reject images that are still too vertical
    if img.height / img.width > REJECT_ASPECT:
        print(f"  Rejected (too vertical {img.width}x{img.height}): {url[:80]}")
        return None
    _save_image(img, dest)
    return dest


def _process_event(ev):
    """Download image for a single event, return local path or None."""
    url = ev.get("image")
    if not url or not isinstance(url, str) or not url.startswith("http"):
        return None
    dest = os.path.join(IMG_DIR, img_filename(url))
    candidates = ev.get("_image_candidates")
    return download_and_resize(url, dest, candidates=candidates)


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

        to_download = [ev for ev in events
                       if ev.get("image", "").startswith("http")]
        if not to_download:
            continue

        print(f"{source_name}: downloading {len(to_download)} images...")

        ok = 0
        fail = 0
        results = {}  # event index -> local path
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {}
            for ev in to_download:
                idx = id(ev)
                futures[pool.submit(_process_event, ev)] = idx
                results[idx] = ev

            for future in as_completed(futures):
                idx = futures[future]
                ev = results[idx]
                result_path = future.result()
                if result_path:
                    fname = os.path.basename(result_path)
                    ev["image"] = f"images/events/{fname}"
                    ok += 1
                else:
                    # Remove image field if download failed or rejected
                    ev.pop("image", None)
                    fail += 1

        print(f"  {ok} ok, {fail} failed/rejected")

        with open(path, "w") as f:
            json.dump(events, f, indent=2, ensure_ascii=False, default=str)
        print(f"  Updated {ok} image paths in {source_name}")


if __name__ == "__main__":
    run()
