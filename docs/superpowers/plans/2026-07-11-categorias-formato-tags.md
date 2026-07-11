# Rediseño de categorías (Formato primario + tags planos) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer el Formato el eje de filtrado primario (tarjetas visibles) y aplanar el resto del vocabulario en un único espacio de tags, con una sola tabla de metadatos en el frontend.

**Architecture:** Cambio 100% frontend (`frontend/app.js`, `frontend/index.html`, `frontend/style.css`). El backend (`crawlers/`) y el formato de datos no cambian. Una tabla `TAGS` reemplaza a `CATEGORY_LABELS`, `CAT_ICONS`, `MAIN_CATS`, `TAG_ORDER`, `TAG_CATS` y `CAT_PRIORITY`. El orden de tags se deriva por volumen en runtime. El estado `activeCatFilter` se fusiona en `activeTagFilter`.

**Tech Stack:** HTML + CSS + JS vanilla, sin framework ni bundler. Sin suite de tests JS: la verificación es por navegador (`cd frontend && python -m http.server 8000`). Breakpoint responsive existente: `max-width: 640px` = móvil.

**Estrategia de secuenciación:** cada tarea deja la app funcionando y se commitea. Primero se añade lo nuevo (aditivo, no rompe), luego se migran consumidores, y al final se borra el código muerto.

---

## Estructura de ficheros

- `frontend/app.js` — tabla `TAGS`, helpers de metadatos y volumen, tarjetas de formato, nube plana de tags, badges, fusión de estado de filtros, Mis Intereses.
- `frontend/index.html` — contenedores nuevos: tarjetas de formato y sidebar de tags (desktop).
- `frontend/style.css` — estilos de tarjetas de formato y layout responsive (sidebar desktop / modal móvil).
- `CLAUDE.md` — corregir el recuento de categorías.

---

## Task 1: Añadir tabla `TAGS` única y helpers de metadatos/volumen

**Files:**
- Modify: `frontend/app.js` (añadir tras el bloque `CAT_ICONS`, aprox. línea 756; y modificar `buildCategories` en línea 885)

- [ ] **Step 1: Añadir la tabla `TAGS` y los helpers**

Insertar justo después del cierre de `CAT_ICONS` (línea 756, antes de `function renderMap()`):

