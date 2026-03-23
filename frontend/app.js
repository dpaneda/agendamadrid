// User data management (localStorage) — single store for everything
const UserData = (() => {
  const KEY = "agendamadrid_user";

  function _load() {
    let data;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        data = JSON.parse(raw);
        if (data.version !== 1) data = null;
      }
    } catch (e) {}
    if (!data) data = { version: 1, favorites: {}, seen: {}, dismissed: {} };
    // Migrate old separate settings store
    if (!data.settings) {
      data.settings = {};
      try {
        const old = JSON.parse(localStorage.getItem("agendamadrid_settings") || "null");
        if (old) { const { _ts, ...rest } = old; data.settings = rest; }
      } catch (e) {}
      localStorage.removeItem("agendamadrid_settings");
      localStorage.setItem(KEY, JSON.stringify(data));
    }
    return data;
  }

  function _save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
    FirebaseSync.push(data);
  }

  return {
    toggle(collection, id) {
      const data = _load();
      if (!data[collection]) data[collection] = {};
      if (data[collection][id]) {
        delete data[collection][id];
      } else {
        data[collection][id] = Date.now();
      }
      _save(data);
    },
    has(collection, id) {
      return !!((_load()[collection] || {})[id]);
    },
    getAll(collection) {
      return _load()[collection] || {};
    },
    raw() { return _load(); },
  };
})();

const Settings = {
  get(k, def) { return (UserData.raw().settings || {})[k] ?? def; },
  set(k, v) {
    const data = UserData.raw();
    if (!data.settings) data.settings = {};
    data.settings[k] = v;
    data.settings._ts = Date.now();
    localStorage.setItem("agendamadrid_user", JSON.stringify(data));
    FirebaseSync.push(data);
  },
  getAll() { return UserData.raw().settings || {}; },
};

const THEMES = {
  madrid:  { label: "Madrid", emoji: "🔴", themeColor: "#b30012" },
  clasico: { label: "Clásico", emoji: "🟣", themeColor: "#381d92" },
  noche:   { label: "Noche", emoji: "🌙", themeColor: "#121212" },
};

function applyTheme(theme) {
  if (!THEMES[theme]) theme = "clasico";
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEMES[theme].themeColor);
  Settings.set("theme", theme);
  if (typeof renderUserView === "function" && typeof currentView !== "undefined" && currentView === "user") renderUserView();
}

function customDropdown(id, options, selectedValue, onChangeFn) {
  const sel = options.find(o => o.value === selectedValue);
  const label = sel ? sel.label : options[0]?.label || "";
  return `<div class="custom-dropdown" data-dd="${id}">
    <button class="custom-dropdown-trigger" onclick="toggleDropdown('${id}')">
      <span class="dd-label">${label}</span>
      <span class="dd-arrow">▼</span>
    </button>
    <div class="custom-dropdown-menu">
      ${options.map(o => `<button class="custom-dropdown-option${o.value === selectedValue ? " selected" : ""}" onclick="selectDropdown('${id}','${o.value}',${onChangeFn})">${o.label}</button>`).join("")}
    </div>
  </div>`;
}

function toggleDropdown(id) {
  const el = document.querySelector(`[data-dd="${id}"]`);
  const wasOpen = el.classList.contains("open");
  document.querySelectorAll(".custom-dropdown.open").forEach(d => d.classList.remove("open"));
  if (!wasOpen) el.classList.add("open");
}

function selectDropdown(id, value, fn) {
  document.querySelectorAll(".custom-dropdown.open").forEach(d => d.classList.remove("open"));
  fn(value);
}

document.addEventListener("click", e => {
  if (!e.target.closest(".custom-dropdown")) {
    document.querySelectorAll(".custom-dropdown.open").forEach(d => d.classList.remove("open"));
  }
});

const MAP_TILES = {
  light:   { label: "Claro",   url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" },
  dark:    { label: "Oscuro",  url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" },
  voyager: { label: "Voyager", url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" },
};

// Firebase sync (optional — works without login)
const FirebaseSync = (() => {
  const config = {
    apiKey: "AIzaSyD0aC_Nk9Yc8dEJ5ASEaFIvtu0fLArjslw",
    authDomain: "agenda-madrid.firebaseapp.com",
    projectId: "agenda-madrid",
    storageBucket: "agenda-madrid.firebasestorage.app",
    messagingSenderId: "1050271939703",
    appId: "1:1050271939703:web:c070e09d892608036a9a72",
  };

  let db = null, auth = null, user = null;
  let writeTimer = null;

  function init() {
    if (typeof firebase === "undefined") return;
    try {
      firebase.initializeApp(config);
      auth = firebase.auth();
      db = firebase.firestore();
      auth.onAuthStateChanged((u) => {
        user = u;
        _updateButton(u);
        if (u) {
          _pullAndMerge();
          if (typeof currentView !== "undefined" && currentView === "user") renderUserView();
        }
      });
    } catch (e) {
      console.error("Firebase init error:", e);
    }
  }

  const GOOGLE_CLIENT_ID = "1050271939703-1o3r44v8k4hqobbfo9b4rf17qa8gqqst.apps.googleusercontent.com";

  function login() {
    if (!auth) return;
    if (typeof google !== "undefined" && google.accounts) {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          try {
            const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
            await auth.signInWithCredential(credential);
          } catch (e) {
            console.error("Login error:", e);
          }
        },
        cancel_on_tap_outside: true,
      });
      google.accounts.id.prompt();
    } else {
      // fallback
      const provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider).catch((e) => {
        if (e.code !== "auth/popup-closed-by-user") console.error("Login error:", e);
      });
    }
  }

  async function logout() {
    if (!auth) return;
    await auth.signOut();
    _updateButton(null);
  }

  async function _pullAndMerge() {
    if (!user || !db) return;
    try {
      const doc = await db.collection("users").doc(user.uid).get();
      const remote = doc.exists ? doc.data() : {};
      const local = JSON.parse(localStorage.getItem("agendamadrid_user") || "{}");

      // Merge favorites/seen/dismissed by max timestamp
      const merged = { version: 1, favorites: {}, seen: {}, dismissed: {}, settings: local.settings || {} };
      for (const col of ["favorites", "seen", "dismissed"]) {
        const l = local[col] || {};
        const r = remote[col] || {};
        const allKeys = new Set([...Object.keys(l), ...Object.keys(r)]);
        for (const key of allKeys) {
          merged[col][key] = Math.max(l[key] || 0, r[key] || 0);
        }
      }
      // Settings: remote wins if newer (settings_ts is old Firestore format)
      const localTs = (local.settings || {})._ts || 0;
      const remoteTs = (remote.settings || {})._ts || remote.settings_ts || 0;
      if (remote.settings && remoteTs >= localTs) {
        merged.settings = remote.settings;
      }

      localStorage.setItem("agendamadrid_user", JSON.stringify(merged));
      await db.collection("users").doc(user.uid).set(merged);
      if (typeof render === "function") render();
      if (typeof renderUserView === "function" && typeof currentView !== "undefined" && currentView === "user") renderUserView();
    } catch (e) {
      console.error("Sync error:", e);
    }
  }

  function push(data) {
    if (!user || !db) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      db.collection("users").doc(user.uid).set(data).catch(() => {});
    }, 1000);
  }

  function _updateButton(u) {
    const btn = document.getElementById("btn-sync");
    const label = document.getElementById("sync-label");
    if (!btn) return;
    if (u) {
      btn.classList.add("logged-in");
      label.textContent = u.displayName ? u.displayName.split(" ")[0] : "Ajustes";
      if (u.photoURL) {
        let img = btn.querySelector(".sync-avatar");
        if (!img) {
          img = document.createElement("img");
          img.className = "sync-avatar";
          img.referrerPolicy = "no-referrer";
          btn.prepend(img);
        }
        img.src = u.photoURL;
      }
    } else {
      btn.classList.remove("logged-in");
      label.textContent = "Ajustes";
      const avatar = btn.querySelector(".sync-avatar");
      if (avatar) avatar.remove();
    }
  }

  return {
    init,
    login,
    logout,
    push,
    sync: _pullAndMerge,
    isLoggedIn: () => !!user,
    getUser: () => user,
  };
})();

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

