"""Tests for LLM enrichment plumbing (no network / no real LLM)."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import crawlers.llm_enrich as le


def test_enrich_batch_passes_through_is_multi_event(monkeypatch):
    fake = (
        '[{"title":"Veranos de la Villa","description":"x","categories":["conciertos"],'
        '"price":null,"is_multi_event":true},'
        '{"title":"John Legend","description":"y","categories":["conciertos"],'
        '"price":"30 €","is_multi_event":false}]'
    )
    monkeypatch.setattr(le, "_llm_call", lambda prompt: fake)
    out = le.enrich_batch([{"title": "a"}, {"title": "b"}])
    assert out is not None and len(out) == 2
    assert out[0]["is_multi_event"] is True
    assert out[1]["is_multi_event"] is False


def test_enrich_batch_length_mismatch_returns_none(monkeypatch):
    monkeypatch.setattr(le, "_llm_call", lambda prompt: '[{"title":"only one"}]')
    assert le.enrich_batch([{"title": "a"}, {"title": "b"}]) is None