```js
// Fuente única de verdad de metadatos de tags. Reemplaza (se irá borrando)
// a CATEGORY_LABELS, CAT_ICONS, MAIN_CATS, TAG_ORDER, TAG_CATS, CAT_PRIORITY.
// kind: "tipo" = qué es el evento; "atributo" = característica transversal.
// legacy: true = alias antiguo; resuelve label/emoji pero no aparece en filtros.
const TAGS = {
  teatro:            { label: "teatro",          emoji: "🎭", color: "#1D4ED8", kind: "tipo" },
  "monólogos":       { label: "monólogos",       emoji: "😂", color: "#7C3AED", kind: "tipo" },
  danza:             { label: "danza",           emoji: "💃", color: "#DB2777", kind: "tipo" },
  circo:             { label: "circo",           emoji: "🤹", color: "#BE185D", kind: "tipo" },
  conciertos:        { label: "conciertos",      emoji: "🎵", color: "#7C3AED", kind: "tipo" },
  "ópera":           { label: "ópera",           emoji: "🎼", color: "#4338CA", kind: "tipo" },
  cine:              { label: "cine",            emoji: "🎬", color: "#374151", kind: "tipo" },
  exposiciones:      { label: "exposiciones",    emoji: "🏛️", color: "#0891B2", kind: "tipo" },
  literatura:        { label: "literatura",      emoji: "📖", color: "#7C2D12", kind: "tipo" },
  talleres:          { label: "talleres",        emoji: "🔨", color: "#92400E", kind: "tipo" },
  conferencias:      { label: "conferencias",    emoji: "🎤", color: "#4338CA", kind: "tipo" },
  "visitas guiadas": { label: "visitas guiadas", emoji: "🗺️", color: "#1E40AF", kind: "tipo" },
  infantil:          { label: "infantil",        emoji: "🧸", color: "#F59E0B", kind: "tipo" },
  deportes:          { label: "deportes",        emoji: "⚽", color: "#16A34A", kind: "tipo" },
  ferias:            { label: "ferias",          emoji: "🛍️", color: "#DC2626", kind: "tipo" },
  "fotografía":      { label: "fotografía",      emoji: "📷", color: "#6B7280", kind: "tipo" },
  "gastronomía":     { label: "gastronomía",     emoji: "🍽️", color: "#EA580C", kind: "tipo" },
  mercados:          { label: "mercados",        emoji: "🛒", color: "#15803D", kind: "tipo" },
  fiestas:           { label: "fiestas",         emoji: "🎉", color: "#DC2626", kind: "tipo" },
  musicales:         { label: "musicales",       emoji: "🎶", color: "#7C3AED", kind: "tipo" },
  flamenco:          { label: "flamenco",        emoji: "💃", color: "#DC2626", kind: "tipo" },
  magia:             { label: "magia",           emoji: "🪄", color: "#7C3AED", kind: "tipo" },
  otros:             { label: "otros",           emoji: "📌", color: "#6B7280", kind: "tipo" },
  gratis:            { label: "gratis",          emoji: "🆓", color: "#16A34A", kind: "atributo" },
  "aire libre":      { label: "aire libre",      emoji: "🌳", color: "#22C55E", kind: "atributo" },
  accesible:         { label: "accesible",       emoji: "♿", color: "#2563EB", kind: "atributo" },
  destacado:         { label: "destacado",       emoji: "⭐", color: "#EAB308", kind: "atributo" },
  // Alias legacy: resuelven metadatos para excludedCats antiguos en localStorage.
  musica:            { label: "música",          emoji: "🎵", color: "#7C3AED", kind: "tipo", legacy: true },
  fotografia:        { label: "fotografía",      emoji: "📷", color: "#6B7280", kind: "tipo", legacy: true },
};

const _TAG_FALLBACK = { label: "", emoji: "📍", color: "#6B7280", kind: "tipo" };

// Metadatos de un slug de tag, con fallback seguro.
function tagMeta(slug) {
  return TAGS[slug] || { ..._TAG_FALLBACK, label: slug };
}

// Recuento global de eventos por tag (se rellena en buildCategories).
let tagVolume = {};
// Slugs no-legacy con al menos 1 evento, ordenados por volumen desc (para la nube).
let tagsByVolume = [];
```

- [ ] **Step 2: Reescribir `buildCategories` para calcular volumen y orden**

Reemplazar la función `buildCategories` completa (líneas 885-890) por:

```js
function buildCategories() {
  allCatSet = new Set();
  tagVolume = {};
  allData.forEach(ev => {
    (ev.categories || []).forEach(c => {
      if (!c) return;
      allCatSet.add(c);
      tagVolume[c] = (tagVolume[c] || 0) + 1;
    });
  });
  tagsByVolume = Object.keys(TAGS)
    .filter(slug => !TAGS[slug].legacy && (tagVolume[slug] || 0) > 0)
    .sort((a, b) => (tagVolume[b] || 0) - (tagVolume[a] || 0));
}
```

- [ ] **Step 3: Verificar en consola del navegador**

Run: `cd frontend && python -m http.server 8000` y abrir `http://localhost:8000`.
En la consola del navegador ejecutar:
```js
tagsByVolume.slice(0,3); tagVolume.gratis; tagMeta("teatro").emoji;
```
Expected: `tagsByVolume` empieza por `["gratis","exposiciones","teatro"]` (o similar según datos); `tagVolume.gratis` es un número > 0; `tagMeta("teatro").emoji` es `"🎭"`. Sin errores en consola; la app carga y filtra igual que antes (nada roto, cambio aditivo).

- [ ] **Step 4: Commit**

```bash
git add frontend/app.js
git commit -m "Categorías: tabla TAGS única y orden por volumen (aditivo)"
```

---

## Task 2: Migrar consumidores de metadatos a `tagMeta()`

Migra `eventBadges`, `renderActiveFilters`, el marcador de mapa y el popup de mapa para que usen `TAGS`/`tagMeta()` en vez de `CAT_ICONS`/`CATEGORY_LABELS`/`TAG_CATS`. Tras esta tarea, esas 3 estructuras quedan sin uso.

