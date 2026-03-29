"""Standalone tool to parse an event page with Gemini LLM.

Usage:
  python -m crawlers.llm_parse "https://www.esmadrid.com/agenda/..." --key YOUR_KEY
"""

import json
import os
import sys

import requests
from crawlers.llm_enrich import PROMPT, _clean_html, _get_client, _model

import re


def fetch_and_parse(url, api_key=None):
    if api_key:
        os.environ["GEMINI_API_KEY"] = api_key

    client = _get_client()
    if not client:
        print("Error: set GEMINI_API_KEY env var or pass --key")
        sys.exit(1)

    print(f"Fetching: {url}")
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
    resp = requests.get(url, timeout=15, headers=headers)
    resp.raise_for_status()

    text = _clean_html(resp.text)
    print(f"Content: {len(text)} chars")

    response = client.models.generate_content(
        model=_model,
        contents=PROMPT + text,
    )

    raw = response.text.strip()
    if raw.startswith("```"):
        raw = re.sub(r'^```\w*\n?', '', raw)
        raw = re.sub(r'\n?```$', '', raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        print(f"Failed to parse JSON:\n{raw[:500]}")
        return None


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="URL of event page to parse")
    parser.add_argument("--key", help="Gemini API key")
    args = parser.parse_args()

    result = fetch_and_parse(args.url, args.key)
    if result:
        print(json.dumps(result, indent=2, ensure_ascii=False))
