"""Tests for build_data calendar/event generation."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import datetime, timezone

from crawlers.consolidate import (
    cal_entries_for_date,
    make_event_id,
    richness,
    merge_event,
    calendar_window,
    classify_format,
    _duration_days,
)


class TestDurationDays:
    def test_single_day(self):
        assert _duration_days("2026-07-01", "2026-07-01") == 1

    def test_inclusive_span(self):
        assert _duration_days("2026-07-01", "2026-07-21") == 21

    def test_missing_end_is_one_day(self):
        assert _duration_days("2026-07-01", None) == 1

    def test_unparseable_is_one_day(self):
        assert _duration_days(None, None) == 1
        assert _duration_days("nope", "nope") == 1


class TestClassifyFormat:
    def test_festival_by_flag(self):
        assert classify_format({"is_multi_event": True, "title": "Cosa"}, 1) == "festival"

    def test_festival_by_title_keyword(self):
        assert classify_format({"title": "Festival de Otoño"}, 1) == "festival"
        assert classify_format({"title": "Ciclo de conciertos"}, 1) == "festival"
        assert classify_format({"title": "Semana de la Ciencia"}, 1) == "festival"

    def test_exposicion_at_threshold(self):
        assert classify_format({"title": "Retrato"}, 21) == "exposicion"

    def test_puntual_below_threshold(self):
        assert classify_format({"title": "Retrato"}, 20) == "puntual"

    def test_puntual_single_day(self):
        assert classify_format({"title": "Concierto"}, 1) == "puntual"

    def test_festival_takes_precedence_over_duration(self):
        assert classify_format({"is_multi_event": True, "title": "X"}, 90) == "festival"


class TestCalendarWindow:
    """The retention window keeps 7 days of past events so recently-expired
    favourites/marks stay visible, plus 30 days ahead."""

    def test_window_bounds(self):
        now = datetime(2026, 7, 5, tzinfo=timezone.utc)
        min_date, max_date = calendar_window(now)
        assert min_date == "2026-06-28"  # 7 days before
        assert max_date == "2026-08-04"  # 30 days after

    def test_window_crosses_month_boundary(self):
        now = datetime(2026, 3, 3, tzinfo=timezone.utc)
        min_date, _ = calendar_window(now)
        assert min_date == "2026-02-24"


class TestCalEntriesForDate:
    """Tests for cal_entries_for_date()."""

    def test_no_schedule_with_times(self):
        ev = {"start_time": "19:00:00", "end_time": "21:00:00"}
        entries = cal_entries_for_date(ev, "abc", "2026-03-24")
        assert len(entries) == 1
        assert entries[0] == {"event_id": "abc", "start_time": "19:00:00", "end_time": "21:00:00"}

    def test_no_schedule_no_times(self):
        ev = {}
        entries = cal_entries_for_date(ev, "abc", "2026-03-24")
        assert len(entries) == 1
        assert entries[0] == {"event_id": "abc"}

    def test_schedule_matching_day(self):
        # 2026-03-24 is Tuesday (weekday=1)
        ev = {"schedule": {1: ["10:00:00", "14:00:00"]}}
        entries = cal_entries_for_date(ev, "abc", "2026-03-24")
        assert len(entries) == 1
        assert entries[0]["start_time"] == "10:00:00"
        assert entries[0]["end_time"] == "14:00:00"

    def test_schedule_wrong_day_skips(self):
        # 2026-03-24 is Tuesday (weekday=1), schedule only has Saturday (5)
        ev = {"schedule": {5: ["12:00:00"]}}
        entries = cal_entries_for_date(ev, "abc", "2026-03-24")
        assert entries == []

    def test_schedule_string_keys(self):
        # After JSON round-trip, keys become strings
        ev = {"schedule": {"1": ["10:00:00", "14:00:00"]}}
        entries = cal_entries_for_date(ev, "abc", "2026-03-24")
        assert len(entries) == 1
        assert entries[0]["start_time"] == "10:00:00"

    def test_schedule_string_keys_wrong_day_skips(self):
        ev = {"schedule": {"5": ["12:00:00"]}}
        entries = cal_entries_for_date(ev, "abc", "2026-03-24")
        assert entries == []

    def test_schedule_day_with_empty_times_uses_generic(self):
        # Day is in schedule but no specific times — use start_time from event
        ev = {"schedule": {1: []}, "start_time": "17:00:00"}
        entries = cal_entries_for_date(ev, "abc", "2026-03-24")
        assert len(entries) == 1
        assert entries[0]["start_time"] == "17:00:00"

    def test_schedule_day_with_empty_times_no_generic(self):
        ev = {"schedule": {1: []}}
        entries = cal_entries_for_date(ev, "abc", "2026-03-24")
        assert len(entries) == 1
        assert entries[0] == {"event_id": "abc"}

    def test_times_are_sorted_before_pairing(self):
        ev = {"schedule": {1: ["20:00:00", "10:00:00", "16:00:00"]}}
        entries = cal_entries_for_date(ev, "abc", "2026-03-24")
        assert entries[0]["start_time"] == "10:00:00"
        assert entries[0]["end_time"] == "16:00:00"
        assert entries[1]["start_time"] == "20:00:00"

    def test_multiple_time_pairs(self):
        ev = {"schedule": {1: ["10:00:00", "14:00:00", "17:00:00", "21:00:00"]}}
        entries = cal_entries_for_date(ev, "abc", "2026-03-24")
        assert len(entries) == 2
        assert entries[0] == {"event_id": "abc", "start_time": "10:00:00", "end_time": "14:00:00"}
        assert entries[1] == {"event_id": "abc", "start_time": "17:00:00", "end_time": "21:00:00"}

    def test_invalid_date_string(self):
        ev = {"start_time": "10:00:00"}
        entries = cal_entries_for_date(ev, "abc", "not-a-date")
        assert len(entries) == 1
        assert entries[0]["start_time"] == "10:00:00"


class TestMakeEventId:
    def test_stable_id(self):
        assert make_event_id("Test Event") == make_event_id("Test Event")

    def test_case_insensitive(self):
        assert make_event_id("Test Event") == make_event_id("test event")

    def test_strips_whitespace(self):
        assert make_event_id("  Test Event  ") == make_event_id("Test Event")

    def test_different_titles_different_ids(self):
        assert make_event_id("Event A") != make_event_id("Event B")

    def test_id_is_16_chars(self):
        assert len(make_event_id("Test")) == 16


class TestRichness:
    def test_empty_event(self):
        assert richness({}) == 0

    def test_full_event(self):
        ev = {f: "x" for f in ["description", "start_time", "end_time", "location_name",
                                "address", "latitude", "longitude", "url", "district", "image"]}
        assert richness(ev) == 10

    def test_partial_event(self):
        assert richness({"description": "x", "url": "http://..."}) == 2


class TestMergeEvent:
    def test_keeps_richer_record(self):
        existing = {"title": "A", "description": "old", "url": "http://old"}
        new = {"title": "A", "description": "new", "url": "http://new", "image": "img.png"}
        merged = merge_event(existing, new)
        assert merged["image"] == "img.png"

    def test_merges_categories(self):
        existing = {"categories": ["musica"]}
        new = {"categories": ["teatro"]}
        merged = merge_event(existing, new)
        assert merged["categories"] == ["musica", "teatro"]

    def test_deduplicates_categories(self):
        existing = {"categories": ["musica", "gratis"]}
        new = {"categories": ["musica", "teatro"]}
        merged = merge_event(existing, new)
        assert merged["categories"] == ["musica", "gratis", "teatro"]

    def test_merges_sources(self):
        existing = {"source": "esmadrid"}
        new = {"source": "madrid_agenda"}
        merged = merge_event(existing, new)
        assert merged["source"] == "esmadrid,madrid_agenda"

    def test_keeps_richer_schedule(self):
        existing = {"schedule": {0: ["10:00:00", "14:00:00"], 1: ["10:00:00", "14:00:00"]}}
        new = {"schedule": {5: ["12:00:00"]}}
        merged = merge_event(existing, new)
        assert len(merged["schedule"]) == 2  # keeps existing with more days

    def test_takes_new_schedule_when_richer(self):
        existing = {"schedule": {5: ["12:00:00"]}}
        new = {"schedule": {0: ["10:00:00", "14:00:00"], 1: ["10:00:00", "14:00:00"]}}
        merged = merge_event(existing, new)
        assert len(merged["schedule"]) == 2  # takes new
