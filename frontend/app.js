const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

const DAYS_SHORT = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const DAYS_LONG = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

const CATEGORY_LABELS = {
  "circo": "Circo y magia",
  "conferencias": "Conferencias",
  "danza": "Danza y baile",
  "destacado": "Destacados",
  "exposiciones": "Exposiciones",
  "fiestas": "Fiestas",
  "infantil": "Infantil",
  "musica": "Musica y conciertos",
  "recitales": "Recitales",
  "teatro": "Teatro",
  "talleres": "Talleres",
  "visitas guiadas": "Visitas guiadas",
  "bibliotecas": "Bibliotecas",
  "cine": "Cine",
  "campamentos": "Campamentos",
  "otros": "Otros",
};

let currentYear, currentMonth, selectedDay;
let allData = [];       // all events from JSON
let monthEvents = [];   // filtered by current month
let activeCategory = "", activeFree = "";

async function init() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth() + 1;
  selectedDay = now.getDate();

  document.getElementById("prev-month").addEventListener("click", () => changeMonth(-1));
  document.getElementById("next-month").addEventListener("click", () => changeMonth(1));
  document.getElementById("category-filter").addEventListener("change", (e) => {
    activeCategory = e.target.value;
    e.target.classList.toggle("active-filter", !!activeCategory);
    renderEvents();
  });
  document.getElementById("free-filter").addEventListener("change", (e) => {
    activeFree = e.target.value;
    e.target.classList.toggle("active-filter", !!activeFree);
    renderEvents();
  });

  await loadData();
}

async function loadData() {
  const container = document.getElementById("events-container");
  container.innerHTML = "<p class='empty-state'>Cargando...</p>";

  try {
    const res = await fetch("data/events.json");
    allData = await res.json();
    allData.sort((a, b) => (a.start_date + (a.start_time || "")).localeCompare(b.start_date + (b.start_time || "")));
    buildCategories();
    applyMonth();
  } catch (e) {
    container.innerHTML = "<p class='empty-state'>Error al cargar eventos.</p>";
    console.error(e);
  }
}

function buildCategories() {
  const cats = new Set();
  allData.forEach(ev => ev.categories.forEach(c => cats.add(c)));
  const select = document.getElementById("category-filter");
  [...cats].filter(c => c !== "gratis").sort().forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = CATEGORY_LABELS[c] || c.charAt(0).toUpperCase() + c.slice(1);
    select.appendChild(opt);
  });
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) { currentMonth = 1; currentYear++; }
  if (currentMonth < 1) { currentMonth = 12; currentYear--; }

  const now = new Date();
  if (currentYear === now.getFullYear() && currentMonth === now.getMonth() + 1) {
    selectedDay = now.getDate();
  } else {
    selectedDay = 1;
  }
  applyMonth();
}

function applyMonth() {
  updateMonthLabel();
  const prefix = monthStr();
  monthEvents = allData.filter(ev => ev.start_date.startsWith(prefix));
  buildDayStrip();
  renderEvents();
}

function monthStr() {
  return `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
}

function updateMonthLabel() {
  document.getElementById("current-month").textContent =
    `${MONTHS_ES[currentMonth - 1]}, ${currentYear}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function buildDayStrip() {
  const strip = document.getElementById("day-strip");
  const total = daysInMonth(currentYear, currentMonth);
  const now = new Date();
  const isCurrentMonth = currentYear === now.getFullYear() && currentMonth === now.getMonth() + 1;

  const daysWithEvents = new Set();
  monthEvents.forEach(ev => {
    const day = parseInt(ev.start_date.slice(8, 10), 10);
    daysWithEvents.add(day);
  });

  let html = "";
  for (let d = 1; d <= total; d++) {
    const dt = new Date(currentYear, currentMonth - 1, d);
    const dayName = DAYS_SHORT[dt.getDay()];
    const isToday = isCurrentMonth && d === now.getDate();
    const isActive = d === selectedDay;
    const hasEvents = daysWithEvents.has(d);

    let cls = "day-btn";
    if (isToday) cls += " today";
    if (isActive) cls += " active";
    if (hasEvents) cls += " has-events";

    html += `<button class="${cls}" data-day="${d}">
      <span class="day-name">${dayName}</span>
      <span class="day-num">${d}</span>
    </button>`;
  }
  strip.innerHTML = html;

  strip.querySelectorAll(".day-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedDay = parseInt(btn.dataset.day, 10);
      renderDayStrip();
      renderEvents();
      scrollToActiveDay();
    });
  });

  scrollToActiveDay();
}