**Files:**
- Modify: `frontend/app.js` (`eventBadges` 340-367; `renderMap` PRIORITY/bestCat 779-828; `renderActiveFilters` 1239-1246; popup de mapa ~1788)

- [ ] **Step 1: Migrar `eventBadges` (usar `kind` y `tagMeta`)**

En `eventBadges` (líneas 360-364), reemplazar:

```js
  const filteredCats = (ev.categories || []).filter(c => !TAG_CATS.has(c));
  const catBadges = filteredCats.map(c => {
    const info = CAT_ICONS[c] || { emoji: "📍", color: "#6B7280" };
    return `<span class="${cls} ${cls}-cat">${info.emoji} ${esc(CATEGORY_LABELS[c] || c)}</span>`;
  }).join("");
```

por (muestra solo tags de tipo, ordenados por volumen global, y como hoy varias caben):

```js
  const tipoCats = (ev.categories || [])
    .filter(c => tagMeta(c).kind === "tipo")
    .sort((a, b) => (tagVolume[b] || 0) - (tagVolume[a] || 0));
  const catBadges = tipoCats.map(c => {
    const info = tagMeta(c);
    return `<span class="${cls} ${cls}-cat">${info.emoji} ${esc(info.label || c)}</span>`;
  }).join("");
```

- [ ] **Step 2: Migrar el marcador y popup de mapa**

En `renderMap`, la constante local `PRIORITY` (líneas 779-783) y el uso de `CAT_ICONS.otros` en `bestCat` (línea 828): reemplazar el cálculo de `bestCat` para que use el tag de tipo de mayor volumen. Localizar el bloque que elige `bestCat` (alrededor de línea 789-828) y sustituir la selección basada en `PRIORITY` por:

```js
    // Mejor categoría = tag de tipo con más volumen global entre los eventos del punto.
    const allCats = evs.flatMap(ev => ev.categories || []).filter(c => tagMeta(c).kind === "tipo");
    const bestCat = allCats.sort((a, b) => (tagVolume[b] || 0) - (tagVolume[a] || 0))[0] || "otros";
    const { emoji } = tagMeta(bestCat);
```

Eliminar la constante local `PRIORITY` (líneas 779-783), ya que deja de usarse.

En el popup de mapa (línea ~1788), reemplazar:

```js
  const catInfo = CAT_ICONS[cat] || { emoji: "📍", color: "#6B7280" };
```
por:
```js
  const catInfo = tagMeta(cat);
```

- [ ] **Step 3: Migrar `renderActiveFilters`**

En `renderActiveFilters` (líneas 1239-1246), reemplazar los dos bucles `activeCatFilter.forEach` y `activeTagFilter.forEach` por uno solo (la fusión de estado se completa en Task 3; de momento cubrimos ambos con `tagMeta`):

```js
  activeCatFilter.forEach(c => {
    const info = tagMeta(c);
    parts.push(`<span class="tag tag-active" role="button" tabindex="0" onclick="toggleActiveCat('${esc(c)}')">${info.emoji} ${esc(info.label || c)} ✕</span>`);
  });
  activeTagFilter.forEach(t => {
    const info = tagMeta(t);
    parts.push(`<span class="tag tag-active" role="button" tabindex="0" onclick="toggleActiveTag('${esc(t)}')">${info.emoji} ${esc(info.label || t)} ✕</span>`);
  });
```

- [ ] **Step 4: Verificar en navegador**