const DAYS_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const CATEGORY_LABELS = {
  "musica": "música",
  "teatro": "teatro",
  "danza": "danza",
  "cine": "cine",
  "exposiciones": "exposiciones",
  "conferencias": "conferencias",
  "talleres": "talleres",
  "infantil": "infantil",
  "deportes": "deportes",
  "fiestas": "fiestas",
  "visitas guiadas": "visitas guiadas",
  "circo": "circo",
  "literatura": "literatura",
  "fotografia": "fotografía",
  "mercados": "mercados",
  "gastronomia": "gastronomía",
  "otros": "otros",
};

const SOURCE_LABELS = {
  "madrid_agenda": "datos.madrid.es",
  "esmadrid": "esmadrid.com",
  "teatros_canal": "teatroscanal.com",
};

const EXCLUDED_CATS = new Set(["gratis", "destacado", "aire libre", "accesible"]);

function fmtTime(t) {
  if (!t) return "";
  const p = t.split(":");
  return p.length >= 2 ? p[0].padStart(2, "0") + ":" + p[1] : "";
}
let selectedDate = (function() {
  // On initial load, prefer URL path (SEO entry point), then sessionStorage, then today
  const pathMatch = window.location.pathname.match(/\/(\d{4}-\d{2}-\d{2})\/?$/);
  if (pathMatch) {
    const parsed = new Date(pathMatch[1] + "T12:00:00");
    if (!isNaN(parsed)) return parsed;
  }
  const stored = sessionStorage.getItem("selectedDate");
  if (stored) {
    const parsed = new Date(stored + "T12:00:00");
    if (!isNaN(parsed)) return parsed;
  }
  return new Date();
})();
let allEvents = {};   // id -> event data
let calendarData = {}; // date -> [{event_id, start_time, end_time}]
let allData = [];      // flattened for backward compat (buildCategories)
let activeLocation = "";
let activeSource = "";
let activeSort = Settings.get("sort", "hora");
let activeUserFilter = sessionStorage.getItem("activeUserFilter") || "";
let currentView = sessionStorage.getItem("currentView") || "list";
let map = null, markersLayer = null, mapAutofit = false, tileLayer = null;
let picker = null;
let userLatLng = null;

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function updateDateLabel(count) {
  const month = MONTHS_ES[selectedDate.getMonth()];
  const label = `${DAYS_LONG[selectedDate.getDay()]} ${selectedDate.getDate()} de ${month.charAt(0).toUpperCase() + month.slice(1)}`;
  document.getElementById("current-date").textContent = label.charAt(0).toUpperCase() + label.slice(1);
  const countText = count === 0 ? "Sin eventos" : count === 1 ? "1 evento" : `${count} eventos`;
  document.getElementById("event-count-desktop").textContent = countText;
  document.getElementById("event-count-mobile").textContent = countText;
}

function changeDay(delta) {
  if (currentView === "cal") {
    selectedDate.setMonth(selectedDate.getMonth() + delta);
  } else {
    selectedDate.setDate(selectedDate.getDate() + delta);
  }
  syncPicker();
  render();
}

function syncPicker() {
  if (picker) picker.setDate(selectedDate, false);
  const di = document.getElementById("date-input");
  if (di) di.value = selectedDate.toISOString().split("T")[0];
}

async function init() {
  const dateInput = document.getElementById("date-input");
  const isMobile = window.matchMedia("(max-width: 640px)").matches;

  if (!isMobile) {
    picker = flatpickr("#date-input", {
      locale: "es",
      defaultDate: selectedDate,
      dateFormat: "Y-m-d",
      disableMobile: true,
      onChange(dates) {
        if (dates[0]) {
          selectedDate = dates[0];
          render();
        }
      },
    });
  } else {
    dateInput.type = "date";
    dateInput.value = selectedDate.toISOString().split("T")[0];
    dateInput.style.position = "absolute";
    dateInput.style.opacity = "0";
    dateInput.style.width = "100%";
    dateInput.style.height = "100%";
    dateInput.style.top = "0";
    dateInput.style.left = "0";
    dateInput.addEventListener("change", (e) => {
      if (e.target.value) {
        selectedDate = new Date(e.target.value + "T12:00:00");
        render();
      }
    });
  }

  document.getElementById("prev-day").addEventListener("click", () => changeDay(-1));
  document.getElementById("next-day").addEventListener("click", () => changeDay(1));

  document.getElementById("date-picker-btn").addEventListener("click", () => {
    if (isMobile) {
      dateInput.showPicker();
    } else {
      picker.open();
    }
  });

  document.getElementById("category-filter").addEventListener("change", () => {
    renderActiveFilters();
    render();
  });



  document.getElementById("btn-list").addEventListener("click", () => setView("list"));
  document.getElementById("btn-map").addEventListener("click", () => setView("map"));
  document.getElementById("btn-cal").addEventListener("click", () => setView("cal"));
  document.getElementById("btn-swipe").addEventListener("click", () => setView("swipe"));
  document.getElementById("btn-list-tab").addEventListener("click", () => setView("list"));
  document.getElementById("btn-map-tab").addEventListener("click", () => setView("map"));
  document.getElementById("btn-cal-tab").addEventListener("click", () => setView("cal"));
  document.getElementById("btn-swipe-tab").addEventListener("click", () => setView("swipe"));
  document.getElementById("btn-user-tab").addEventListener("click", () => setView("user"));

  document.getElementById("btn-today").addEventListener("click", () => {
    selectedDate = new Date();
    syncPicker();
    render();
  });

  document.getElementById("user-filter").addEventListener("change", (e) => {
    activeUserFilter = e.target.value;
    e.target.classList.toggle("active-filter", !!activeUserFilter);
    render();
  });

  // Event delegation for action buttons
  document.getElementById("events-container").addEventListener("click", (e) => {
    const btn = e.target.closest(".ev-action");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === "fav") {
      UserData.toggle("favorites", id);
      const isNowFav = UserData.has("favorites", id);
      btn.classList.toggle("active", isNowFav);
      const svg = btn.querySelector("svg path, svg");
      if (svg) svg.setAttribute("fill", isNowFav ? "currentColor" : "none");
    } else if (action === "seen" || action === "dismiss") {
      const collection = action === "seen" ? "seen" : "dismissed";
      UserData.toggle(collection, id);
      const card = btn.closest(".event-card");
      if (card && !activeUserFilter) {
        card.style.transition = "opacity 0.2s, transform 0.2s";
        card.style.opacity = "0";
        card.style.transform = "translateX(30px)";
        card.addEventListener("transitionend", () => render(), { once: true });
      } else {
        render();
      }
    }
  });

  document.getElementById("btn-sync").addEventListener("click", () => {
    setView("user");
  });
  FirebaseSync.init();

  syncPicker();
  locateUser();
  await loadData();

  // Apply saved theme
  const savedTheme = Settings.get("theme", "clasico");
  document.documentElement.setAttribute("data-theme", savedTheme);

  setView(currentView);
  document.body.classList.add("ready");

  // Swipe to change day on touch devices
  let touchStartX = 0, touchStartY = 0;
  const mainEl = document.querySelector("main");
  mainEl.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  mainEl.addEventListener("touchend", (e) => {
    if (currentView === "map") return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      changeDay(dx < 0 ? 1 : -1);
    }
  }, { passive: true });
}

