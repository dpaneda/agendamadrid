// User data management (localStorage)
const UserData = (() => {
  const KEY = "agendamadrid_user";

  function _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.version === 1) return data;
      }
    } catch (e) {}
    return { version: 1, favorites: {}, seen: {}, dismissed: {} };
  }

  function _save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
    FirebaseSync.push(data);
  }

  return {
    toggle(collection, id) {
      const data = _load();
      if (data[collection][id]) {
        delete data[collection][id];
      } else {
        data[collection][id] = Date.now();
      }
      _save(data);
    },
    has(collection, id) {
      return !!_load()[collection][id];
    },
    getAll(collection) {
      return _load()[collection] || {};
    },
  };
})();

const Settings = {
  _key: "agendamadrid_settings",
  get(k, def) { try { return (JSON.parse(localStorage.getItem(this._key)) || {})[k] ?? def; } catch { return def; } },
  set(k, v) { const s = this.getAll(); s[k] = v; localStorage.setItem(this._key, JSON.stringify(s)); },
  getAll() { try { return JSON.parse(localStorage.getItem(this._key)) || {}; } catch { return {}; } }
};

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
      db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
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

      const merged = { version: 1, favorites: {}, seen: {}, dismissed: {} };
      for (const col of ["favorites", "seen", "dismissed"]) {
        const l = local[col] || {};
        const r = remote[col] || {};
        const allKeys = new Set([...Object.keys(l), ...Object.keys(r)]);
        for (const key of allKeys) {
          merged[col][key] = Math.max(l[key] || 0, r[key] || 0);
        }
      }

      localStorage.setItem("agendamadrid_user", JSON.stringify(merged));
      await db.collection("users").doc(user.uid).set(merged);
      if (typeof render === "function") render();
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
      label.textContent = u.displayName ? u.displayName.split(" ")[0] : "Login";
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
      label.textContent = "Login";
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
  "infantil": "infantil y familiar",
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