Recargar `http://localhost:8000`. Comprobar:
- Las tarjetas de evento muestran los badges de categoría con emoji y label correctos.
- La vista Mapa (botón "Mapa") muestra marcadores con emoji y los popups muestran la categoría.
- Ningún error en consola.

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js
git commit -m "Categorías: migrar badges, mapa y filtros activos a tagMeta()"
```

---

## Task 3: Fusionar `activeCatFilter` en `activeTagFilter` (un solo eje de tags)

**Files:**
- Modify: `frontend/app.js` (`activeCatFilter` decl. 396; `_applyCatFilter` 892-907; `renderActiveFilters` 1239-1242; `toggleActiveCat` 1498-1506; `clearActiveFilters` 1518-1527; `updateFilterBadge` 1529-1538)

- [ ] **Step 1: Eliminar la declaración de `activeCatFilter`**

Borrar la línea 396:
```js
let activeCatFilter = [];
```
(Se conserva `let activeTagFilter = [];` en la línea 398 como único eje.)

- [ ] **Step 2: Simplificar `_applyCatFilter`**

Reemplazar `_applyCatFilter` (líneas 892-907) por:

```js
function _applyCatFilter(events) {
  // Stage 1: Mis Intereses — excluye eventos con CUALQUIER tag desactivado.
  const excluded = Settings.get("excludedCats", []);
  if (excluded.length) {
    events = events.filter(ev => !(ev.categories || []).some(c => excluded.includes(c)));
  }
  // Stage 2: filtro de tags (OR interno).
  if (activeTagFilter.length) {
    events = events.filter(ev => (ev.categories || []).some(c => activeTagFilter.includes(c)));
  }
  return events;
}
```

- [ ] **Step 3: Eliminar el bucle `activeCatFilter` de `renderActiveFilters`**

En `renderActiveFilters`, borrar el bloque `activeCatFilter.forEach(...)` (dejar solo el `activeTagFilter.forEach(...)` de Task 2 Step 3).

- [ ] **Step 4: Borrar `toggleActiveCat`**

Eliminar la función `toggleActiveCat` completa (líneas 1498-1506). Todos los chips de tag usarán `toggleActiveTag`.

- [ ] **Step 5: Actualizar `clearActiveFilters` y `updateFilterBadge`**

En `clearActiveFilters` (1518-1527), borrar la línea `activeCatFilter = [];`.

En `updateFilterBadge` (1530) y en el `hasFilters` del panel (1563), reemplazar `activeCatFilter.length + activeTagFilter.length` por `activeTagFilter.length` en ambos sitios:

```js
  const count = activeTagFilter.length + (activeFormato ? 1 : 0);
```

- [ ] **Step 6: Verificar en navegador**

Recargar. Grep de seguridad: `grep -n activeCatFilter frontend/app.js` no debe devolver nada. Comprobar que filtrar por tags sigue funcionando (se validará la UI del panel en Task 5).

- [ ] **Step 7: Commit**

```bash
git add frontend/app.js
git commit -m "Categorías: fusionar activeCatFilter en activeTagFilter"
```

---

## Task 4: Tarjetas de Formato como eje primario visible

**Files:**
- Modify: `frontend/index.html` (dentro de `<main>`, antes de `#events-container`, línea 2690)
- Modify: `frontend/app.js` (nueva función `renderFormatoCards` + helper de conteo; llamarla en `render()` 1072; ocultar en vistas no-lista/mapa)
- Modify: `frontend/style.css` (estilos de tarjetas)

- [ ] **Step 1: Añadir el contenedor en el HTML**

En `frontend/index.html`, insertar justo después de `<main>` (línea 2690) y antes de `<div id="events-container">`:

```html
    <div id="formato-cards" class="formato-cards"></div>
```

- [ ] **Step 2: Añadir helper de conteo por formato + `renderFormatoCards`**

En `frontend/app.js`, añadir un parámetro `skipFormato` a `_applyListFilters` (línea 949) para poder contar por formato sin aplicar el propio filtro. Cambiar la firma y el bloque de formato (línea 965):

```js
function _applyListFilters(events, skipFormato) {
```
y envolver el filtro de formato:
```js
  if (activeFormato && !skipFormato) {
    events = events.filter(ev => ev.formato === activeFormato);
  }
```

Añadir tras `renderEvents` (línea 1105) las funciones:

