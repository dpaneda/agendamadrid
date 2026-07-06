"""Tests for madrid_agenda occurrence grouping."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.sources.madrid_agenda import collapse_occurrences


class TestCollapseOccurrences:
    def test_multi_occurrence_collects_discrete_dates(self):
        # datos.madrid.es lists a recurring activity as multiple single-day items
        evs = [
            {"title": "Itinerario Ornitológico", "start_date": "2026-07-04", "end_date": "2026-07-04"},
            {"title": "Itinerario Ornitológico", "start_date": "2026-08-01", "end_date": "2026-08-01"},
            {"title": "Itinerario Ornitológico", "start_date": "2026-09-05", "end_date": "2026-09-05"},
        ]
        out = collapse_occurrences(evs)
        assert len(out) == 1
        assert out[0]["dates"] == ["2026-07-04", "2026-08-01", "2026-09-05"]
        assert out[0]["start_date"] == "2026-07-04"
        assert out[0]["end_date"] == "2026-09-05"

    def test_single_occurrence_has_no_dates_field(self):
        out = collapse_occurrences([
            {"title": "Concierto", "start_date": "2026-07-05", "end_date": "2026-07-05"},
        ])
        assert len(out) == 1
        assert "dates" not in out[0]

    def test_range_event_kept_as_range(self):
        out = collapse_occurrences([
            {"title": "Exposición larga", "start_date": "2026-04-01", "end_date": "2026-09-01"},
        ])
        assert "dates" not in out[0]
        assert out[0]["start_date"] == "2026-04-01"
        assert out[0]["end_date"] == "2026-09-01"

    def test_dedup_repeated_date(self):
        evs = [
            {"title": "X", "start_date": "2026-07-04", "end_date": "2026-07-04"},
            {"title": "X", "start_date": "2026-07-04", "end_date": "2026-07-04"},
            {"title": "X", "start_date": "2026-07-10", "end_date": "2026-07-10"},
        ]
        out = collapse_occurrences(evs)
        assert out[0]["dates"] == ["2026-07-04", "2026-07-10"]
