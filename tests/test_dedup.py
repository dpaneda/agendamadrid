from crawlers.consolidate import dedup_cross_source, dedup_title_key


def test_dedup_title_key_strips_prefix_and_accents():
    assert dedup_title_key("Exposición: Madrid entre épocas") == "madrid entre epocas"
    assert dedup_title_key("Madrid entre épocas") == "madrid entre epocas"
    assert dedup_title_key("Teatro: Algunas veces ganas") == "algunas veces ganas"


def _ev(title, lid, desc=None, source="x"):
    e = {"title": title, "lid": lid, "source": source, "categories": []}
    if desc:
        e["description"] = desc
    return e


def test_merge_same_title_venue_overlapping_date():
    events = {
        "a": _ev("Echo", "L1", source="esmadrid"),
        "b": _ev("Echo", "L1", desc="rich description", source="madrid_agenda"),
    }
    calendar = {
        "2026-06-06": [{"event_id": "a", "start_time": "20:00"},
                       {"event_id": "b", "start_time": "20:00"}],
    }
    remap = dedup_cross_source(events, calendar)
    assert len(remap) == 1
    assert len(events) == 1
    (canon,) = events
    # richest (b, has description) wins as canonical
    assert canon == "b"
    # sources combined
    assert set(events["b"]["source"].split(",")) == {"esmadrid", "madrid_agenda"}
    # calendar collapsed to a single entry on the canonical id
    assert [e["event_id"] for e in calendar["2026-06-06"]] == ["b"]


def test_no_merge_different_venue():
    events = {"a": _ev("Gira", "L1"), "b": _ev("Gira", "L2")}
    calendar = {"2026-06-27": [{"event_id": "a"}, {"event_id": "b"}]}
    remap = dedup_cross_source(events, calendar)
    assert remap == {}
    assert len(events) == 2


def test_no_merge_when_dates_dont_overlap():
    events = {"a": _ev("Taller", "L1"), "b": _ev("Taller", "L1")}
    calendar = {
        "2026-06-15": [{"event_id": "a"}],
        "2026-06-16": [{"event_id": "b"}],
    }
    remap = dedup_cross_source(events, calendar)
    assert remap == {}
    assert len(events) == 2


def test_no_merge_without_lid():
    events = {"a": _ev("Sin sitio", None), "b": _ev("Sin sitio", None)}
    calendar = {"2026-06-06": [{"event_id": "a"}, {"event_id": "b"}]}
    remap = dedup_cross_source(events, calendar)
    assert remap == {}
    assert len(events) == 2


def test_calendar_keeps_distinct_times_after_merge():
    events = {
        "a": _ev("Obra", "L1"),
        "b": _ev("Obra", "L1", desc="rich"),
    }
    calendar = {
        "2026-06-06": [{"event_id": "a", "start_time": "18:00"},
                       {"event_id": "b", "start_time": "20:00"}],
    }
    dedup_cross_source(events, calendar)
    # two different showings on the same day -> both kept, remapped to canonical
    times = sorted(e["start_time"] for e in calendar["2026-06-06"])
    assert times == ["18:00", "20:00"]
    assert {e["event_id"] for e in calendar["2026-06-06"]} == {"b"}