```js
const FORMATO_ORDER = ["puntual", "exposicion", "festival"];
const FORMATO_EMOJI = { puntual: "🎯", exposicion: "🖼", festival: "🎪" };

// Recuento de eventos del día por formato, aplicando el resto de filtros.
function formatoCounts() {
  const evs = _applyListFilters(_getDayEvents(dateStr(selectedDate)), true);
  const counts = { puntual: 0, exposicion: 0, festival: 0 };
  evs.forEach(ev => { if (counts[ev.formato] != null) counts[ev.formato]++; });
  return counts;
}

function renderFormatoCards() {
  const el = document.getElementById("formato-cards");
  if (!el) return;
  const showFor = currentView === "list" || currentView === "map";
  el.style.display = showFor && !activeSearch ? "" : "none";
  if (!showFor) return;
  const counts = formatoCounts();
  el.innerHTML = FORMATO_ORDER.map(f => {
    const active = activeFormato === f;
    const label = FORMATO_LABELS[f].replace(/^[^ ]+ /, "");
    return `<button class="formato-card${active ? " active" : ""}" aria-pressed="${active}" onclick="toggleFormato('${f}')">
      <span class="formato-emoji">${FORMATO_EMOJI[f]}</span>
      <span class="formato-label">${esc(label)}</span>
      <span class="formato-count">${counts[f]}</span>
    </button>`;
  }).join("");
}
```

Nota: `FORMATO_LABELS` incluye el emoji al inicio (p. ej. `"🎯 Puntual"`); el `.replace` extrae solo el texto porque el emoji se renderiza aparte.

- [ ] **Step 3: Llamar a `renderFormatoCards` en `render()` y en `setView()`**

En `render()` (línea 1072), añadir la llamada al principio de la función, tras `updateURL();`:

```js
function render() {
  updateURL();
  renderFormatoCards();
  if (currentView === "list") {
```

`setView` (línea 621) NO llama a `render()` (invoca `renderEvents`/`renderMap` directamente), así que hay que llamar también ahí. En `setView`, tras la línea `document.querySelector(".filter-bar").style.display = view === "user" ? "none" : "";` (línea 639), añadir:

```js
  renderFormatoCards();
```

- [ ] **Step 4: Actualizar `toggleFormato` para re-renderizar tarjetas**

En `toggleFormato` (líneas 1488-1496), añadir `renderFormatoCards();` tras `renderActiveFilters();`:

```js
function toggleFormato(val) {
  activeFormato = activeFormato === val ? "" : val;
  if (activeFormato) sessionStorage.setItem("activeFormato", activeFormato);
  else sessionStorage.removeItem("activeFormato");
  renderActiveFilters();
  renderFormatoCards();
  render();
  const panel = document.getElementById("filter-panel");
  if (panel) renderFilterPanelContent(panel);
}
```

- [ ] **Step 5: Añadir estilos de las tarjetas**

En `frontend/style.css`, tras el bloque `.filter-bar` (línea 358 y ss.), añadir:

```css
.formato-cards {
  display: flex;
  gap: 0.5rem;
  max-width: 70rem;
  margin: 0.6rem auto 0;
  padding: 0 1rem;
}
.formato-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.6rem 0.4rem;
  border: 1px solid var(--surface-container-highest);
  border-radius: 12px;
  background: var(--surface);
  color: var(--fg);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}
.formato-card.active {
  border-color: var(--primary);
  background: var(--surface-container);
}
.formato-emoji { font-size: 1.3rem; }
.formato-label { font-size: 0.8rem; font-weight: 600; }
.formato-count { font-size: 0.7rem; color: var(--muted); }
@media (max-width: 640px) {
  .formato-cards { padding: 0 0.6rem; gap: 0.35rem; }
  .formato-label { font-size: 0.72rem; }
}
```

- [ ] **Step 6: Verificar en navegador**

