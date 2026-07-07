"""Tests for SEO JSON-LD generation."""

import sys
import os
import json
import re

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.generate_seo import _generate_json_ld


def _items(tag):
    raw = re.sub(r"^<script[^>]*>\n?|\n?</script>$", "", tag)
    return json.loads(raw)["@graph"]


class TestJsonLdDescription:
    def test_keeps_existing_description(self):
        ev = {"title": "Concierto X", "description": "Una gran actuación de jazz."}
        item = _items(_generate_json_ld([ev], "2026-07-10"))[0]
        assert item["description"] == "Una gran actuación de jazz."

    def test_adds_fallback_description_when_missing(self):
        # Google Search Console flags Events with no "description" field
        ev = {"title": "Ruta guiada por el río", "categories": ["visitas guiadas"],
              "location_name": "Legazpi"}
        item = _items(_generate_json_ld([ev], "2026-07-10"))[0]
        assert item.get("description")
        assert "Ruta guiada por el río" in item["description"]

    def test_every_event_has_description(self):
        evs = [
            {"title": "Sin desc"},
            {"title": "Con desc", "description": "Algo"},
            {"title": "Solo categoría", "categories": ["teatro"]},
        ]
        items = _items(_generate_json_ld(evs, "2026-07-10"))
        assert all(it.get("description") for it in items)
