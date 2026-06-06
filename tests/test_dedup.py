from crawlers.consolidate import dedup_cross_source, _content_tokens, _title_similarity


def test_content_tokens_drops_stopwords_accents_and_venue():
    toks = _content_tokens("Exposición: Madrid entre épocas")
    assert "entre" in toks and "epocas" in toks
    # venue words are excluded so they don't inflate similarity
    assert _content_tokens("Árboles de El Retiro", "Centro Ambiental El Retiro") == {"arboles"}


def test_similarity_merges_variants_but_not_different_activities():
    sim = _title_similarity
    # real duplicate: same concert, slightly different phrasing
    a = _content_tokens("Día de la Música: Quique Guinea Cuarteto")
    b = _content_tokens("Día Europeo de la Música: Quique Guinea Cuarteto")
    assert sim(a, b) >= 0.6
    # different activities at the same environmental centre -> below threshold
    c = _content_tokens("Árboles de El Retiro", "Centro Ambiental El Retiro")
    d = _content_tokens("Árboles exóticos", "Centro Ambiental El Retiro")
    assert sim(c, d) < 0.6


def _ev(title, lid, desc=None, source="x"):
    e = {"title": title, "lid": lid, "source": source, "categories": []}
    if desc:
        e["description"] = desc
    return e


def test_merge_similar_title_not_exact():
    events = {
        "a": _ev("Actividades lúdico deportivas en Parque de Roma", "L1"),
        "b": _ev("Actividades lúdico-deportivas en el Parque de Roma", "L1", desc="rica"),
    }
    calendar = {"2026-06-07": [{"event_id": "a"}, {"event_id": "b"}]}
    remap = dedup_cross_source(events, calendar, {"L1": {"location_name": "Parque Roma"}})
    assert len(remap) == 1 and len(events) == 1


def test_no_merge_similar_word_different_activity():
    # same venue + same date but different activities -> must NOT merge at 0.6
    events = {
        "a": _ev("Árboles de El Retiro", "L1"),
        "b": _ev("Árboles exóticos", "L1"),
    }
    calendar = {"2026-06-06": [{"event_id": "a"}, {"event_id": "b"}]}
    loc = {"L1": {"location_name": "Centro de Educación Ambiental El Retiro"}}
    remap = dedup_cross_source(events, calendar, loc)
    assert remap == {} and len(events) == 2


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
    events = {"a": _ev("Jazz en directo", "L1"), "b": _ev("Jazz en directo", "L1")}
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


def test_no_merge_when_discriminator_differs():
    # Same title + venue + date but the differing word is a level/age marker.
    cal = {"2026-06-06": [{"event_id": "a"}, {"event_id": "b"}]}
    pairs = [
        ("Curso de cómic para niños", "Curso de cómic avanzado para niños"),
        ("Ficción Sonora. Nivel Iniciación", "Ficción Sonora. Nivel Intermedio"),
        ("Campamento de Magia (9 y 10 años)", "Campamento de Magia (11 y 12 años)"),
    ]
    for t1, t2 in pairs:
        events = {"a": _ev(t1, "L1"), "b": _ev(t2, "L1")}
        remap = dedup_cross_source(events, dict(cal))
        assert remap == {}, f"should not merge: {t1!r} vs {t2!r}"
        assert len(events) == 2


def test_calendar_keeps_other_showings_after_merge():
    # Same event (same title/venue/date) listed twice -> merge; extra showing kept.
    events = {"a": _ev("Obra", "L1", desc="rich"), "b": _ev("Obra", "L1")}
    calendar = {
        "2026-06-06": [{"event_id": "a", "start_time": "18:00"},
                       {"event_id": "a", "start_time": "20:00"},
                       {"event_id": "b", "start_time": "20:00"}],
    }
    dedup_cross_source(events, calendar)
    times = sorted(e["start_time"] for e in calendar["2026-06-06"])
    assert times == ["18:00", "20:00"]
    assert {e["event_id"] for e in calendar["2026-06-06"]} == {"a"}