Recargar. Comprobar:
- Aparecen 3 tarjetas de formato bajo la cabecera con recuentos del día.
- Tocar una la activa y filtra la lista; tocar de nuevo vuelve a "Todos".
- Cambiar de día actualiza los recuentos.
- Al abrir Búsqueda o vistas Mes/Swipe/Ajustes las tarjetas se ocultan; en Lista y Mapa se muestran.

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/app.js frontend/style.css
git commit -m "Categorías: tarjetas de formato como eje primario"
```

---

## Task 5: Nube plana de tags en el panel (móvil) y quitar Formato del panel

**Files:**
- Modify: `frontend/app.js` (`renderFilterPanelContent` 1548-1582)

- [ ] **Step 1: Reescribir `renderFilterPanelContent` como nube plana sin sección Formato**

Reemplazar la función `renderFilterPanelContent` completa (líneas 1548-1582) por:

```js
function renderFilterPanelContent(panel) {
  const excluded = Settings.get("excludedCats", []);
  const chips = tagsByVolume.map(c => {
    const info = tagMeta(c);
    const isActive = activeTagFilter.includes(c);
    const isExcluded = excluded.includes(c);
    if (isExcluded) {
      return `<button class="filter-chip disabled" title="Desactivado en Mis Intereses (Ajustes)">${info.emoji} ${esc(info.label || c)}</button>`;
    }
    return `<button class="filter-chip${isActive ? " active" : ""}" onclick="toggleActiveTag('${esc(c)}')">${info.emoji} ${esc(info.label || c)}</button>`;
  }).join("");
  const hasFilters = activeTagFilter.length + (activeFormato ? 1 : 0) > 0;
  panel.innerHTML = `
    <div class="filter-panel-section">
      <div class="filter-panel-label">Tags</div>
      <div class="filter-chips">${chips}</div>
    </div>
    ${hasFilters ? `<button class="filter-clear-btn" onclick="clearActiveFilters()">Limpiar filtros</button>` : ""}
  `;
}
```

- [ ] **Step 2: Verificar en navegador (móvil)**

Recargar con el navegador en ancho móvil (DevTools, < 640px). Abrir el panel con el icono de filtro (embudo). Comprobar:
- Ya no hay sección "Formato" ni "Categorías principales / Subcategorías": una sola nube "Tags" ordenada por volumen.
- Los chips filtran (OR) y se marcan activos; el AND con formato funciona.
- "Limpiar filtros" resetea tags y formato.

- [ ] **Step 3: Commit**

```bash
git add frontend/app.js
git commit -m "Categorías: nube plana de tags en el panel de filtros"
```

---

## Task 6: Sidebar de tags fija en desktop

En desktop los tags viven en una sidebar siempre visible a la izquierda de la lista; en móvil siguen en el modal (Task 5). Se reutiliza `renderFilterPanelContent` renderizando en el contenedor de la sidebar.

**Files:**
- Modify: `frontend/index.html` (envolver `#events-container` y añadir `#tags-sidebar`)
- Modify: `frontend/app.js` (renderizar sidebar; ocultar botón de filtro en desktop no es necesario, pero sí poblar la sidebar en `render()`)
- Modify: `frontend/style.css` (layout de dos columnas en desktop, oculto en móvil)

- [ ] **Step 1: Añadir el contenedor de sidebar en el HTML**

En `frontend/index.html`, envolver la zona de lista. **Importante**: la línea de apertura lleva el marcador `<!-- SEO:PRERENDER:START -->` pegado; hay que preservarlo intacto (lo usa `generate_seo.py`). Cambiar la línea 2691, que empieza así:

```html
    <div id="events-container"><!-- SEO:PRERENDER:START -->  <article>
```
por (insertar `.list-layout` + `<aside>` antes, sin tocar el resto de la línea):
```html
    <div class="list-layout">
      <aside id="tags-sidebar" class="tags-sidebar"></aside>
      <div id="events-container"><!-- SEO:PRERENDER:START -->  <article>
```

Y cerrar el nuevo `.list-layout` tras el cierre de `#events-container`. Cambiar (línea 2890):
```html
  </article><!-- SEO:PRERENDER:END --></div>
    <div id="map-container" hidden>
```
por:
```html
  </article><!-- SEO:PRERENDER:END --></div>
    </div>
    <div id="map-container" hidden>
```

- [ ] **Step 2: Renderizar la sidebar en `render()`**

En `frontend/app.js`, añadir una función que puebla la sidebar con el mismo contenido que el panel, y llamarla desde `render()` y desde los toggles.

Añadir tras `renderFilterPanelContent` (Task 5):

```js
function renderTagsSidebar() {
  const sidebar = document.getElementById("tags-sidebar");
  if (!sidebar) return;
  const visible = currentView === "list" && !activeSearch;
  sidebar.style.display = visible ? "" : "none";
  if (visible) renderFilterPanelContent(sidebar);
}
```

En `render()`, añadir `renderTagsSidebar();` tras `renderFormatoCards();`:

```js
function render() {
  updateURL();
  renderFormatoCards();
  renderTagsSidebar();
  ...
```

