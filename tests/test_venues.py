from crawlers.venues import canonicalize, venue_key, building_display


def _v(name, count, lat=None, lng=None):
    rec = {"location_name": name}
    if lat is not None:
        rec["latitude"], rec["longitude"] = lat, lng
    return name, {"rec": rec, "count": count}


def test_venue_key_strips_district_room_and_accents():
    assert venue_key("Centro Cultural el Torito (Moratalaz)") == "centro cultural el torito"
    assert venue_key("Teatro Lara - Sala Lola Membrives") == "teatro lara"
    assert venue_key("Centro de Cultura Contemporánea CondeDuque") == "centro de cultura contemporanea condeduque"


def test_building_display_strips_room():
    assert building_display("Teatro Lara - Sala Cándido Lara") == "Teatro Lara"
    assert building_display("Conde Duque") == "Conde Duque"


def test_name_variant_and_nearby_coords_merge():
    venues = dict([
        _v("Centro de Cultura Contemporánea Conde Duque", 10, 40.42739911, -3.71058928),
        _v("Conde Duque", 7, 40.427887, -3.710802),
    ])
    name_to_lid, locations = canonicalize(venues)
    # both map to the same canonical location
    assert name_to_lid["Conde Duque"] == name_to_lid["Centro de Cultura Contemporánea Conde Duque"]
    assert len(locations) == 1
    # canonical name = the variant with the most events
    (loc,) = locations.values()
    assert loc["location_name"] == "Centro de Cultura Contemporánea Conde Duque"


def test_rooms_merge_to_building():
    venues = dict([
        _v("Teatro Lara - Sala Lola Membrives", 5, 40.4220989, -3.7044511),
        _v("Teatro Lara - Sala Cándido Lara", 4, 40.4220989, -3.7044511),
    ])
    name_to_lid, locations = canonicalize(venues)
    assert len(set(name_to_lid.values())) == 1
    (loc,) = locations.values()
    assert loc["location_name"] == "Teatro Lara"


def test_same_name_far_apart_not_merged_by_coords_but_only_by_key():
    # Same touring show at two distant centres -> different names -> stay separate
    venues = dict([
        _v("Centro Cultural Lope de Vega (Puente de Vallecas)", 1, 40.3862, -3.6718),
        _v("Centro Sociocultural Alfonso XII (Fuencarral - El Pardo)", 1, 40.5196, -3.7779),
    ])
    name_to_lid, locations = canonicalize(venues)
    assert len(set(name_to_lid.values())) == 2
    assert len(locations) == 2


def test_shared_token_but_far_apart_not_merged():
    venues = dict([
        _v("Biblioteca Pública Eugenio Trías", 3, 40.4166, -3.6795),
        _v("Biblioteca Pública José Saramago", 2, 40.4786, -3.7094),
    ])
    name_to_lid, _ = canonicalize(venues)
    assert len(set(name_to_lid.values())) == 2


def test_varios_espacios_excluded():
    venues = dict([
        _v("Varios espacios", 2, 40.42, -3.68),
        _v("Varios espacios (Comunidad de Madrid)", 1),
    ])
    name_to_lid, locations = canonicalize(venues)
    assert name_to_lid["Varios espacios"] is None
    assert name_to_lid["Varios espacios (Comunidad de Madrid)"] is None
    assert locations == {}
