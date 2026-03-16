"""Canonical category set. All crawlers must map to these."""

CATEGORIES = {
    "musica",
    "teatro",
    "danza",
    "cine",
    "exposiciones",
    "conferencias",
    "talleres",
    "infantil",
    "deportes",
    "fiestas",
    "visitas guiadas",
    "circo",
    "literatura",
    "fotografia",
    "mercados",
    "gastronomia",
    "otros",
}

# Modifier tags (combinable with categories above)
TAGS = {
    "gratis",
    "aire libre",
    "destacado",
    "accesible",
}

ALL_VALID = CATEGORIES | TAGS


def normalize(raw_categories: list[str]) -> list[str]:
    """Filter to only valid categories/tags, deduplicated."""
    return list(dict.fromkeys(c for c in raw_categories if c in ALL_VALID))