En `setView` (línea 621), junto a la llamada a `renderFormatoCards();` añadida en Task 4 (tras la línea de `.filter-bar`), añadir también:

```js
  renderTagsSidebar();
```

Los toggles (`toggleActiveTag`, `toggleFormato`, `clearActiveFilters`) ya llaman a `render()`, que a su vez invoca `renderTagsSidebar()`, así que la sidebar se refresca sola al filtrar. `toggleActiveTag` queda igual que hoy:

```js
function toggleActiveTag(tag) {
  const idx = activeTagFilter.indexOf(tag);
  if (idx >= 0) activeTagFilter.splice(idx, 1);
  else activeTagFilter.push(tag);
  renderActiveFilters();
  render();
  const panel = document.getElementById("filter-panel");
  if (panel) renderFilterPanelContent(panel);
}
```
(La llamada a `render()` ya invoca `renderTagsSidebar()`, así que no hace falta añadir nada extra en los toggles. Verificar que `render()` se llama en cada toggle — lo hace.)

- [ ] **Step 3: Estilos responsive de la sidebar**

En `frontend/style.css`, añadir tras los estilos de `.formato-cards`:

```css
.list-layout {
  display: flex;
  gap: 1rem;
  max-width: 70rem;
  margin: 0 auto;
  align-items: flex-start;
}
.tags-sidebar {
  flex: 0 0 220px;
  position: sticky;
  top: 1rem;
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  padding: 0.5rem;
}
.list-layout > #events-container { flex: 1; min-width: 0; }
/* En móvil los tags viven en el modal; la sidebar se oculta. */
@media (max-width: 640px) {
  .tags-sidebar { display: none !important; }
  .list-layout { display: block; }
}
```

- [ ] **Step 4: Ocultar el botón de filtro en desktop**

Como en desktop los tags ya están visibles, el botón embudo solo tiene sentido en móvil. En `frontend/style.css`, dentro del `@media (max-width: 640px)` NO se toca; añadir una regla global para ocultarlo por encima del breakpoint. Localizar `.filter-toggle-btn` (línea 424) y añadir tras su bloque:

```css
@media (min-width: 641px) {
  .filter-toggle-btn { display: none; }
}
```

- [ ] **Step 5: Verificar en navegador (desktop y móvil)**

Desktop (> 640px): la sidebar de tags aparece a la izquierda de la lista, sticky; filtra sin abrir nada; el botón embudo no se ve. Móvil (< 640px): sin sidebar; el botón embudo abre el modal con la nube. En ambos, cambiar de vista a Mapa/Mes oculta la sidebar. Sin errores en consola.

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html frontend/app.js frontend/style.css
git commit -m "Categorías: sidebar de tags fija en desktop"
```

---

## Task 7: Mis Intereses como lista plana de tags

**Files:**
- Modify: `frontend/app.js` (`chipList` y `catGridHtml` en `renderUserView`, líneas 1365-1394)

- [ ] **Step 1: Reescribir la sección de intereses como lista plana**

En `renderUserView`, reemplazar el bloque que define `mainCats`, `tagCats`, `chipList` y `catGridHtml` (líneas 1365-1382) por:

```js
  const excludedCats = Settings.get("excludedCats", []);

  function chipList(cats) {
    return cats.map(c => {
      const info = tagMeta(c);
      const active = !excludedCats.includes(c);
      return `<button class="cat-chip${active ? " active" : ""}" aria-pressed="${active}" onclick="toggleCatPref('${esc(c)}')">${info.emoji} ${esc(info.label || c)}</button>`;
    }).join("");
  }

  const catGridHtml = `
    <div class="cat-chips-wrap">${chipList(tagsByVolume)}</div>
  `;
