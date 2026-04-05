"""Tests for madrid_datos parser."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.sources.madrid_datos import parse_madrid_event


def _make_item(**overrides):
    base = {
        "title": "Test Event",
        "dtstart": "2026-03-24 00:00:00.0",
        "dtend": "2026-03-24 23:59:00.0",
        "time": "",
        "event-location": "Sala Test",
        "address": {"area": {"street-address": "Calle Test 1"}, "district": {"@id": "/distritos/1"}},
        "location": {"latitude": 40.4168, "longitude": -3.7038},
        "link": "http://example.com",
        "description": "A test event",
        "@type": "Musica",
        "free": 0,
    }
    base.update(overrides)
    return base


class TestParseTime:
    def test_parses_time_field(self):
        item = _make_item(time="17:00")
        ev = parse_madrid_event(item, "test")
        assert ev["start_time"] == "17:00:00"

    def test_parses_time_range(self):
        item = _make_item(time="De 10:00 a 14:00")
        ev = parse_madrid_event(item, "test")
        assert ev["start_time"] == "10:00:00"
        assert ev["end_time"] == "14:00:00"

    def test_no_time_field(self):
        item = _make_item(time="")
        ev = parse_madrid_event(item, "test")
        assert ev["start_time"] is None
        assert ev["end_time"] is None

    def test_dot_separator(self):
        item = _make_item(time="18.30")
        ev = parse_madrid_event(item, "test")
        assert ev["start_time"] == "18:30:00"


class TestRecurrenceSchedule:
    def test_builds_schedule_from_recurrence(self):
        item = _make_item(
            time="17:00",
            recurrence={"days": "TU,WE,TH,FR", "frequency": "WEEKLY", "interval": 1},
        )
        ev = parse_madrid_event(item, "test")
        assert ev["schedule"] is not None
        assert set(ev["schedule"].keys()) == {1, 2, 3, 4}
        assert ev["schedule"][1] == ["17:00:00"]

    def test_recurrence_with_time_range(self):
        item = _make_item(
            time="De 10:00 a 22:00",
            recurrence={"days": "MO,TU,WE,TH,FR,SA,SU"},
        )
        ev = parse_madrid_event(item, "test")
        assert ev["schedule"][0] == ["10:00:00", "22:00:00"]

    def test_recurrence_without_time(self):
        item = _make_item(
            time="",
            recurrence={"days": "SA,SU"},
        )
        ev = parse_madrid_event(item, "test")
        assert ev["schedule"] is not None
        assert set(ev["schedule"].keys()) == {5, 6}
        assert ev["schedule"][5] == []

    def test_no_recurrence(self):
        item = _make_item(time="17:00")
        ev = parse_madrid_event(item, "test")
        assert ev["schedule"] is None

    def test_empty_recurrence_days(self):
        item = _make_item(recurrence={"days": ""})
        ev = parse_madrid_event(item, "test")
        assert ev["schedule"] is None


class TestBasicParsing:
    def test_extracts_title(self):
        ev = parse_madrid_event(_make_item(), "test")
        assert ev["title"] == "Test Event"

    def test_extracts_date(self):
        ev = parse_madrid_event(_make_item(), "test")
        assert ev["start_date"] == "2026-03-24"

    def test_missing_title_returns_none(self):
        assert parse_madrid_event(_make_item(title=""), "test") is None

    def test_missing_dtstart_returns_none(self):
        assert parse_madrid_event(_make_item(dtstart=""), "test") is None

    def test_zero_coords_become_none(self):
        item = _make_item(location={"latitude": 0, "longitude": 0})
        ev = parse_madrid_event(item, "test")
        assert ev["latitude"] is None
        assert ev["longitude"] is None

    def test_free_event(self):
        ev = parse_madrid_event(_make_item(free=1), "test")
        assert "gratis" in ev["categories"]

    def test_category_mapping(self):
        ev = parse_madrid_event(_make_item(**{"@type": "TeatroPerformance"}), "test")
        assert "teatro" in ev["categories"]

    def test_description_truncation(self):
        ev = parse_madrid_event(_make_item(description="x" * 500), "test")
        assert len(ev["description"]) <= 300

    def test_html_stripped_from_description(self):
        ev = parse_madrid_event(_make_item(description="<p>Hello</p> <b>world</b>"), "test")
        assert "<" not in ev["description"]
