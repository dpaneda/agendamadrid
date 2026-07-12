# Rediseño de visualización de tags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar el lenguaje visual de los tags (tarjetas, lista de filtros, chips activos) usando el emoji como identidad y el color del tema en lugar de colores por-tag.

**Architecture:** Cambio 100% frontend. Se editan la tabla `TAGS` y dos funciones de render en `frontend/app.js`, y tres reglas en `frontend/style.css`. La base `.tag` ya usa las variables de tema (`--tag-bg` / `--tag-color`), así que gran parte del trabajo es **quitar** overrides neutros, no añadir CSS.

**Tech Stack:** HTML + CSS + JS vanilla (sin framework de test JS). Verificación por `node --check` + inspección visual con `python -m http.server`.

**Nota de testing:** El repo no tiene runner de test de JS. Cada tarea verifica con `node --check frontend/app.js` (sintaxis) y una comprobación visual concreta en el navegador. No se inventan tests unitarios donde no hay arnés.

---

## Ficheros afectados

- `frontend/app.js` — tabla `TAGS` (emojis), `eventBadges()` (badges de tarjeta), `renderFilterPanelContent()` (lista de filtros). `renderActiveFilters()` NO cambia (solo CSS).
- `frontend/style.css` — `.tag-dist, .tag-cat` (separar), `.tag-active` (restyle), `.tag-dot` → `.tag-emoji`.

Arranca el servidor una vez para todas las verificaciones:

```bash
cd frontend && python -m http.server 8000
```

Abrir http://localhost:8000 y usar DevTools (toggle responsive para móvil, ancho ≤640px).

---

### Task 1: Cambiar emojis de `danza` y `conferencias`

**Files:**
- Modify: `frontend/app.js` (tabla `TAGS`, ~L690 y ~L698)

- [ ] **Step 1: Editar el emoji de `danza`**

Buscar la línea:

```javascript
  danza:             { label: "danza",           emoji: "💃", color: "#DB2777", kind: "tipo" },
```

Reemplazar `💃` por `🩰`:

```javascript
  danza:             { label: "danza",           emoji: "🩰", color: "#DB2777", kind: "tipo" },
```

- [ ] **Step 2: Editar el emoji de `conferencias`**

Buscar la línea:

```javascript
  conferencias:      { label: "conferencias",    emoji: "🎤", color: "#4338CA", kind: "tipo" },
```

Reemplazar `🎤` por `🗣️`:

```javascript
  conferencias:      { label: "conferencias",    emoji: "🗣️", color: "#4338CA", kind: "tipo" },
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check frontend/app.js`
Expected: sin salida (exit 0).

- [ ] **Step 4: Verificación visual**