const _initParams = new URLSearchParams(window.location.search);
let selectedDate = (function() {
  const pathMatch = window.location.pathname.match(/\/(\d{4}-\d{2}-\d{2})\/?$/);
  if (pathMatch) {
    const parsed = new Date(pathMatch[1] + "T12:00:00");
    if (!isNaN(parsed)) return parsed;
  }
  return new Date();
})();
let allEvents = {};   // id -> event data
let calendarData = {}; // date -> [{event_id, start_time, end_time}]
let allData = [];      // flattened for backward compat (buildCategories)
let activeTags = new Set();
let activeLocation = "";
let activeSource = "";
let activeSort = Settings.get("sort", "hora");
let activeUserFilter = "";
let currentView = "list";
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

  document.getElementById("category-filter").addEventListener("change", (e) => {
    const val = e.target.value;
    activeTags.clear();
    if (val) {
      activeTags.add(val);
    }
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
      btn.classList.toggle("active", UserData.has("favorites", id));
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
    if (FirebaseSync.isLoggedIn()) {
      setView("user");
    } else {
      FirebaseSync.login();
    }
  });
  FirebaseSync.init();

  syncPicker();
  locateUser();
  await loadData();

  // Restore filters from URL
  const initCat = _initParams.get("cat");
  if (initCat) {
    activeTags.add(initCat);
    document.getElementById("category-filter").value = initCat;
    renderActiveFilters();
  }

  const initUserFilter = _initParams.get("uf");
  if (initUserFilter) {
    activeUserFilter = initUserFilter;
    document.getElementById("user-filter").value = initUserFilter;
    document.getElementById("user-filter").classList.add("active-filter");
  }
  const initLoc = _initParams.get("loc");
  if (initLoc) {
    activeLocation = initLoc;
    renderActiveFilters();
  }
  const initView = _initParams.get("view");
  if (initView && ["map", "cal"].includes(initView)) {
    setView(initView);
  } else if (initView === "user" && FirebaseSync.isLoggedIn()) {
    setView("user");
  } else {
    render();
  }

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
  const savedLat = parseFloat(_initParams.get("mlat"));
  const savedLng = parseFloat(_initParams.get("mlng"));
  const savedZ = parseInt(_initParams.get("mz"));
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
    const url = new URL(window.location);
    url.searchParams.set("mlat", c.lat.toFixed(5));
    url.searchParams.set("mlng", c.lng.toFixed(5));
    url.searchParams.set("mz", map.getZoom());
    history.replaceState(null, "", url);
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
  otros:           { emoji: "📍", color: "#6B7280" },
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

    const evRows = evs.map(ev => {
      const time = ev.start_time ? ev.start_time.slice(0, 5) : "";
      const titleHtml = ev.url
        ? `<a href="${esc(ev.url)}" target="_blank" rel="noopener">${esc(ev.title)}</a>`
        : esc(ev.title);
      const mapFav = UserData.has("favorites", ev.id);
      const mapSeen = UserData.has("seen", ev.id);
      return `<div class="popup-event">
        <div class="popup-title">${titleHtml}</div>
        ${time ? `<div class="popup-meta">${esc(time)}</div>` : ""}
        <div class="popup-actions">
          <button class="ev-action ev-fav${mapFav ? ' active' : ''}" onclick="mapAction('fav','${esc(ev.id)}',this)" title="Favorito"><svg width="16" height="16" viewBox="0 0 24 24" fill="${mapFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>
          <button class="ev-action ev-seen${mapSeen ? ' active' : ''}" onclick="mapAction('seen','${esc(ev.id)}',this)" title="Visto"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>
          <button class="ev-action ev-dismiss" onclick="mapAction('dismiss','${esc(ev.id)}',this)" title="Ocultar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
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
  const EXCLUDED = new Set(["gratis", "destacado", "aire libre", "accesible"]);
  const allCats = new Set();
  allData.forEach(ev => {
    (ev.categories || []).forEach(c => { if (c && !EXCLUDED.has(c)) allCats.add(c); });
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

function getFilteredDayEvents() {
  const selectedDateStr = dateStr(selectedDate);
  const dayEntries = calendarData[selectedDateStr] || [];

  // Join calendar entries with event data
  let filtered = dayEntries.map(entry => {
    const ev = allEvents[entry.event_id];
    if (!ev) return null;
    return {
      ...ev,
      start_date: selectedDateStr,
      start_time: entry.start_time || ev.start_time || null,
      end_time: entry.end_time || ev.end_time || null,
    };
  }).filter(Boolean);

  filtered = _applyCatFilter(filtered);

  if (activeUserFilter === "favorites") {
    filtered = filtered.filter(ev => UserData.has("favorites", ev.id));
  } else if (activeUserFilter === "seen") {
    filtered = filtered.filter(ev => UserData.has("seen", ev.id));
  } else if (activeUserFilter === "dismissed") {
    filtered = filtered.filter(ev => UserData.has("dismissed", ev.id));
  } else {
    filtered = filtered.filter(ev => !UserData.has("dismissed", ev.id) && !UserData.has("seen", ev.id));
  }

  if (activeTags.size > 0) {
    filtered = filtered.filter(ev =>
      [...activeTags].every(tag => ev.categories.includes(tag))
    );
  }


  if (activeLocation) {
    filtered = filtered.filter(ev => (ev.location_name || ev.location || "") === activeLocation);
  }

  if (activeSource) {
    filtered = filtered.filter(ev => (ev.source || "").split(",").includes(activeSource));
  }

  if (Settings.get("hidePast", true) && dateStr(selectedDate) === dateStr(new Date())) {
    const now = new Date();
    const nowTime = now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
    filtered = filtered.filter(ev => !ev.start_time || ev.start_time >= nowTime);
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
  const ds = dateStr(selectedDate);
  const today = dateStr(new Date());
  const basePath = ds === today ? "/" : `/${ds}/`;
  const url = new URL(window.location.origin + basePath);

  if (activeTags.size === 1) url.searchParams.set("cat", [...activeTags][0]);
  else url.searchParams.delete("cat");

  if (activeSource) url.searchParams.set("source", activeSource);
  else url.searchParams.delete("source");


  if (activeLocation) url.searchParams.set("loc", activeLocation);
  else url.searchParams.delete("loc");

  if (activeUserFilter) url.searchParams.set("uf", activeUserFilter);
  else url.searchParams.delete("uf");

  if (currentView !== "list") url.searchParams.set("view", currentView);
  else url.searchParams.delete("view");


  if (currentView !== "map") {
    url.searchParams.delete("mlat");
    url.searchParams.delete("mlng");
    url.searchParams.delete("mz");
  }

  history.replaceState(null, "", url);
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
  const fmtTime = (t) => {
    if (!t) return "";
    const parts = t.split(":");
    return parts.length >= 2 ? parts[0].padStart(2, "0") + ":" + parts[1] : "";
  };
  const time = fmtTime(ev.start_time);
  const endTime = fmtTime(ev.end_time);
  const timeStr = time ? (endTime ? `${time} - ${endTime}` : time) : "";
  const location = ev.location_name || ev.location || "";

  const title = esc(ev.title);

  const desc = ev.description
    ? `<p class="event-desc">${esc(ev.description.length > 200 ? ev.description.slice(0, 200) + "..." : ev.description)}</p>`
    : "";

  const seenLabels = new Set();
  const catTags = ev.categories.map(c => {
    const label = CATEGORY_LABELS[c] || c;
    if (seenLabels.has(label)) return "";
    seenLabels.add(label);
    const isActive = activeTags.has(c);
    return `<span class="tag tag-clickable${isActive ? ' tag-active' : ''}" onclick="event.preventDefault(); event.stopPropagation(); toggleTag('${esc(c)}')">${esc(label)}</span>`;
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

function toggleTag(tag) {
  if (activeTags.has(tag)) {
    activeTags.delete(tag);
  } else {
    activeTags.clear();
    activeTags.add(tag);
  }
  document.getElementById("category-filter").value = activeTags.size === 1 ? [...activeTags][0] : "";
  renderActiveFilters();
  render();
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
  [...activeTags].forEach(tag => {
    const label = CATEGORY_LABELS[tag] || tag;
    parts.push(`<span class="tag tag-active" onclick="toggleTag('${esc(tag)}')">${esc(label)} ✕</span>`);
  });
  container.innerHTML = parts.join("");
}

function getEventsForDate(ds) {
  const dayEntries = calendarData[ds] || [];
  let events = dayEntries.map(entry => {
    const ev = allEvents[entry.event_id];
    if (!ev) return null;
    return { ...ev, start_date: ds, start_time: entry.start_time || ev.start_time || null };
  }).filter(Boolean);

  events = _applyCatFilter(events);

  if (activeUserFilter === "favorites") {
    events = events.filter(ev => UserData.has("favorites", ev.id));
  } else if (activeUserFilter === "seen") {
    events = events.filter(ev => UserData.has("seen", ev.id));
  } else if (activeUserFilter === "dismissed") {
    events = events.filter(ev => UserData.has("dismissed", ev.id));
  } else {
    events = events.filter(ev => !UserData.has("dismissed", ev.id) && !UserData.has("seen", ev.id));
  }

  if (activeTags.size > 0) {
    events = events.filter(ev => [...activeTags].every(tag => ev.categories.includes(tag)));
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
  const user = FirebaseSync.getUser();
  const currentTile = Settings.get("mapTile", "voyager");
  const hidePast = Settings.get("hidePast", true);

  const tilesHtml = `<select onchange="applyMapTile(this.value)">
    ${Object.entries(MAP_TILES).map(([key, t]) => `<option value="${key}"${key === currentTile ? " selected" : ""}>${t.label}</option>`).join("")}
  </select>`;

  const sources = [...new Set(allData.flatMap(ev => (ev.source || "").split(",").filter(Boolean)))].sort();
  const sourcesHtml = sources.length > 1 ? `
    <label class="setting-row">
      <span>Fuente <small>(debug)</small></span>
      <select onchange="applySource(this.value)">
        <option value="">Todas</option>
        ${sources.map(s => `<option value="${s}"${activeSource === s ? " selected" : ""}>${SOURCE_LABELS[s] || s}</option>`).join("")}
      </select>
    </label>` : "";

  const profileHtml = user ? `
    <div class="user-header">
      <img src="${user.photoURL || ''}" class="user-avatar-large" alt="">
      <div>
        <div class="user-name">${user.displayName || ''}</div>
        <div class="user-email">${user.email || ''}</div>
      </div>
    </div>` : `
    <button class="btn-login" onclick="FirebaseSync.login()">Iniciar sesión con Google</button>`;

  const EXCLUDED_TAGS = new Set(["gratis", "destacado", "aire libre", "accesible"]);
  const allCats = [...new Set(allData.flatMap(ev => ev.categories || []))]
    .filter(c => !EXCLUDED_TAGS.has(c))
    .sort((a, b) => (CATEGORY_LABELS[a] || a).localeCompare(CATEGORY_LABELS[b] || b));
  const prefCats = Settings.get("cats", []);
  const catGridHtml = `
    <div class="cat-grid">
      ${allCats.map(c => `<button class="cat-pill${prefCats.includes(c) ? " active" : ""}" onclick="toggleCatPref('${esc(c)}')">${esc(CATEGORY_LABELS[c] || c)}</button>`).join("")}
    </div>
    ${prefCats.length ? `<p class="setting-hint">${prefCats.length} seleccionadas — el resto no se muestra</p>` : `<p class="setting-hint">Sin selección = todas visibles</p>`}
  `;

  const statsHtml = `
    <div class="user-stats">
      <button class="stat-card" onclick="goToUserFilter('favorites')">
        <span class="stat-num">${Object.keys(UserData.getAll("favorites")).length}</span>
        <span class="stat-label">Favoritos ♥</span>
      </button>
      <button class="stat-card" onclick="goToUserFilter('seen')">
        <span class="stat-num">${Object.keys(UserData.getAll("seen")).length}</span>
        <span class="stat-label">Vistos ✓</span>
      </button>
      <button class="stat-card" onclick="goToUserFilter('dismissed')">
        <span class="stat-num">${Object.keys(UserData.getAll("dismissed")).length}</span>
        <span class="stat-label">Ocultos ✕</span>
      </button>
    </div>`;

  document.getElementById("user-container").innerHTML = `
    <div class="user-page">
      ${profileHtml}
      ${statsHtml}
      <section class="user-settings">
        <h3>Categorías</h3>
        ${catGridHtml}
        <h3>Preferencias</h3>
        <div class="setting-row">
          <span>Ocultar eventos pasados</span>
          <input type="checkbox" ${hidePast ? "checked" : ""} onchange="applyHidePast(this.checked)">
        </div>
        <label class="setting-row">
          <span>Ordenar por</span>
          <select onchange="applySort(this.value)">
            <option value="hora"${activeSort === "hora" ? " selected" : ""}>Hora</option>
            <option value="precio"${activeSort === "precio" ? " selected" : ""}>Precio</option>
            <option value="distancia"${activeSort === "distancia" ? " selected" : ""}>Distancia</option>
          </select>
        </label>
        ${sourcesHtml}
        <label class="setting-row">
          <span>Estilo del mapa</span>
          ${tilesHtml}
        </label>
      </section>
      ${user ? `<button class="btn-logout" onclick="FirebaseSync.logout(); setView('list')">Cerrar sesión</button>` : ""}
    </div>
  `;
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

function applyCategory(val) {
  activeTags = val ? new Set([val]) : new Set();
  setView("list");
}

function toggleCatPref(cat) {
  let cats = Settings.get("cats", []);
  cats = cats.includes(cat) ? cats.filter(c => c !== cat) : [...cats, cat];
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
  const ds = dateStr(selectedDate);
  const dayEntries = calendarData[ds] || [];
  return dayEntries
    .map(entry => {
      const ev = allEvents[entry.event_id];
      if (!ev) return null;
      return { ...ev, start_date: ds, start_time: entry.start_time || ev.start_time || null, end_time: entry.end_time || ev.end_time || null };
    })
    .filter(Boolean)
    .filter(ev => !UserData.has("favorites", ev.id) && !UserData.has("seen", ev.id) && !UserData.has("dismissed", ev.id))
    .filter(ev => _applyCatFilter([ev]).length > 0)
    .sort((a, b) => (a.start_time || "99:99").localeCompare(b.start_time || "99:99"));
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

  // Action bar (always present)
  container.insertAdjacentHTML("beforeend", `
    <div class="swipe-actions-bar">
      <button class="swipe-btn swipe-btn-dismiss" onclick="triggerSwipe('left')" title="Ocultar">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <button class="swipe-btn swipe-btn-seen" onclick="triggerSwipe('up')" title="Visto">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <button class="swipe-btn swipe-btn-fav" onclick="triggerSwipe('right')" title="Favorito">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
    </div>`);

  if (!remaining.length) {
    const done = swipeQueue.length;
    container.insertAdjacentHTML("afterbegin", `
      <div class="swipe-empty">
        <div class="swipe-empty-icon">✨</div>
        <div class="swipe-empty-title">¡Ya los has visto todos!</div>
        <p>${done} evento${done !== 1 ? "s" : ""} para hoy</p>
        <button onclick="setView('list')">Ver lista completa</button>
      </div>`);
    return;
  }

  // Render up to 3 cards; top card is last in DOM (highest z-index)
  const visible = remaining.slice(0, 3).reverse();
  visible.forEach((ev, i) => {
    const stackPos = visible.length - 1 - i; // 0 = top
    const el = document.createElement("div");
    el.className = "swipe-card" + (stackPos === 0 ? " swipe-card-top" : "");
    el.dataset.id = ev.id;
    el.innerHTML = _swipeCardInner(ev);
    if (stackPos === 1) el.style.cssText = "transform: scale(0.95) translateY(16px); z-index: 3;";
    if (stackPos === 2) el.style.cssText = "transform: scale(0.90) translateY(32px); z-index: 2;";
    container.appendChild(el);
  });

  // Top bar (back + counter) — above cards
  container.insertAdjacentHTML("beforeend", `
    <div class="swipe-top-bar">
      <button class="swipe-back-btn" onclick="setView('list')" title="Volver">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="swipe-counter">${swipeIndex + 1} / ${swipeQueue.length}</span>
    </div>`);

  _initSwipeDrag();
}

function _swipeCardInner(ev) {
  const cat = ev.categories?.[0] || "otros";
  const catInfo = CAT_ICONS[cat] || { emoji: "📍", color: "#6B7280" };
  const color = catInfo.color;

  const fmtTime = (t) => {
    if (!t) return "";
    const p = t.split(":");
    return p.length >= 2 ? p[0].padStart(2, "0") + ":" + p[1] : "";
  };
  const timeStr = (() => {
    const s = fmtTime(ev.start_time), e = fmtTime(ev.end_time);
    return s ? (e ? `${s} – ${e}` : s) : "";
  })();

  const price = ev.price || "";
  const isFree = !price || price === "0" || price === "0.00" ||
    price.toLowerCase().includes("gratis") || price.toLowerCase().includes("gratuito");
  const isFav = UserData.has("favorites", ev.id);

  const catBadges = [...new Set(ev.categories)].map(c => {
    const info = CAT_ICONS[c] || { emoji: "📍", color: "#6B7280" };
    return `<span class="swipe-info-badge swipe-info-badge-cat">${info.emoji} ${esc(CATEGORY_LABELS[c] || c)}</span>`;
  }).join("");

  const distBadge = (() => {
    if (!userLatLng || !ev.latitude || !ev.longitude) return "";
    const d = haversineDistance(userLatLng.lat, userLatLng.lng, parseFloat(ev.latitude), parseFloat(ev.longitude));
    return `<span class="swipe-info-badge swipe-info-badge-dist">📍 ${d.toFixed(1)} km</span>`;
  })();

  return `
    <div class="swipe-card-bg" style="background:linear-gradient(160deg,${color}cc 0%,${color}66 45%,${color}22 75%,#1a1a2e 100%)"></div>
    <div class="swipe-emoji-area">
      <span class="swipe-emoji-big">${catInfo.emoji}</span>
    </div>
    <div class="swipe-info">
      <div class="swipe-info-badges">
        ${isFree ? '<span class="swipe-info-badge swipe-info-badge-free">Gratis</span>' : (price ? `<span class="swipe-info-badge swipe-info-badge-price">${esc(price)}</span>` : "")}
        ${distBadge}
        ${isFav ? '<span class="swipe-info-badge swipe-info-badge-fav">❤️ Guardado</span>' : ""}
        ${catBadges}
      </div>
      <div class="swipe-info-title">${esc(ev.title)}</div>
      <div class="swipe-info-meta">
        ${timeStr ? `<span>⏰ ${esc(timeStr)}</span>` : ""}
        ${ev.location_name ? `<span>📍 ${esc(ev.location_name)}${ev.address ? `, ${esc(ev.address)}` : ""}</span>` : ""}
      </div>
      ${ev.description ? `<p class="swipe-info-desc">${esc(ev.description)}</p>` : ""}
      ${ev.url ? `<a href="${esc(ev.url)}" target="_blank" rel="noopener" class="swipe-info-link" onclick="event.stopPropagation()">Ver más info →</a>` : ""}
    </div>
    <div class="swipe-overlay swipe-overlay-right"><span>❤️</span><span>Favorito</span></div>
    <div class="swipe-overlay swipe-overlay-left"><span>✕</span><span>Ocultar</span></div>
    <div class="swipe-overlay swipe-overlay-up"><span>✓</span><span>Visto</span></div>`;
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
  else if (dir === "up" && !UserData.has("seen", id)) UserData.toggle("seen", id);

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
    if (lockDir === "v") return;

    const rot = dx * 0.06;
    card.style.transform = `translateX(${dx}px) translateY(${dy}px) rotate(${rot}deg)`;

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
    if (lockDir === "v") return;

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
    if (lockDir === "h") e.preventDefault();
  }, { passive: false });

  card.addEventListener("touchend", end, { passive: true });

  // Mouse (for desktop testing)
  card.addEventListener("mousedown", e => { start(e.clientX, e.clientY); e.preventDefault(); });
  document.addEventListener("mousemove", e => { if (dragging) move(e.clientX, e.clientY); });
  document.addEventListener("mouseup", () => { if (dragging) end(); });
}
