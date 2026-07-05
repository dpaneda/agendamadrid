# Segmentación de eventos por formato — Plan de implementación (Fase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clasificar cada evento como `puntual` / `exposicion` / `festival` en el backend y permitir filtrar por ese formato con 3 chips excluyentes en la vista de lista.

**Architecture:** El backend (`consolidate.py`) calcula un campo `formato` determinista por evento y lo escribe en `events.json`. El frontend (`app.js`) añade un estado de filtro `activeFormato` y 3 chips en el panel de filtros, siguiendo el patrón de los chips de categoría existentes.

**Tech Stack:** Python 3.12 + pytest (backend), JS vanilla (frontend), Playwright para verificación en navegador.

Spec: `docs/superpowers/specs/2026-07-05-event-formato-segmentation-design.md`

---

## Task 1: Backend — función pura `classify_format` + `_duration_days`

**Files:**
- Modify: `crawlers/consolidate.py` (añadir funciones tras `calendar_window`, ~línea 52)
- Test: `tests/test_build_data.py`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir en `tests/test_build_data.py`. Actualizar la import existente para incluir las dos funciones nuevas y añadir la clase de tests:

```python
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
        # multievento largo -> festival, no exposicion
        assert classify_format({"is_multi_event": True, "title": "X"}, 90) == "festival"
```

- [ ] **Step 2: Ejecutar los tests para verificar que fallan**

Run: `python -m pytest tests/test_build_data.py::TestClassifyFormat tests/test_build_data.py::TestDurationDays -q`
Expected: FAIL con `ImportError: cannot import name 'classify_format'`.

- [ ] **Step 3: Implementar las funciones**

En `crawlers/consolidate.py`, justo después de la función `calendar_window` (~línea 52), añadir:

```python
EXPO_MIN_DAYS = 21
_FESTIVAL_RE = re.compile(r"\b(festival|ciclo|temporada|semana de)\b", re.IGNORECASE)


def _duration_days(start_date, end_date):
    """Días que dura el evento (inclusive); 1 si faltan/no parsean las fechas."""
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date or start_date, "%Y-%m-%d")
    except (ValueError, TypeError):
        return 1
    return max(1, (end - start).days + 1)


def classify_format(event, duration_days):
    """Bucket de formato: 'festival', 'exposicion' o 'puntual' (excluyente, por prioridad)."""
    if event.get("is_multi_event") or _FESTIVAL_RE.search(event.get("title") or ""):
        return "festival"
    if duration_days >= EXPO_MIN_DAYS:
        return "exposicion"
    return "puntual"
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `python -m pytest tests/test_build_data.py::TestClassifyFormat tests/test_build_data.py::TestDurationDays -q`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add crawlers/consolidate.py tests/test_build_data.py
git commit -m "Backend: classify_format (puntual/exposicion/festival)"
```

---

## Task 2: Backend — calcular y escribir `formato` en `events.json`

**Files:**
- Modify: `crawlers/consolidate.py` (en `main()`, tras la poda de eventos, ~línea 403)

- [ ] **Step 1: Añadir el cálculo de `formato` tras la poda**

En `crawlers/consolidate.py`, localizar el bloque de poda que termina en:

```python
    events = {eid: ev for eid, ev in events.items() if eid in live_ids}
    print(f"Pruned {dropped} events without calendar entries (kept {len(events)})")
```

Justo debajo de ese `print`, añadir:

```python
    # Classify format (puntual / exposicion / festival) from real dates + flags
    formatos = {}
    for eid, ev in events.items():
        raw = raw_events.get(eid, {})
        ev["formato"] = classify_format(
            ev, _duration_days(raw.get("start_date"), raw.get("end_date"))
        )
        formatos[ev["formato"]] = formatos.get(ev["formato"], 0) + 1
    print(f"Formato: {formatos}")
```

- [ ] **Step 2: Ejecutar consolidate y verificar la distribución**

Run: `python -m crawlers.consolidate 2>&1 | grep Formato`
Expected: una línea tipo `Formato: {'puntual': N1, 'exposicion': N2, 'festival': N3}` con los tres buckets presentes y N1+N2+N3 = total de eventos.