En un día con eventos de danza o conferencias, confirmar en la tarjeta y en la lista de filtros que salen 🩰 y 🗣️. (Si no hay eventos de esas categorías hoy, cambiar de fecha con el selector.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js
git commit -m "Tags: emoji propio para danza (🩰) y conferencias (🗣️)"
```

---

### Task 2: Badges de categoría en tarjetas → emoji-only con color de tema

**Files:**
- Modify: `frontend/app.js` (`eventBadges()`, bloque `catBadges`, ~L325)
- Modify: `frontend/style.css` (`.tag-dist, .tag-cat`, ~L834)

- [ ] **Step 1: Emitir pill emoji-only con etiqueta accesible**

En `eventBadges()`, reemplazar el bloque:

```javascript
  const catBadges = tipoCats.map(c => {
    const info = tagMeta(c);
    return `<span class="${cls} ${cls}-cat">${info.emoji} ${esc(info.label || c)}</span>`;
  }).join("");
```

por:

```javascript
  const catBadges = tipoCats.map(c => {
    const info = tagMeta(c);
    const name = esc(info.label || c);
    return `<span class="${cls} ${cls}-cat" title="${name}" aria-label="${name}">${info.emoji}</span>`;
  }).join("");
```

- [ ] **Step 2: Separar `.tag-cat` del neutro y darle look emoji-only**

En `frontend/style.css`, la regla actual es:

```css
.tag-dist, .tag-cat {
  background: var(--surface-container-low);
  color: var(--fg);
}
```

Reemplazarla por (quita `.tag-cat` del neutro; `.tag-cat` hereda el color de tema de la base `.tag` y solo ajusta el padding para emoji):

```css
.tag-dist {
  background: var(--surface-container-low);
  color: var(--fg);
}
.tag-cat {
  padding: 0.2rem 0.5rem;
  font-size: 0.82rem;
}
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check frontend/app.js`
Expected: sin salida (exit 0).

- [ ] **Step 4: Verificación visual (escritorio y móvil)**

Recargar http://localhost:8000. En la lista de eventos:
- Las categorías aparecen como pills con **solo el emoji**, fondo tenue del tema (morado en Clásico).
- Al pasar el ratón sobre un pill, el `title` muestra el nombre del tag.
- `Gratis`, precio (💰) y distancia (📍 km) siguen en **texto**.
- Con DevTools en modo móvil (≤640px), las tarjetas móviles muestran los mismos pills emoji-only.

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js frontend/style.css
git commit -m "Tags: badges de categoria emoji-only con color de tema en tarjetas"
```

---

### Task 3: Lista de filtros → emoji en vez de puntito de color

**Files:**
- Modify: `frontend/app.js` (`renderFilterPanelContent()`, ~L1535)
- Modify: `frontend/style.css` (`.tag-dot`, ~L600)

- [ ] **Step 1: Sustituir el dot por el emoji en la fila de filtro**

En `renderFilterPanelContent()`, la línea actual:

```javascript
    return `<button class="tag-row${isActive ? " active" : ""}" onclick="toggleActiveTag('${esc(c)}')"><span class="tag-dot" style="background:${info.color}"></span>${esc(info.label || c)}</button>`;
```

Reemplazarla por:

```javascript
    return `<button class="tag-row${isActive ? " active" : ""}" onclick="toggleActiveTag('${esc(c)}')"><span class="tag-emoji">${info.emoji}</span>${esc(info.label || c)}</button>`;
```

- [ ] **Step 2: Reemplazar el CSS del dot por el del emoji**

En `frontend/style.css`, la regla actual:

```css
.tag-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--muted);
}
```

Reemplazarla por (columna alineada de emojis; el `.tag-row` ya aporta el `gap`):

```css
.tag-emoji {
  width: 1.3em;
  flex: 0 0 auto;
  text-align: center;
  font-size: 0.95em;
}
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check frontend/app.js`
Expected: sin salida (exit 0).

- [ ] **Step 4: Verificación visual (escritorio y móvil)**

Recargar. En vista lista:
- **Escritorio**: el sidebar de tags muestra filas `emoji · nombre` con los emojis alineados en columna. Al hacer clic en un tag, la fila se resalta (fondo tenue + negrita).
- **Móvil** (≤640px): pulsar el botón de filtro; el panel muestra la misma lista `emoji · nombre`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js frontend/style.css
git commit -m "Tags: emoji en la lista de filtros (sustituye el punto de color)"
```

---

### Task 4: Chips de filtros activos → tinte + borde

**Files:**
- Modify: `frontend/style.css` (`.tag-active`, ~L820)

- [ ] **Step 1: Restyle de `.tag-active`**

En `frontend/style.css`, la regla actual:

```css
.tag-active {
  background: var(--secondary);
  color: var(--white);
  cursor: pointer;
}
```

Reemplazarla por:

```css
.tag-active {
  background: var(--tag-bg);
  color: var(--tag-color);
  border: 1.5px solid var(--secondary);
  cursor: pointer;
}
```

- [ ] **Step 2: Verificación visual (escritorio y móvil)**

Recargar. Activar un filtro de tag, de localización y de formato (los tres usan `.tag-active`):
- Los chips en la barra de filtros activos salen con **fondo tenue del tema + borde de acento**, con `emoji · nombre · ✕`.
- Comprobar en Clásico / Madrid / Noche que el chip adapta el color (cambiar tema en Ajustes).

- [ ] **Step 3: Commit**

```bash
git add frontend/style.css
git commit -m "Tags: chips de filtros activos con tinte + borde en vez de relleno solido"
```

---

### Task 5: Verificación final integrada

**Files:** ninguno (solo comprobación)

- [ ] **Step 1: Chequeo de sintaxis**

Run: `node --check frontend/app.js`
Expected: exit 0.

- [ ] **Step 2: Recorrido completo en los 3 temas**

Con el servidor en marcha, en escritorio y móvil, y alternando Clásico / Madrid / Noche:
- Tarjetas: categorías = pills emoji-only con color de tema; precio/Gratis/distancia en texto.
- Lista de filtros: `emoji · nombre` alineados, resalte al activar.
- Chips activos: tinte + borde.
- `danza` = 🩰 y `conferencias` = 🗣️ en tarjeta y filtros.

- [ ] **Step 3: Suite de crawlers en verde (no debe verse afectada)**

Run: `pytest tests/`
Expected: PASS (el cambio es frontend puro; sirve de red de seguridad).

---

## Self-review

- **Cobertura del spec:** §1 tarjetas → Task 2; §2 lista de filtros → Task 3; §3 chips activos → Task 4; §4 emojis → Task 1. Verificación → Task 5. Todo cubierto.
- **Sin placeholders:** cada step trae el código exacto (antes/después) y comandos concretos.
- **Consistencia de nombres:** clase nueva `.tag-emoji` usada igual en JS (Task 3 step 1) y CSS (Task 3 step 2); `.tag-cat` mantiene su nombre; `.tag-active` sin renombrar.