function renderDayStrip() {
  const strip = document.getElementById("day-strip");
  const now = new Date();
  const isCurrentMonth = currentYear === now.getFullYear() && currentMonth === now.getMonth() + 1;

  const daysWithEvents = new Set();
  monthEvents.forEach(ev => {
    const day = parseInt(ev.start_date.slice(8, 10), 10);
    daysWithEvents.add(day);
  });

  strip.querySelectorAll(".day-btn").forEach(btn => {
    const d = parseInt(btn.dataset.day, 10);
    btn.classList.toggle("active", d === selectedDay);
    btn.classList.toggle("today", isCurrentMonth && d === now.getDate());
    btn.classList.toggle("has-events", daysWithEvents.has(d));
  });
}

function scrollToActiveDay() {
  const strip = document.getElementById("day-strip");
  const active = strip.querySelector(".day-btn.active");
  if (active) {
    active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
}

function renderEvents() {
  const container = document.getElementById("events-container");

  let filtered = monthEvents;

  if (activeCategory) {
    filtered = filtered.filter(ev =>
      ev.categories.some(c => c.toLowerCase() === activeCategory.toLowerCase())
    );
  }

  if (activeFree === "gratis") {
    filtered = filtered.filter(ev => ev.categories.includes("gratis"));
  } else if (activeFree === "pago") {
    filtered = filtered.filter(ev => !ev.categories.includes("gratis"));
  }

  const selectedDateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
  const dayEvents = filtered.filter(ev => ev.start_date === selectedDateStr);

  const d = new Date(selectedDateStr + "T00:00:00");
  const label = `${DAYS_LONG[d.getDay()]} ${d.getDate()} de ${MONTHS_ES[d.getMonth()]}`;
  const count = dayEvents.length;
  const countText = count === 0 ? "No hay eventos" : count === 1 ? "1 evento" : `${count} eventos`;

  if (!count) {
    container.innerHTML = `
      <div class="day-section">
        <div class="day-section-header">${label}</div>
        <div class="event-count">${countText}</div>
        <p class="empty-state">No hay eventos para este dia.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="day-section">
      <div class="day-section-header">${label}</div>
      <div class="event-count">${countText}</div>
      ${dayEvents.map(renderEvent).join("")}
    </div>`;
}

function renderEvent(ev) {
  const time = ev.start_time ? ev.start_time.slice(0, 5) : "";
  const endTime = ev.end_time ? ev.end_time.slice(0, 5) : "";
  const timeStr = time ? (endTime ? `${time} - ${endTime}` : time) : "";
  const location = ev.location || "";

  const title = ev.url
    ? `<a href="${esc(ev.url)}" target="_blank" rel="noopener">${esc(ev.title)}</a>`
    : esc(ev.title);

  const desc = ev.description
    ? `<p class="event-desc">${esc(ev.description.length > 200 ? ev.description.slice(0, 200) + "..." : ev.description)}</p>`
    : "";

  const tags = ev.categories.map(c => `<span class="tag">${esc(c)}</span>`).join("");

  let metaHtml = "";
  if (timeStr || location) {
    const items = [];
    if (timeStr) items.push(`<span class="meta-item">${esc(timeStr)}</span>`);
    if (location) items.push(`<span class="meta-item">${esc(location)}</span>`);
    metaHtml = `<div class="event-meta">${items.join("")}</div>`;
  }

  return `
    <div class="event-card">
      <div class="event-title">${title}</div>
      ${metaHtml}
      ${desc}
      ${tags ? `<div class="event-tags">${tags}</div>` : ""}
    </div>`;
}

function esc(s) {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}

init();
