# Rediseño de la visualización de tags

**Fecha:** 2026-07-12
**Estado:** Diseño aprobado, pendiente de plan de implementación

## Contexto

Los tags de Agenda Madrid se muestran hoy en tres superficies con lenguajes visuales
distintos y poco cohesionados:

1. **Badges en tarjetas de evento** — pills grises neutros (`emoji + texto`), sin usar el
   color propio del tag. Se ven planos y no se distingue la categoría de un vistazo.
2. **Lista de filtros** (sidebar de escritorio + panel de móvil) — filas con un puntito de
   color + nombre.
3. **Chips de filtros activos** — chips sólidos en color de acento (`--secondary`).

El objetivo es unificar las tres superficies bajo un mismo lenguaje visual, apoyándose en el
**emoji** como identidad compartida de cada tag, y ligando el color al **tema activo**
(Clásico / Madrid / Noche) en lugar de a colores por-tag. Resultado esperado: tarjetas más
limpias y escaneables, y una UI de tags coherente en escritorio y móvil.

Decidido mediante brainstorming visual (companion). El alcance es **100% frontend**: la
prerenderización SEO (`crawlers/generate_seo.py`) usa texto plano y no se ve afectada.

## Diseño

### 1 · Badges en tarjetas (escritorio + móvil)

- Las categorías (tags de `kind: "tipo"` no ocultos) se renderizan como **pill emoji-only**:
  solo el emoji, sin texto.
- Fondo único del tema: `--tag-bg`, color `--tag-color`. **Sin color por-tag** (el emoji ya
  aporta el color). Se adapta solo a los 3 temas.
- Accesibilidad: cada pill lleva `title` y `aria-label` con el nombre del tag.
- **Precio / `Gratis` / distancia / fuente** siguen siendo **texto**, sin cambios.

### 2 · Lista de filtros (sidebar escritorio + panel móvil)

- Se mantiene la **lista vertical** actual, ordenada por volumen global (`tagsByVolume`), con
  el mismo contenido y comportamiento.
- El **puntito de color** (`.tag-dot`) se sustituye por el **emoji** del tag, en una columna
  alineada: `emoji · nombre`.
- Estado activo: fondo `--tag-bg` + negrita (como ahora).
- **Sin recuento** por tag (se evaluó y se descarta para no introducir ambigüedad
  día/global).

### 3 · Chips de filtros activos

- Formato `emoji · nombre · ✕`, con estilo **tinte + borde**: fondo `--tag-bg`, texto
  `--tag-color`, borde `1.5px var(--secondary)`.
- Aplica a **todos** los chips activos (tag, localización, formato, filtro de usuario), que ya
  comparten la clase `.tag-active`.

### 4 · Emojis (tabla `TAGS`)

Resolver colisiones de emoji ahora que el emoji porta el significado:

- `danza`: 💃 → **🩰** (colisionaba con `flamenco` 💃).
- `conferencias`: 🎤 → **🗣️** (el micro se confundía con el clúster musical
  `conciertos 🎵` / `ópera 🎼` / `musicales 🎶`).

`flamenco` conserva 💃. El resto del clúster musical se deja igual (color + forma de la nota
los separan lo suficiente).

## Puntos de cambio en el código

Todo en `frontend/`:

**`app.js`**
- Tabla `TAGS` (~L688): cambiar el emoji de `danza` y `conferencias`.
- `eventBadges()` → `catBadges` (~L325): emitir pill emoji-only con `title`/`aria-label` en
  lugar de `emoji + label`.
- `renderFilterPanelContent()` (~L1535): sustituir `<span class="tag-dot">` por el emoji del
  tag (`info.emoji`).
- `renderActiveFilters()` (~L1226): sin cambios de marcado (ya es `emoji + label + ✕`); el
  restyle es solo CSS.

**`style.css`**
- Separar `.tag-cat` de `.tag-dist` (hoy comparten regla ~L834). `.tag-cat` pasa a
  `background: var(--tag-bg); color: var(--tag-color)`; `.tag-dist` mantiene el neutro actual.
  Ajustar padding del pill emoji-only para que quede compacto/cuadrado.
- `.tag-active` (~L820): de relleno sólido `--secondary` a tinte + borde
  (`--tag-bg` / `--tag-color` / borde `--secondary`).
- `.tag-dot` (~L600) → reemplazar por `.tag-emoji` (quitar el círculo de color, dimensionar el
  emoji y mantener la alineación en columna de `.tag-row`).

## Verificación

1. `cd frontend && python -m http.server 8000` y abrir la app.
2. **Tarjetas** (escritorio y móvil, con DevTools responsive): las categorías aparecen como
   pills emoji-only con fondo del tema; `Gratis`/precio siguen en texto; `title` visible al
   pasar el ratón.
3. **Lista de filtros**: sidebar (escritorio) y panel (botón filtro en móvil) muestran
   `emoji · nombre` alineados; al activar un tag se resalta.
4. **Chips activos**: al filtrar por tag/localización/formato, los chips salen con tinte +
   borde.
5. **Temas**: alternar Clásico / Madrid / Noche y confirmar que los pills y chips adaptan el
   color.
6. **Emojis**: `danza` sale 🩰 y `conferencias` 🗣️ tanto en tarjeta como en filtros.
7. `node --check frontend/app.js` y `pytest tests/` en verde.
