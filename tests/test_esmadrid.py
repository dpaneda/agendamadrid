"""Tests for esmadrid schedule/time parsing."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from crawlers.sources.esmadrid import _parse_schedule, _days_from_line, _parse_open_days


class TestDaysFromLine:
    def test_single_day(self):
        assert _days_from_line("Sábados") == {5}

    def test_day_range(self):
        assert _days_from_line("Martes a viernes") == {1, 2, 3, 4}

    def test_all_days(self):
        assert _days_from_line("Todos los días") == set(range(7))

    def test_multiple_days(self):
        days = _days_from_line("Sábados y domingos")
        assert 5 in days
        assert 6 in days

    def test_no_days(self):
        assert _days_from_line("Apertura de puertas: 20:00") == set()

    def test_wrap_around_range(self):
        # "viernes a domingo" should give {4, 5, 6}
        assert _days_from_line("Viernes a domingo") == {4, 5, 6}


class TestParseSchedule:
    def test_simple_schedule(self):
        text = "Martes a viernes: 10:00 - 21:00"
        sched = _parse_schedule(text)
        assert sched is not None
        for day in [1, 2, 3, 4]:
            assert day in sched
            assert "10:00:00" in sched[day]
            assert "21:00:00" in sched[day]

    def test_multiple_lines(self):
        text = "Lunes a viernes: 10:00 - 14:00\nSábados y domingos: 11:00 - 15:00"
        sched = _parse_schedule(text)
        assert sched[0] == ["10:00:00", "14:00:00"]  # Monday
        assert sched[5] == ["11:00:00", "15:00:00"]  # Saturday

    def test_times_are_sorted(self):
        text = "Sábados: 20:00, 18:00, 10:00"
        sched = _parse_schedule(text)
        assert sched[5] == ["10:00:00", "18:00:00", "20:00:00"]

    def test_no_duplicate_times(self):
        text = "Lunes: 10:00\nLunes a viernes: 10:00 - 14:00"
        sched = _parse_schedule(text)
        assert sched[0].count("10:00:00") == 1

    def test_empty_text(self):
        assert _parse_schedule("") is None
        assert _parse_schedule(None) is None

    def test_no_times_in_text(self):
        assert _parse_schedule("Todos los días") is None

    def test_no_days_returns_none(self):
        # Times without day names → no schedule
        assert _parse_schedule("Apertura: 20:00 h") is None

    def test_dot_separator(self):
        sched = _parse_schedule("Sábados: 18.30")
        assert sched[5] == ["18:30:00"]


class TestParseOpenDays:
    def test_from_schedule(self):
        days = _parse_open_days("Martes a viernes: 10:00 - 14:00")
        assert days == {1, 2, 3, 4}

    def test_fallback_day_names(self):
        days = _parse_open_days("Solo los sábados y domingos")
        assert 5 in days
        assert 6 in days

    def test_empty(self):
        assert _parse_open_days("") is None
        assert _parse_open_days(None) is None