```

(Se eliminan las variables `mainCats`/`tagCats` y las dos subsecciones "Categorías principales"/"Subcategorías": ahora es una sola lista ordenada por volumen.)

- [ ] **Step 2: Verificar en navegador**

Ir a Ajustes. Comprobar:
- "Mis Intereses" muestra una sola lista de tags (por volumen), sin subtítulos de principales/subcategorías.
- Desactivar un tag lo tacha en el panel/sidebar de filtros y oculta esos eventos en lista/mapa/calendario.
- Reactivarlo los vuelve a mostrar.

- [ ] **Step 3: Commit**

```bash
git add frontend/app.js
git commit -m "Categorías: Mis Intereses como lista plana de tags"
```

---

## Task 8: Borrar código muerto y actualizar CLAUDE.md

**Files:**
- Modify: `frontend/app.js` (borrar `CATEGORY_LABELS` 296-327; `CAT_ICONS` 725-756; `MAIN_CATS`/`TAG_ORDER`/`CAT_PRIORITY`/`TAG_CATS` 335-338)
- Modify: `CLAUDE.md` (línea "18 categorias + 4 tags")

- [ ] **Step 1: Confirmar que las estructuras viejas no se usan**

Run:
```bash
grep -n "CATEGORY_LABELS\|CAT_ICONS\|MAIN_CATS\|TAG_ORDER\|CAT_PRIORITY\|TAG_CATS" frontend/app.js
```
Expected: solo deben aparecer las **definiciones** (no usos). Si aparece algún uso restante, migrarlo a `tagMeta()`/`tagsByVolume` antes de borrar.

- [ ] **Step 2: Borrar las definiciones muertas**

Eliminar de `frontend/app.js`:
- El objeto `CATEGORY_LABELS` completo (líneas 296-327).
- Las constantes `TAG_CATS`, `MAIN_CATS`, `TAG_ORDER`, `CAT_PRIORITY` (líneas 335-338).
- El objeto `CAT_ICONS` completo (líneas 725-756).

- [ ] **Step 3: Verificar en navegador**

Recargar. Repetir el grep del Step 1: no debe devolver nada. Recorrer Lista, Mapa, Mes, Ajustes y el panel/sidebar de filtros; sin errores en consola y todo renderiza.

- [ ] **Step 4: Corregir CLAUDE.md**

En `/king/repos/agendamadrid/CLAUDE.md`, en la sección "Categorias canonicas", reemplazar:

```
18 categorias + 4 tags modificadores en `crawlers/categories.py`. Todos los crawlers mapean a este set fijo.
```
por:
```
8 categorias + 19 tags modificadores en `crawlers/categories.py` (set canonico interno). Todos los crawlers mapean a este set fijo. En el frontend no hay distincion categoria/subcategoria: el eje primario es el Formato (Puntual / Exposiciones / Eventos tematicos) y el resto del vocabulario se presenta como tags planos ordenados por volumen (tabla unica `TAGS` en `frontend/app.js`).
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js CLAUDE.md
git commit -m "Categorías: borrar estructuras de metadatos muertas y actualizar CLAUDE.md"
```

---

## Task 9: Verificación end-to-end

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Verificación funcional completa en navegador**

Con `cd frontend && python -m http.server 8000`, comprobar en desktop y en móvil (DevTools responsive):
- Tarjetas de formato: recuentos correctos por día, single-select con toggle a "Todos", ocultas en búsqueda/Mes/Swipe/Ajustes.
- Tags: nube plana por volumen; sidebar en desktop, modal en móvil; OR entre tags; AND con formato.
- Badges de evento: muestran el/los tag(s) de tipo; `gratis` como badge de precio.
- Mis Intereses: desactivar oculta en lista/mapa/calendario.
- Filtros activos (barra superior) y "Limpiar filtros".
- Los 3 temas (Clásico / Madrid / Noche) se ven bien.

- [ ] **Step 2: Verificar que los tests del backend siguen pasando**

Run: `pytest tests/`
Expected: PASS (no se ha tocado el backend; sin regresiones).

- [ ] **Step 3: Commit final si hubo ajustes**

Si la verificación obligó a algún arreglo, commitear:
```bash
git add -A
git commit -m "Categorías: ajustes de verificación end-to-end"
```

---

## Notas de implementación

- **Sin tests JS**: el proyecto no tiene runner de tests para el frontend; la verificación es por navegador. Los pasos de "verificar" son obligatorios, no opcionales.
- **Números de línea**: son referencias al estado actual de los ficheros; pueden desplazarse a medida que se aplican tareas. Localizar por el contenido del código mostrado, no solo por la línea.
- **Datos**: no se regeneran; el campo `formato` ya existe en `events.json` (valores `puntual`/`exposicion`/`festival`).