function setView(view) {
  currentView = view;
  document.body.dataset.view = view;
  document.getElementById("btn-list").classList.toggle("active", view === "list");
  document.getElementById("btn-map").classList.toggle("active", view === "map");
  document.getElementById("btn-cal").classList.toggle("active", view === "cal");
  document.getElementById("btn-swipe").classList.toggle("active", view === "swipe");
  document.getElementById("btn-list-tab").classList.toggle("active", view === "list");
  document.getElementById("btn-map-tab").classList.toggle("active", view === "map");
  document.getElementById("btn-cal-tab").classList.toggle("active", view === "cal");
  document.getElementById("btn-swipe-tab").classList.toggle("active", view === "swipe");
  document.getElementById("btn-user-tab").classList.toggle("active", view === "user");
  document.getElementById("events-container").hidden = view !== "list";
  document.getElementById("map-container").hidden = view !== "map";
  document.getElementById("cal-container").hidden = view !== "cal";
  document.getElementById("user-container").hidden = view !== "user";
  document.getElementById("swipe-container").hidden = view !== "swipe";
  updateURL();

  if (view === "list") {
    renderEvents();
  } else if (view === "map") {
    if (!map) initMap();
    setTimeout(() => map.invalidateSize(), 50);
    renderMap();
    locateUser();
  } else if (view === "cal") {
    renderCalendar();
  } else if (view === "user") {
    renderUserView();
  } else if (view === "swipe") {
    renderSwipeView();
  }
}

