"""Canonical category set. All crawlers must map to these."""

CATEGORIES = {
    "teatro",
    "conciertos",
    "cine",
    "exposiciones",
    "talleres",
    "conferencias",
    "deportes",
    "ferias",
    "otros",
}

# Modifier tags (combinable with categories above)
TAGS = {
    "gratis",
    "aire libre",
    "destacado",
    "accesible",
    "infantil",
    "visitas guiadas",
    "danza",
    "circo",
    "ópera",
    "monólogos",
}

ALL_VALID = CATEGORIES | TAGS

# Migration map: old category -> new category
MIGRATION = {
    "musica": "conciertos",
    "fotografia": "exposiciones",
    "gastronomia": "gastronomía",
    "mercados": "ferias",
    "fiestas": "ferias",
    "gastronomía": "ferias",
    "gastronomia": "ferias",
    "literatura": "ferias",
}


def normalize(raw_categories: list[str]) -> list[str]:
    """Filter to only valid categories/tags, deduplicated. Migrates old names."""
    result = []
    for c in raw_categories:
        c = MIGRATION.get(c, c)
        if c in ALL_VALID:
            result.append(c)
    return list(dict.fromkeys(result))