- [ ] **Step 3: Verificar que el campo está en events.json**

Run:
```bash
python3 -c "import json;e=json.load(open('frontend/data/events.json'));import collections;print(collections.Counter(v.get('formato') for v in e.values()));print('sin formato:',sum(1 for v in e.values() if 'formato' not in v))"
```
Expected: `Counter({...})` con los 3 valores y `sin formato: 0`.

- [ ] **Step 4: Restaurar los datos regenerados (los produce el CI, no van en el commit de código)**

Run:
```bash
git checkout -- frontend/data frontend/index.html frontend/sitemap.xml frontend/robots.txt 2>/dev/null; git checkout -- $(git diff --name-only | grep -E 'frontend/2026-') 2>/dev/null; git status --short | grep -v a11y-check
```
Expected: solo `crawlers/consolidate.py` modificado (los datos restaurados).

- [ ] **Step 5: Commit**

```bash
git add crawlers/consolidate.py
git commit -m "Backend: escribir formato en events.json"
```

---

## Task 3: Frontend — estado `activeFormato` + filtrado

**Files:**
- Modify: `frontend/app.js` (declaración de estado ~línea 396; `_applyListFilters` ~línea 948)

- [ ] **Step 1: Declarar el estado `activeFormato`**

En `frontend/app.js`, tras la línea `let activeCatFilter = [];` (~396), añadir:

```javascript
let activeFormato = sessionStorage.getItem("activeFormato") || "";
```

- [ ] **Step 2: Añadir el filtro en `_applyListFilters`**

En `_applyListFilters`, tras el bloque de `activeSource`:

```javascript
  if (activeSource) {
    events = events.filter(ev => (ev.source || "").split(",").includes(activeSource));
  }
```

añadir inmediatamente después:

```javascript
  if (activeFormato) {
    events = events.filter(ev => ev.formato === activeFormato);
  }
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check frontend/app.js`
Expected: sin salida (OK).

- [ ] **Step 4: Commit**

```bash
git add frontend/app.js
git commit -m "Frontend: estado y filtro activeFormato"
```

---

## Task 4: Frontend — chips de formato, tag activo y limpieza

**Files:**
- Modify: `frontend/app.js` (`renderFilterPanelContent`, `renderActiveFilters`, `clearActiveFilters`, `updateFilterBadge`, nueva función `toggleFormato`)

- [ ] **Step 1: Definir las etiquetas de formato**

En `frontend/app.js`, justo antes de `function renderFilterPanelContent(panel) {`, añadir:

```javascript
const FORMATO_LABELS = {
  puntual: "🎯 Puntual",
  exposicion: "🖼 Exposiciones",
  festival: "🎪 Festivales",
};
```

- [ ] **Step 2: Añadir la sección "Formato" al panel de filtros**

En `renderFilterPanelContent`, sustituir la asignación `panel.innerHTML = \`...\`;` para incluir una sección de formato al principio. La versión actual empieza así:

```javascript
  const hasFilters = activeCatFilter.length + activeTagFilter.length > 0;
  panel.innerHTML = `
    <div class="filter-panel-section">
      <div class="filter-panel-label">Categorías principales</div>
      <div class="filter-chips">${chips(mainCats, activeCatFilter, "toggleActiveCat")}</div>
    </div>
```

Reemplazarla por:

```javascript
  const hasFilters = activeCatFilter.length + activeTagFilter.length + (activeFormato ? 1 : 0) > 0;
  const formatoChips = Object.entries(FORMATO_LABELS).map(([val, label]) =>
    `<button class="filter-chip${activeFormato === val ? " active" : ""}" onclick="toggleFormato('${val}')">${label}</button>`
  ).join("");
  panel.innerHTML = `
    <div class="filter-panel-section">
      <div class="filter-panel-label">Formato</div>
      <div class="filter-chips">${formatoChips}</div>
    </div>
    <div class="filter-panel-section">
      <div class="filter-panel-label">Categorías principales</div>
      <div class="filter-chips">${chips(mainCats, activeCatFilter, "toggleActiveCat")}</div>
    </div>
```