function initMap() {
  const savedLat = parseFloat(sessionStorage.getItem("mlat"));
  const savedLng = parseFloat(sessionStorage.getItem("mlng"));
  const savedZ = parseInt(sessionStorage.getItem("mz"));
  const initCenter = (savedLat && savedLng && savedZ) ? [savedLat, savedLng] : [40.4168, -3.7038];
  const initZoom = savedZ || 13;
  mapAutofit = !(savedLat && savedLng && savedZ);
  map = L.map("map", { zoomSnap: 0.1, zoomDelta: 0.1, zoomControl: false }).setView(initCenter, initZoom);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  const LocateCtrl = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() {
      const btn = L.DomUtil.create("button", "map-locate-btn");
      btn.title = "Mi ubicación";
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>`;
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition((pos) => {
          userLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          map.setView([userLatLng.lat, userLatLng.lng], 15);
          render();
        }, () => {});
      });
      return btn;
    }
  });
  new LocateCtrl().addTo(map);
  const tileKey = Settings.get("mapTile", "voyager");
  tileLayer = L.tileLayer(MAP_TILES[tileKey]?.url || MAP_TILES.light.url, {
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  map.on("moveend", () => {
    const c = map.getCenter();
    sessionStorage.setItem("mlat", c.lat.toFixed(5));
    sessionStorage.setItem("mlng", c.lng.toFixed(5));
    sessionStorage.setItem("mz", map.getZoom());
  });

  const locationIcon = L.divIcon({
    className: "user-location",
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  if (userLatLng) {
    L.marker([userLatLng.lat, userLatLng.lng], { icon: locationIcon }).addTo(map);
    if (mapAutofit) map.setView([userLatLng.lat, userLatLng.lng], 15);
  }
}

function locateUser() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      render();
    },
    () => {}
  );
}

const CAT_ICONS = {
  musica:          { emoji: "🎵", color: "#7C3AED" },
  teatro:          { emoji: "🎭", color: "#1D4ED8" },
  exposiciones:    { emoji: "🏛️", color: "#0891B2" },
  infantil:        { emoji: "🧸", color: "#F59E0B" },
  deportes:        { emoji: "⚽", color: "#16A34A" },
  danza:           { emoji: "💃", color: "#DB2777" },
  cine:            { emoji: "🎬", color: "#374151" },
  gastronomia:     { emoji: "🍽️", color: "#EA580C" },
  fiestas:         { emoji: "🎉", color: "#DC2626" },
  talleres:        { emoji: "🔨", color: "#92400E" },
  mercados:        { emoji: "🛒", color: "#15803D" },
  "visitas guiadas": { emoji: "🗺️", color: "#1E40AF" },
  conferencias:    { emoji: "🎤", color: "#4338CA" },
  fotografia:      { emoji: "📷", color: "#6B7280" },
  literatura:      { emoji: "📖", color: "#7C2D12" },
  circo:           { emoji: "🤹", color: "#BE185D" },
  otros:           { emoji: "📌", color: "#6B7280" },
};


function renderMap() {
  if (!map || !markersLayer) return;
  markersLayer.clearLayers();

  const events = getFilteredDayEvents();
  updateDateLabel(events.length);
  const bounds = [];

  // Group events by location
  const byLocation = new Map();
  events.forEach(ev => {
    if (!ev.latitude || !ev.longitude) return;
    const lat = parseFloat(ev.latitude);
    const lng = parseFloat(ev.longitude);
    if (isNaN(lat) || isNaN(lng)) return;
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (!byLocation.has(key)) byLocation.set(key, { lat, lng, evs: [] });
    byLocation.get(key).evs.push(ev);
  });

  const PRIORITY = [
    "fotografia", "circo", "cine", "danza", "gastronomia",
    "deportes", "infantil", "mercados", "fiestas",
    "musica", "teatro", "talleres", "conferencias",
    "literatura", "visitas guiadas", "exposiciones", "otros",
  ];

  byLocation.forEach(({ lat, lng, evs }) => {
    bounds.push([lat, lng]);

    // Best category across all events at this location
    const allCats = evs.flatMap(ev => ev.categories || []);
    const bestCat = PRIORITY.find(p => allCats.includes(p)) || "otros";
    const location = evs[0].location_name || evs[0].location || "";

    // Deduplicate events by title, keep the one with the next upcoming time
    const now = new Date();
    const nowHHMM = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    const uniqueEvs = new Map();
    evs.forEach(ev => {
      const key = ev.title;
      const time = ev.start_time ? ev.start_time.slice(0, 5) : "";
      const existing = uniqueEvs.get(key);
      if (!existing) {
        uniqueEvs.set(key, ev);
      } else {
        const exTime = existing.start_time ? existing.start_time.slice(0, 5) : "";
        // Prefer the next upcoming time (>= now), or the earliest future one
        if (time >= nowHHMM && (exTime < nowHHMM || time < exTime)) {
          uniqueEvs.set(key, ev);
        }
      }
    });

    const evRows = [...uniqueEvs.values()].map(ev => {
      const time = ev.start_time ? ev.start_time.slice(0, 5) : "";
      const titleHtml = ev.url
        ? `<a href="${esc(ev.url)}" target="_blank" rel="noopener">${esc(ev.title)}</a>`
        : esc(ev.title);
      return `<div class="popup-event">
        <div class="popup-title">${time ? `<span class="popup-time">${esc(time)}</span> ` : ""}${titleHtml}</div>
      </div>`;
    }).join("");

    const popup = `<div class="map-popup">
      ${location ? `<div class="popup-location popup-venue">${esc(location)}</div>` : ""}
      ${evRows}
    </div>`;

    const { emoji } = CAT_ICONS[bestCat] || CAT_ICONS.otros;
    const icon = L.divIcon({
      html: `<div class="map-cat-icon">${emoji}</div>`,
      className: "",
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -14],
    });

    const marker = L.marker([lat, lng], { icon }).addTo(markersLayer);
    marker.bindPopup(popup);
  });

  if (mapAutofit) {
    mapAutofit = false;
    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [30, 30] });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else {
      map.setView([40.4168, -3.7038], 13);
    }
  }
}

async function loadData() {
  const container = document.getElementById("events-container");
  container.innerHTML = "<p class='empty-state'>Cargando...</p>";

  try {
    const [evRes, calRes] = await Promise.all([
      fetch("data/events.json"),
      fetch("data/calendar.json"),
    ]);
    allEvents = await evRes.json();
    calendarData = await calRes.json();

    // Build allData for categories (unique events)
    allData = Object.values(allEvents);
    buildCategories();
  } catch (e) {
    container.innerHTML = "<p class='empty-state'>Error al cargar eventos.</p>";
    console.error(e);
  }
}

function buildCategories() {
  const allCats = new Set();
  allData.forEach(ev => {
    (ev.categories || []).forEach(c => { if (c && !EXCLUDED_CATS.has(c)) allCats.add(c); });
  });

  const catSelect = document.getElementById("category-filter");
  [...allCats].sort((a, b) => (CATEGORY_LABELS[a] || a).localeCompare(CATEGORY_LABELS[b] || b)).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = CATEGORY_LABELS[c] || c;
    catSelect.appendChild(opt);
  });
}

function _applyCatFilter(events) {
  const cats = Settings.get("cats", []);
  if (!cats.length) return events;
  return events.filter(ev => (ev.categories || []).some(c => cats.includes(c)));
}

function _mergeEntryTimes(ev, entry) {
  // If the calendar entry has its own start_time, only use entry's end_time (not the event's),
  // since the event's end_time belongs to a different time context (e.g. exhibition closing hour).
  const start_time = entry.start_time || ev.start_time || null;
  const end_time = entry.start_time
    ? (entry.end_time || null)
    : (entry.end_time || ev.end_time || null);
  return { ...ev, start_time, end_time };
}

function _applyHidePast(events, ds) {
  if (!Settings.get("hidePast", true)) return events;
  if (ds !== dateStr(new Date())) return events;
  const now = new Date();
  const nowTime = now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
  return events.filter(ev => !ev.start_time || ev.start_time >= nowTime);
}

function _getDayEvents(ds) {
  const dayEntries = calendarData[ds] || [];
  let events = dayEntries.map(entry => {
    const ev = allEvents[entry.event_id];
    if (!ev) return null;
    return { ..._mergeEntryTimes(ev, entry), start_date: ds };
  }).filter(Boolean);
  events = _applyCatFilter(events);
  return _applyHidePast(events, ds);
}

function getFilteredDayEvents() {
  const selectedDateStr = dateStr(selectedDate);
  let filtered = _getDayEvents(selectedDateStr);

  if (activeUserFilter === "favorites") {
    filtered = filtered.filter(ev => UserData.has("favorites", ev.id));
  } else if (activeUserFilter === "seen") {
    filtered = filtered.filter(ev => UserData.has("seen", ev.id));
  } else if (activeUserFilter === "dismissed") {
    filtered = filtered.filter(ev => UserData.has("dismissed", ev.id));
  } else {
    filtered = filtered.filter(ev => !UserData.has("dismissed", ev.id) && !UserData.has("seen", ev.id));
  }

  if (activeLocation) {
    filtered = filtered.filter(ev => (ev.location_name || ev.location || "") === activeLocation);
  }

  if (activeSource) {
    filtered = filtered.filter(ev => (ev.source || "").split(",").includes(activeSource));
  }

  if (activeSort === "precio") {
    filtered.sort((a, b) => {
      const aFree = a.categories.includes("gratis") ? 0 : 1;
      const bFree = b.categories.includes("gratis") ? 0 : 1;
      return aFree - bFree || (a.start_time || "99:99").localeCompare(b.start_time || "99:99");
    });
  } else if (activeSort === "distancia") {
    filtered.sort((a, b) => {
      const da = (userLatLng && a.latitude && a.longitude)
        ? haversineDistance(userLatLng.lat, userLatLng.lng, parseFloat(a.latitude), parseFloat(a.longitude))
        : 99999;
      const db = (userLatLng && b.latitude && b.longitude)
        ? haversineDistance(userLatLng.lat, userLatLng.lng, parseFloat(b.latitude), parseFloat(b.longitude))
        : 99999;
      return da - db;
    });
  } else if (activeSort === "descripcion") {
    filtered.sort((a, b) => {
      const aHas = a.description ? 0 : 1;
      const bHas = b.description ? 0 : 1;
      return aHas - bHas || (a.start_time || "99:99").localeCompare(b.start_time || "99:99");
    });
  } else {
    filtered.sort((a, b) => {
      const ta = a.start_time || "99:99";
      const tb = b.start_time || "99:99";
      return ta.localeCompare(tb);
    });
  }
  return filtered;
}

function updateURL() {
  sessionStorage.setItem("selectedDate", dateStr(selectedDate));
  sessionStorage.setItem("currentView", currentView);
  if (activeUserFilter) {
    sessionStorage.setItem("activeUserFilter", activeUserFilter);
  } else {
    sessionStorage.removeItem("activeUserFilter");
  }
}

function render() {
  updateURL();
  if (currentView === "list") {
    renderEvents();
  } else if (currentView === "map") {
    renderMap();
  } else if (currentView === "cal") {
    renderCalendar();
  } else if (currentView === "swipe") {
    renderSwipeView();
  } else if (currentView === "user") {
    renderUserView();
  }
}

function renderEvents() {
  const container = document.getElementById("events-container");
  const dayEvents = getFilteredDayEvents();

  updateDateLabel(dayEvents.length);

  const filterLabels = { favorites: "Favoritos ♥", seen: "Vistos ✓", dismissed: "Ocultos ✕" };
  const filterChip = activeUserFilter
    ? `<div class="active-filter-banner">${filterLabels[activeUserFilter]} <button onclick="goToUserFilter('')">✕</button></div>`
    : "";

  if (!dayEvents.length) {
    container.innerHTML = filterChip + "<p class='empty-state'>No hay eventos para este dia.</p>";
    return;
  }

  container.innerHTML = filterChip + dayEvents.map(renderEvent).join("");
}

function renderEvent(ev) {
  const time = fmtTime(ev.start_time);
  const endTime = fmtTime(ev.end_time);
  const timeStr = time ? (endTime && endTime > time ? `${time} - ${endTime}` : time) : "";
  const location = ev.location_name || ev.location || "";

  const title = esc(ev.title);

  const desc = ev.description
    ? `<p class="event-desc">${esc(ev.description.length > 200 ? ev.description.slice(0, 200) + "..." : ev.description)}</p>`
    : "";
  const seenLabels = new Set();
  const catTags = ev.categories.filter(c => !EXCLUDED_CATS.has(c)).map(c => {
    const label = CATEGORY_LABELS[c] || c;
    if (seenLabels.has(label)) return "";
    seenLabels.add(label);
    return `<span class="tag">${esc(label)}</span>`;
  }).join("");
  const sourceTags = (ev.source || "").split(",").filter(Boolean).map(s => {
    const label = SOURCE_LABELS[s] || s;
    const sourceUrl = ev.source_url || "";
    if (sourceUrl) {
      return `<span class="tag tag-source tag-link" onclick="event.preventDefault(); event.stopPropagation(); window.open('${esc(sourceUrl)}', '_blank')">${esc(label)}</span>`;
    }
    return `<span class="tag tag-source">${esc(label)}</span>`;
  }).join("");
  const tags = catTags + sourceTags;

  const address = ev.address || "";
  let locationHtml = "";
  if (location || address) {
    const isLocActive = activeLocation === location;
    const locClass = location ? ` location-clickable${isLocActive ? ' location-active' : ''}` : '';
    const locClick = location ? ` onclick="event.preventDefault(); event.stopPropagation(); toggleLocation('${esc(location)}')"` : '';
    locationHtml = `<div class="event-location${locClass}"${locClick}><span class="location-pin">📍</span> ${esc([location, address].filter(Boolean).join(", "))}</div>`;
  }

  let distanceHtml = "";
  if (userLatLng && ev.latitude && ev.longitude) {
    const dist = haversineDistance(userLatLng.lat, userLatLng.lng, parseFloat(ev.latitude), parseFloat(ev.longitude));
    distanceHtml = `<span class="event-distance">📍 ${dist.toFixed(1)} km</span>`;
  }

  const hasFooter = locationHtml || tags || distanceHtml;

  const isFav = UserData.has("favorites", ev.id);
  const isSeen = UserData.has("seen", ev.id);
  const isDismissed = UserData.has("dismissed", ev.id);

  const actionsHtml = `<span class="event-actions">
    <button class="ev-action ev-fav${isFav ? ' active' : ''}" data-id="${esc(ev.id)}" data-action="fav" title="Favorito"><svg width="18" height="18" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>
    <button class="ev-action ev-seen${isSeen ? ' active' : ''}" data-id="${esc(ev.id)}" data-action="seen" title="Visto"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>
    <button class="ev-action ev-dismiss${isDismissed ? ' active' : ''}" data-id="${esc(ev.id)}" data-action="dismiss" title="Ocultar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </span>`;

  const cardContent = `
      <div class="event-header">
        <span class="event-title-wrap">
          ${timeStr ? `<span class="event-time">${esc(timeStr)}</span>` : ""}
          <span class="event-title">${title}</span>
        </span>
        ${distanceHtml}
        ${actionsHtml}
      </div>
      ${desc}
      ${hasFooter ? `<div class="event-footer">
        ${locationHtml}
        ${tags ? `<div class="event-tags">${tags}</div>` : ""}
      </div>` : ""}`;

  if (ev.url) {
    return `<a href="${esc(ev.url)}" target="_blank" rel="noopener" class="event-card event-card-link">${cardContent}</a>`;
  }
  return `<div class="event-card">${cardContent}</div>`;
}

function toggleLocation(loc) {
  activeLocation = activeLocation === loc ? "" : loc;
  renderActiveFilters();
  render();
}

function renderActiveFilters() {
  const container = document.getElementById("active-filters");
  const parts = [];
  if (activeUserFilter) {
    const labels = { favorites: "Favoritos ♥", seen: "Vistos ✓", dismissed: "Ocultos ✕" };
    parts.push(`<span class="tag tag-active" onclick="goToUserFilter('')">${labels[activeUserFilter] || activeUserFilter} ✕</span>`);
  }
  if (activeLocation) {
    parts.push(`<span class="tag tag-active" onclick="toggleLocation('${esc(activeLocation)}')">📍 ${esc(activeLocation)} ✕</span>`);
  }
  container.innerHTML = parts.join("");
}

function getEventsForDate(ds) {
  let events = _getDayEvents(ds);

  if (activeUserFilter === "favorites") {
    events = events.filter(ev => UserData.has("favorites", ev.id));
  } else if (activeUserFilter === "seen") {
    events = events.filter(ev => UserData.has("seen", ev.id));
  } else if (activeUserFilter === "dismissed") {
    events = events.filter(ev => UserData.has("dismissed", ev.id));
  } else {
    events = events.filter(ev => !UserData.has("dismissed", ev.id) && !UserData.has("seen", ev.id));
  }

  if (activeLocation) {
    events = events.filter(ev => (ev.location_name || ev.location || "") === activeLocation);
  }
  if (activeSource) {
    events = events.filter(ev => (ev.source || "").split(",").includes(activeSource));
  }
  return events;
}

function renderCalendar() {
  const container = document.getElementById("cal-container");
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const monthName = MONTHS_ES[month];

  // Update header to show month
  document.getElementById("current-date").textContent =
    `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  // Monday = 0 in our grid
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const todayStr = dateStr(new Date());
  const selectedStr = dateStr(selectedDate);

  const dayHeaders = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];
  let html = `<div class="cal-grid">`;
  html += dayHeaders.map(d => `<div class="cal-header">${d}</div>`).join("");

  // Empty cells before first day
  for (let i = 0; i < startDow; i++) {
    html += `<div class="cal-cell cal-empty"></div>`;
  }

  let monthTotal = 0;
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const events = getEventsForDate(ds);
    const count = events.length;
    monthTotal += count;
    const isToday = ds === todayStr;
    const isSelected = ds === selectedStr;

    let classes = "cal-cell";
    if (isToday) classes += " cal-today";
    if (isSelected) classes += " cal-selected";
    if (count === 0) classes += " cal-empty-day";

    const intensity = count === 0 ? "" : count < 5 ? " cal-low" : count < 20 ? " cal-med" : count < 50 ? " cal-high" : " cal-max";

    html += `<div class="${classes}${intensity}" onclick="calDayClick('${ds}')">
      <span class="cal-day-num">${day}</span>
      ${count > 0 ? `<span class="cal-count">${count}</span>` : ""}
    </div>`;
  }

  html += `</div>`;
  container.innerHTML = html;

  const countText = monthTotal === 0 ? "Sin eventos" : `${monthTotal} eventos`;
  document.getElementById("event-count-desktop").textContent = countText;
  document.getElementById("event-count-mobile").textContent = countText;
}

function calDayClick(ds) {
  selectedDate = new Date(ds + "T12:00:00");
  syncPicker();
  setView("list");
}

function renderUserView() {
  updateDateLabel(getFilteredDayEvents().length);
  const user = FirebaseSync.getUser();
  const currentTile = Settings.get("mapTile", "voyager");
  const hidePast = Settings.get("hidePast", true);
  const currentTheme = Settings.get("theme", "clasico");

  const tilesHtml = customDropdown("mapTile",
    Object.entries(MAP_TILES).map(([key, t]) => ({ value: key, label: t.label })),
    currentTile, "applyMapTile");

  const sources = [...new Set(allData.flatMap(ev => (ev.source || "").split(",").filter(Boolean)))].sort();
  const sourcesHtml = sources.length > 1;

  const profileHtml = user ? `
    <div class="user-profile-centered">
      <img src="${user.photoURL || ''}" class="user-avatar-large" alt="">
      <div class="user-profile-info">
        <div class="user-name">${user.displayName || ''}</div>
        <div class="user-email">${user.email || ''}</div>
      </div>
    </div>` : `
    <button class="btn-login" onclick="FirebaseSync.login()">Iniciar sesión con Google</button>`;

  const numFavs = Object.keys(UserData.getAll("favorites")).length;
  const numSeen = Object.keys(UserData.getAll("seen")).length;
  const numDismissed = Object.keys(UserData.getAll("dismissed")).length;
  const statsHtml = `
    <div class="user-stats">
      <button class="stat-card" onclick="goToUserFilter('favorites')">
        <span class="stat-label">Favoritos</span>
        <span class="stat-num">${numFavs}</span>
        <span class="stat-icon" style="color:#6b21a8;font-size:1.4rem">♥</span>
      </button>
      <button class="stat-card" onclick="goToUserFilter('seen')">
        <span class="stat-label">Vistos</span>
        <span class="stat-num">${numSeen}</span>
        <span class="stat-icon">👁</span>
      </button>
      <button class="stat-card" onclick="goToUserFilter('dismissed')">
        <span class="stat-label">Ocultos</span>
        <span class="stat-num">${numDismissed}</span>
        <span class="stat-icon">🚫</span>
      </button>
    </div>`;

  const allCats = [...new Set(allData.flatMap(ev => ev.categories || []))]
    .filter(c => !EXCLUDED_CATS.has(c))
    .sort((a, b) => (CATEGORY_LABELS[a] || a).localeCompare(CATEGORY_LABELS[b] || b));
  const prefCats = Settings.get("cats", []);
  const effectivePrefCats = prefCats.length === 0 ? allCats : prefCats;
  const catGridHtml = `
    <div class="cat-grid-circles">
      ${allCats.map(c => {
        const info = CAT_ICONS[c] || { emoji: "📍", color: "#6B7280" };
        const active = effectivePrefCats.includes(c);
        return `<button class="cat-circle${active ? " active" : ""}" onclick="toggleCatPref('${esc(c)}')">
          <span class="cat-circle-icon">${info.emoji}</span>
          <span class="cat-circle-label">${esc(CATEGORY_LABELS[c] || c)}</span>
        </button>`;
      }).join("")}
    </div>
  `;

  document.getElementById("user-container").innerHTML = `
    <div class="user-page">
      ${profileHtml}
      ${statsHtml}

      <section class="pref-section">
        <div class="pref-section-header">
          <h3>Mis Intereses</h3>
        </div>
        ${catGridHtml}
      </section>

      <section class="pref-section">
        <h3>Configuración</h3>
        <div class="setting-toggle-row">
          <div class="setting-toggle-text">
            <span class="setting-toggle-title">Ocultar eventos pasados</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${hidePast ? "checked" : ""} onchange="applyHidePast(this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="setting-grid">
          <div class="setting-grid-item">
            <span class="setting-grid-label">Ordenar por</span>
            ${customDropdown("sort", [
              { value: "hora", label: "Hora" },
              { value: "precio", label: "Precio" },
              { value: "distancia", label: "Distancia" },
            ], activeSort || "hora", "applySort")}
          </div>
          <div class="setting-grid-item">
            <span class="setting-grid-label">Tema visual</span>
            ${customDropdown("theme",
              Object.entries(THEMES).map(([key, t]) => ({ value: key, label: `${t.emoji} ${t.label}` })),
              currentTheme, "applyTheme")}
          </div>
          ${sourcesHtml ? `<div class="setting-grid-item">
            <span class="setting-grid-label">Fuente</span>
            ${customDropdown("source",
              [{ value: "", label: "Todas" }, ...sources.map(s => ({ value: s, label: SOURCE_LABELS[s] || s }))],
              activeSource || "", "applySource")}
          </div>` : ""}
          <div class="setting-grid-item">
            <span class="setting-grid-label">Estilo del mapa</span>
            ${tilesHtml}
          </div>
        </div>
      </section>

      <div class="user-actions-row">
        ${user ? `<button class="btn-logout" onclick="FirebaseSync.logout(); setView('list')">Cerrar sesión</button>` : ""}
        <button class="btn-logout btn-danger" onclick="resetUserData()">Resetear todo</button>
      </div>
    </div>
  `;
}

function showConfirm(msg, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.innerHTML = `<div class="confirm-dialog">
    <p>${msg}</p>
    <div class="confirm-actions">
      <button class="confirm-cancel">Cancelar</button>
      <button class="confirm-ok">Confirmar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("visible"));
  const close = () => { overlay.classList.remove("visible"); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector(".confirm-cancel").onclick = close;
  overlay.querySelector(".confirm-ok").onclick = () => { close(); onConfirm(); };
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
}

function resetUserData() {
  showConfirm("¿Resetear toda la configuración y datos a los valores por defecto?", () => {
    const data = { version: 1, favorites: {}, seen: {}, dismissed: {}, settings: {} };
    localStorage.setItem("agendamadrid_user", JSON.stringify(data));
    FirebaseSync.push(data);
    applyTheme("clasico");
    renderUserView();
  });
}

function goToUserFilter(filter) {
  activeUserFilter = filter;
  setView("list");
}

function applyMapTile(key) {
  Settings.set("mapTile", key);
  if (tileLayer) tileLayer.setUrl(MAP_TILES[key].url);
  renderUserView();
}

function applySource(val) {
  activeSource = val;
  renderUserView();
}

function applySort(val) {
  activeSort = val;
  Settings.set("sort", val);
  renderUserView();
}

function applyHidePast(val) {
  Settings.set("hidePast", val);
  renderUserView();
}

function toggleCatPref(cat) {
  const allAvail = [...new Set(allData.flatMap(ev => ev.categories || []))]
    .filter(c => !EXCLUDED_CATS.has(c));
  let cats = Settings.get("cats", []);
  if (cats.length === 0) cats = [...allAvail]; // expand "all" before modifying
  cats = cats.includes(cat) ? cats.filter(c => c !== cat) : [...cats, cat];
  if (cats.length === allAvail.length) cats = []; // back to "all" = empty
  Settings.set("cats", cats);
  render();
  renderUserView();
}

function mapAction(action, id, btn) {
  if (action === "fav") {
    UserData.toggle("favorites", id);
    btn.classList.toggle("active", UserData.has("favorites", id));
    const svg = btn.querySelector("svg path");
    if (svg) svg.setAttribute("fill", UserData.has("favorites", id) ? "currentColor" : "none");
  } else if (action === "seen") {
    UserData.toggle("seen", id);
    renderMap();
  } else if (action === "dismiss") {
    UserData.toggle("dismissed", id);
    renderMap();
  }
}

function decodeEntities(s) {
  const el = document.createElement("textarea");
  el.innerHTML = s;
  return el.value;
}

function esc(s) {
  const el = document.createElement("span");
  el.textContent = decodeEntities(s);
  return el.innerHTML.replace(/'/g, "&#39;");
}

init();

// ==============================
// SWIPE VIEW (Mix / Tinder mode)
// ==============================

let swipeQueue = [];
let swipeIndex = 0;
let swipeActive = false;

function _getSwipeEvents() {
  let events = _getDayEvents(dateStr(selectedDate));
  events = events.filter(ev => !UserData.has("favorites", ev.id) && !UserData.has("seen", ev.id) && !UserData.has("dismissed", ev.id));
  return events.sort((a, b) => (a.start_time || "99:99").localeCompare(b.start_time || "99:99"));
}

function renderSwipeView() {
  swipeQueue = _getSwipeEvents();
  swipeIndex = 0;
  swipeActive = false;
  updateDateLabel(swipeQueue.length);
  _buildSwipeDeck();
}

function _buildSwipeDeck() {
  const container = document.getElementById("swipe-container");
  if (!container) return;
  container.innerHTML = "";

  const remaining = swipeQueue.slice(swipeIndex);

  if (!remaining.length) {
    container.innerHTML = `
      <div class="swipe-empty">
        <div class="swipe-empty-icon">✅</div>
        <div class="swipe-empty-title">¡Todo clasificado!</div>
        <p>No quedan eventos por revisar</p>
        <div class="swipe-empty-actions">
          <button onclick="setView('list')">Ver lista</button>
          <button onclick="changeDay(1); renderSwipeView()">Siguiente día →</button>
        </div>
      </div>`;
    return;
  }

  // Deck wrapper for cards
  const deck = document.createElement("div");
  deck.className = "swipe-deck";
  container.appendChild(deck);

  // Render only the top card
  const ev0 = remaining[0];
  const hasImg = !!(Array.isArray(ev0.image) ? ev0.image[0] : ev0.image);
  const el = document.createElement("div");
  el.className = "swipe-card swipe-card-top" + (hasImg ? " swipe-card--has-img" : "");
  el.dataset.id = ev0.id;
  el.innerHTML = _swipeCardInner(ev0);
  deck.appendChild(el);

  // Update skip button fill (empties as you progress)
  const remaining_pct = ((swipeQueue.length - swipeIndex) / swipeQueue.length * 100).toFixed(1);
  requestAnimationFrame(() => {
    const skipBtn = document.querySelector('.swipe-btn-skip');
    if (skipBtn) skipBtn.style.setProperty("--skip-fill", remaining_pct + "%");
  });

  // Action bar below deck
  container.insertAdjacentHTML("beforeend", `
    <div class="swipe-actions-bar">
      <button class="swipe-btn swipe-btn-dismiss" onclick="triggerSwipe('left')" title="Ocultar">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <button class="swipe-btn swipe-btn-skip" onclick="triggerSwipe('up')" title="Saltar">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
      </button>
      <button class="swipe-btn swipe-btn-fav" onclick="triggerSwipe('right')" title="Favorito">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
    </div>`);

  _initSwipeDrag();
}

function _swipeCardInner(ev) {
  const cat = ev.categories?.[0] || "otros";
  const catInfo = CAT_ICONS[cat] || { emoji: "📍", color: "#6B7280" };
  const color = catInfo.color;

  const timeStr = (() => {
    const s = fmtTime(ev.start_time), e = fmtTime(ev.end_time);
    return s ? (e && e > s ? `${s} – ${e}` : s) : "";
  })();

  const price = ev.price || "";
  const priceLower = price.toLowerCase();
  const isFree = !price || price === "0" || price === "0.00" ||
    priceLower.includes("gratis") || priceLower.includes("gratuit") || priceLower.includes("entrada libre") || priceLower.includes("acceso libre");
  const shortPrice = (() => {
    if (isFree || !price) return "";
    if (price.length <= 30) return price;
    const m = price.match(/(\d+[\.,]?\d*)\s*€/);
    return m ? `Desde ${m[1]} €` : "De pago";
  })();
  const filteredCats = [...new Set(ev.categories)].filter(c => !EXCLUDED_CATS.has(c));
  const bestCat = filteredCats.length ? filteredCats[filteredCats.length - 1] : null;
  const catBadge = (bestCat && bestCat !== "otros") ? (() => {
    const info = CAT_ICONS[bestCat] || { emoji: "📍", color: "#6B7280" };
    return `<span class="swipe-info-badge swipe-info-badge-cat">${info.emoji} ${esc(CATEGORY_LABELS[bestCat] || bestCat)}</span>`;
  })() : "";

  const distBadge = (() => {
    if (!userLatLng || !ev.latitude || !ev.longitude) return "";
    const d = haversineDistance(userLatLng.lat, userLatLng.lng, parseFloat(ev.latitude), parseFloat(ev.longitude));
    return `<span class="swipe-info-badge swipe-info-badge-dist">📍 ${d.toFixed(1)} km</span>`;
  })();

  const imageUrl = Array.isArray(ev.image) ? ev.image[0] : ev.image;
  const hasImage = !!imageUrl;
  return `
    ${hasImage
      ? `<img class="swipe-card-img" src="${esc(imageUrl)}" alt="" loading="eager">`
      : `<div class="swipe-card-bg" style="background:linear-gradient(160deg,${color}cc 0%,${color}66 45%,${color}22 75%,#1a1a2e 100%)"></div>`}
    ${hasImage
      ? ``
      : `<div class="swipe-emoji-area"><span class="swipe-emoji-big">${catInfo.emoji}</span></div>`}
    <div class="swipe-info-badges">
      ${isFree ? '<span class="swipe-info-badge swipe-info-badge-free">Gratis</span>' : (shortPrice ? `<span class="swipe-info-badge">${esc(shortPrice)}</span>` : "")}
      ${distBadge}
      ${catBadge}
    </div>
    <div class="swipe-info">
      <div class="swipe-info-title">${esc(ev.title)}</div>
      <div class="swipe-info-meta">
        ${timeStr ? `<span>⏰ ${esc(timeStr)}</span>` : ""}
        ${ev.location_name ? `<span>📍 ${esc(ev.location_name)}${ev.district ? ` · ${esc(ev.district.replace(/([a-z])([A-Z])/g, "$1 $2"))}` : ""}</span>` : ""}
      </div>
      ${ev.description ? `<p class="swipe-info-desc">${esc(ev.description)}</p>` : ""}
    </div>
    ${ev.url ? `<a href="${esc(ev.url)}" target="_blank" rel="noopener" class="swipe-info-link" onclick="event.stopPropagation()">Ver más info</a>` : ""}
    <div class="swipe-overlay swipe-overlay-right"><span>❤️</span><span>Favorito</span></div>
    <div class="swipe-overlay swipe-overlay-left"><span>✕</span><span>Ocultar</span></div>
    <div class="swipe-overlay swipe-overlay-up"><span>→</span><span>Saltar</span></div>`;
}

function triggerSwipe(dir) {
  const card = document.querySelector(".swipe-card-top");
  if (!card || swipeActive) return;
  swipeActive = true;

  const id = card.dataset.id;
  let tx = 0, ty = 0, rot = 0;
  if (dir === "right") { tx = window.innerWidth + 200; ty = -50; rot = 20; }
  else if (dir === "left") { tx = -(window.innerWidth + 200); ty = -50; rot = -20; }
  else { ty = -(window.innerHeight + 200); }

  card.style.transition = "transform 0.38s ease, opacity 0.28s ease";
  card.style.transform = `translateX(${tx}px) translateY(${ty}px) rotate(${rot}deg)`;
  card.style.opacity = "0";

  if (dir === "right" && !UserData.has("favorites", id)) UserData.toggle("favorites", id);
  else if (dir === "left" && !UserData.has("dismissed", id)) UserData.toggle("dismissed", id);
  // up = skip (no classification)

  setTimeout(() => {
    swipeIndex++;
    swipeActive = false;
    _buildSwipeDeck();
  }, 360);
}

function _initSwipeDrag() {
  const card = document.querySelector(".swipe-card-top");
  if (!card) return;

  let startX = 0, startY = 0, dx = 0, dy = 0;
  let dragging = false, lockDir = null;

  const oRight = card.querySelector(".swipe-overlay-right");
  const oLeft  = card.querySelector(".swipe-overlay-left");
  const oUp    = card.querySelector(".swipe-overlay-up");

  function start(x, y) {
    if (swipeActive) return;
    startX = x; startY = y; dx = 0; dy = 0;
    dragging = true; lockDir = null;
    card.style.transition = "none";
  }

  function move(x, y) {
    if (!dragging) return;
    dx = x - startX;
    dy = y - startY;
    if (!lockDir && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      lockDir = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
    }
    // Allow both horizontal drags and upward drags (skip)
    if (lockDir === "v" && dy >= 0) return; // only block downward scrolls

    const rot = lockDir === "v" ? 0 : dx * 0.06;
    card.style.transform = `translateX(${dx}px) translateY(${dy < 0 ? dy : 0}px) rotate(${rot}deg)`;

    const T = 60;
    const isUp = dy < -T && Math.abs(dy) > Math.abs(dx);
    if (dx > T && !isUp) {
      oRight.style.opacity = Math.min((dx - T) / 80, 1);
      oLeft.style.opacity = 0; oUp.style.opacity = 0;
    } else if (dx < -T && !isUp) {
      oLeft.style.opacity = Math.min((-dx - T) / 80, 1);
      oRight.style.opacity = 0; oUp.style.opacity = 0;
    } else if (isUp) {
      oUp.style.opacity = Math.min((-dy - T) / 80, 1);
      oRight.style.opacity = 0; oLeft.style.opacity = 0;
    } else {
      oRight.style.opacity = 0; oLeft.style.opacity = 0; oUp.style.opacity = 0;
    }
  }

  function end() {
    if (!dragging) return;
    dragging = false;
    if (lockDir === "v" && dy >= 0) return;

    const T = 90;
    const isUp = dy < -T && Math.abs(dy) > Math.abs(dx);
    if (dx > T && !isUp) triggerSwipe("right");
    else if (dx < -T && !isUp) triggerSwipe("left");
    else if (isUp) triggerSwipe("up");
    else {
      card.style.transition = "transform 0.32s cubic-bezier(0.175,0.885,0.32,1.275)";
      card.style.transform = "";
      oRight.style.opacity = 0; oLeft.style.opacity = 0; oUp.style.opacity = 0;
    }
  }

  // Touch
  card.addEventListener("touchstart", e => {
    const t = e.touches[0]; start(t.clientX, t.clientY);
  }, { passive: true });

  card.addEventListener("touchmove", e => {
    const t = e.touches[0]; move(t.clientX, t.clientY);
    if (lockDir === "h" || (lockDir === "v" && dy < 0)) e.preventDefault();
  }, { passive: false });

  card.addEventListener("touchend", end, { passive: true });

  // Mouse (for desktop testing)
  card.addEventListener("mousedown", e => { start(e.clientX, e.clientY); e.preventDefault(); });
  document.addEventListener("mousemove", e => { if (dragging) move(e.clientX, e.clientY); });
  document.addEventListener("mouseup", () => { if (dragging) end(); });
}
