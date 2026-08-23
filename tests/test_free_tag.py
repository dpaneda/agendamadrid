from crawlers.consolidate import _price_is_free, ensure_price_tags


def test_price_is_free_variants():
    assert _price_is_free("Gratis")
    assert _price_is_free("gratuito")
    assert _price_is_free("Entrada libre")
    assert _price_is_free("0 €")
    # contains the keyword -> considered free (same rule as the esmadrid scraper)
    assert _price_is_free("Gratuito para grupos, 5€ general")
    assert not _price_is_free("12 euros")
    assert not _price_is_free("")
    assert not _price_is_free(None)


def test_ensure_price_tags_adds_gratis():
    ev = {"title": "El gran azul", "price": "Gratis", "categories": ["exposiciones", "fotografía"]}
    ensure_price_tags(ev)
    assert "gratis" in ev["categories"]


def test_ensure_price_tags_keeps_existing_and_survives_llm_replace():
    # Simulates the LLM enrichment overwrite that dropped the scraper's tag
    ev = {"title": "Expo", "price": "Gratuito", "categories": ["exposiciones"]}
    ensure_price_tags(ev)
    assert ev["categories"] == ["exposiciones", "gratis"]

    already = {"title": "Expo", "price": "gratis", "categories": ["otros", "gratis"]}
    ensure_price_tags(already)
    assert already["categories"] == ["otros", "gratis"]

    paid = {"title": "Concierto", "price": "25 €", "categories": ["musica"]}
    ensure_price_tags(paid)
    assert "gratis" not in paid["categories"]