(El resto del template literal —Subcategorías y botón Limpiar— queda igual.)

- [ ] **Step 3: Añadir la función `toggleFormato`**

En `frontend/app.js`, justo antes de `function toggleActiveCat(cat) {`, añadir:

```javascript
function toggleFormato(val) {
  activeFormato = activeFormato === val ? "" : val;
  if (activeFormato) sessionStorage.setItem("activeFormato", activeFormato);
  else sessionStorage.removeItem("activeFormato");
  renderActiveFilters();
  render();
  const panel = document.getElementById("filter-panel");
  if (panel) renderFilterPanelContent(panel);
}
```

- [ ] **Step 4: Mostrar el formato activo como tag eliminable**

En `renderActiveFilters`, tras el bloque `if (activeLocation) { ... }`, añadir:

```javascript
  if (activeFormato) {
    parts.push(`<span class="tag tag-active" role="button" tabindex="0" onclick="toggleFormato('${activeFormato}')">${FORMATO_LABELS[activeFormato]} ✕</span>`);
  }
```

- [ ] **Step 5: Incluir formato en el badge y en "Limpiar filtros"**

En `updateFilterBadge`, reemplazar:

```javascript
  const count = activeCatFilter.length + activeTagFilter.length;
```

por:

```javascript
  const count = activeCatFilter.length + activeTagFilter.length + (activeFormato ? 1 : 0);
```

En `clearActiveFilters`, tras `activeTagFilter = [];`, añadir:

```javascript
  activeFormato = "";
  sessionStorage.removeItem("activeFormato");
```

- [ ] **Step 6: Verificar sintaxis**

Run: `node --check frontend/app.js`
Expected: sin salida (OK).

- [ ] **Step 7: Commit**

```bash
git add frontend/app.js
git commit -m "Frontend: chips de formato en el panel de filtros"
```

---

## Task 5: Verificación end-to-end en navegador

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Regenerar datos con formato (temporal) y levantar servidor**

Run:
```bash
python -m crawlers.consolidate >/dev/null 2>&1
cd frontend && python -m http.server 8199 >/tmp/httpd.log 2>&1 &
sleep 1; curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8199/index.html
```
Expected: `HTTP 200`.

- [ ] **Step 2: Verificar el filtrado por formato con Playwright**

Navegar a `http://localhost:8199/index.html` y evaluar:

```javascript
() => {
  activeSource = ""; activeLocation = ""; activeSearch = ""; activeUserFilter = "";
  const day = _getDayEvents("2026-07-06");
  const total = _applyListFilters(day).length;
  activeFormato = "exposicion";
  const expos = _applyListFilters(_getDayEvents("2026-07-06"));
  const onlyExpos = expos.every(e => e.formato === "exposicion");
  activeFormato = "festival";
  const fest = _applyListFilters(_getDayEvents("2026-07-06"));
  const onlyFest = fest.every(e => e.formato === "festival");
  activeFormato = "";
  return { total, exposCount: expos.length, onlyExpos, festCount: fest.length, onlyFest };
}
```
Expected: `onlyExpos: true`, `onlyFest: true`, y `exposCount` + `festCount` menores que `total` (el filtro reduce la lista y es excluyente).

- [ ] **Step 3: Parar servidor y restaurar datos**

Run:
```bash
pkill -f "http.server 8199"
git checkout -- frontend/data frontend/index.html frontend/sitemap.xml frontend/robots.txt 2>/dev/null
git checkout -- $(git diff --name-only | grep -E 'frontend/2026-') 2>/dev/null
git status --short | grep -v a11y-check
```
Expected: sin cambios de datos pendientes (solo lo ya commiteado).

- [ ] **Step 4: Suite completa y lint**

Run: `python -m pytest tests/ -q && .venv/bin/ruff check crawlers/ tests/`
Expected: todos los tests PASS, `All checks passed!`.

---

## Notas de despliegue

- El campo `formato` aparecerá en la web cuando corra el próximo crawl (regenera `events.json`). Para verlo hoy: `gh workflow run crawl.yml`.
- Fases futuras (fuera de este plan): vista dedicada "Exposiciones" (B) y festivales como contenedores (C).
```
