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
  "teatro": "teatro",
  "monólogos": "monólogos",
  "danza": "danza",
  "circo": "circo",
  "conciertos": "conciertos",
  "ópera": "ópera",
  "cine": "cine",
  "exposiciones": "exposiciones",
  "literatura": "literatura",
  "talleres": "talleres",
  "conferencias": "conferencias",
  "visitas guiadas": "visitas guiadas",
  "infantil": "infantil",
  "deportes": "deportes",
  "ferias": "ferias",
  "otros": "otros",
  "gratis": "gratis",
  "aire libre": "aire libre",
  "accesible": "accesible",
  "destacado": "destacado",
  "fotografía": "fotografía",
  "gastronomía": "gastronomía",
  "literatura": "literatura",
  "mercados": "mercados",
  "fiestas": "fiestas",
  "musicales": "musicales",
  "flamenco": "flamenco",
  "magia": "magia",
  // Legacy
  "musica": "música",
  "fotografia": "fotografía",
};

const SOURCE_LABELS = {
  "madrid_agenda": "datos.madrid.es",
  "esmadrid": "esmadrid.com",
  "teatros_canal": "teatroscanal.com",
};

const TAG_CATS = new Set(["gratis", "destacado", "aire libre", "accesible", "infantil", "visitas guiadas", "danza", "circo", "ópera", "monólogos", "cine", "fotografía", "gastronomía", "literatura", "mercados", "fiestas", "musicales", "flamenco", "magia"]);
const MAIN_CATS = ["exposiciones","teatro","conciertos","ferias","conferencias","talleres","deportes","otros"];
const TAG_ORDER = ["infantil","aire libre","danza","circo","ópera","monólogos","cine","visitas guiadas","fotografía","gastronomía","literatura","mercados","fiestas","musicales","flamenco","magia"];
const CAT_PRIORITY = ["deportes","ferias","conciertos","teatro","talleres","conferencias","musica","fotografia","exposiciones"];

function eventBadges(ev, cls) {
  const price = ev.price || "";
  const priceLower = price.toLowerCase();
  const isFree = ev.is_free || !price || price === "0" || price === "0.00" ||
    priceLower.includes("gratis") || priceLower.includes("gratuit") || priceLower.includes("entrada libre") || priceLower.includes("acceso libre");
  const shortPrice = (() => {
    if (isFree || !price) return "";
    if (/consultar|p[aá]gina oficial/i.test(price)) return "";
    if (price.length <= 30) return price;
    const m = price.match(/(\d+[\.,]?\d*)\s*€/);
    return m ? `Desde ${m[1]} €` : "De pago";
  })();
  const priceBadge = isFree ? `<span class="${cls} ${cls}-free">Gratis</span>` : (shortPrice ? `<span class="${cls} ${cls}-price">💰 ${esc(shortPrice)}</span>` : "");

  let distBadge = "";
  if (userLatLng && ev.latitude && ev.longitude) {
    const d = haversineDistance(userLatLng.lat, userLatLng.lng, parseFloat(ev.latitude), parseFloat(ev.longitude));
    distBadge = `<span class="${cls} ${cls}-dist">📍 ${d.toFixed(1)} km</span>`;
  }

  const filteredCats = (ev.categories || []).filter(c => !TAG_CATS.has(c));
  const catBadges = filteredCats.map(c => {
    const info = CAT_ICONS[c] || { emoji: "📍", color: "#6B7280" };
    return `<span class="${cls} ${cls}-cat">${info.emoji} ${esc(CATEGORY_LABELS[c] || c)}</span>`;
  }).join("");

  return { priceBadge, distBadge, catBadge: catBadges, isFree };
}

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
let activeSource = Settings.get("source", "esmadrid");
let activeSort = Settings.get("sort", "hora");
let activeUserFilter = sessionStorage.getItem("activeUserFilter") || "";
let activeSearch = "";
let activeCatFilter = [];
let activeTagFilter = [];
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

  document.getElementById("filter-toggle-btn").addEventListener("click", toggleFilterPanel);
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("filter-panel");
    if (panel && !panel.contains(e.target) && !e.target.closest("#filter-toggle-btn")) {
      panel.remove();
    }
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

  // Search
  const searchBar = document.getElementById("search-bar");
  const searchInput = document.getElementById("search-input");
  const dateNav = document.querySelector(".date-nav");
  let searchDebounce = null;

  function openSearch() {
    dateNav.style.display = "none";
    searchBar.style.display = "";
    searchInput.focus();
  }

  function closeSearch() {
    searchBar.style.display = "none";
    dateNav.style.display = "";
    searchInput.value = "";
    activeSearch = "";
    render();
  }

  function doSearch() {
    activeSearch = searchInput.value.trim().toLowerCase();
    if (!activeSearch) { render(); return; }
    if (currentView === "map") { renderMap(); return; }
    if (currentView === "cal") { renderCalendar(); return; }
    renderSearchList();
  }

  let _searchResults = [];
  const SEARCH_PAGE = 50;

  function renderSearchList() {
    const container = document.getElementById("events-container");
    // Search unique events, not calendar entries
    const seen = new Set();
    _searchResults = [];
    for (const [eid, ev] of Object.entries(allEvents)) {
      if (seen.has(eid) || !matchesSearch(ev)) continue;
      seen.add(eid);
      // Find first calendar date for this event
      const firstDate = Object.keys(calendarData).sort().find(ds =>
        (calendarData[ds] || []).some(e => e.event_id === eid));
      const entry = firstDate ? (calendarData[firstDate] || []).find(e => e.event_id === eid) : {};
      _searchResults.push({ ...ev, ...entry, id: eid, start_date: firstDate || "" });
    }
    if (!_searchResults.length) {
      container.innerHTML = `<p class='empty-state'>No se encontraron eventos para "${esc(searchInput.value)}"</p>`;
      return;
    }
    _renderSearchPage(container, SEARCH_PAGE);
  }

  function _renderSearchPage(container, count) {
    const showing = Math.min(count, _searchResults.length);
    let html = `<p class="search-result-count">${_searchResults.length} resultado${_searchResults.length !== 1 ? "s" : ""}${showing < _searchResults.length ? ` (mostrando ${showing})` : ""}</p>`;
    for (let i = 0; i < showing; i++) {
      html += renderEvent(_searchResults[i]);
    }
    if (showing < _searchResults.length) {
      html += `<button class="btn-load-more" onclick="document.getElementById('events-container')._loadMore()">Cargar más resultados</button>`;
    }
    container.innerHTML = html;
    container._loadMore = () => _renderSearchPage(container, showing + SEARCH_PAGE);
  }

  document.getElementById("btn-search").addEventListener("click", openSearch);
  document.getElementById("search-close").addEventListener("click", closeSearch);
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSearch(); });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      openSearch();
    }
  });
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(doSearch, 400);
  });

  document.getElementById("user-filter").addEventListener("change", (e) => {
    activeUserFilter = e.target.value;
    e.target.classList.toggle("active-filter", !!activeUserFilter);
    render();
  });

  // Event delegation for action buttons
  document.getElementById("events-container").addEventListener("click", (e) => {
    const btn = e.target.closest(".ev-action, .ev-action-mobile");
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
  document.querySelector("header").hidden = view === "user" && window.innerWidth <= 640;
  document.querySelector(".filter-bar").style.display = view === "user" ? "none" : "";
  const panel = document.getElementById("filter-panel");
  if (panel) panel.remove();
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
  map = L.map("map", { zoomControl: false, zoomSnap: 0, scrollWheelZoom: false, smoothWheelZoom: true, smoothSensitivity: 1 }).setView(initCenter, initZoom);
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
  teatro:          { emoji: "🎭", color: "#1D4ED8" },
  "monólogos":     { emoji: "😂", color: "#7C3AED" },
  danza:           { emoji: "💃", color: "#DB2777" },
  circo:           { emoji: "🤹", color: "#BE185D" },
  conciertos:      { emoji: "🎵", color: "#7C3AED" },
  "ópera":         { emoji: "🎼", color: "#4338CA" },
  cine:            { emoji: "🎬", color: "#374151" },
  exposiciones:    { emoji: "🏛️", color: "#0891B2" },
  literatura:      { emoji: "📖", color: "#7C2D12" },
  talleres:        { emoji: "🔨", color: "#92400E" },
  conferencias:    { emoji: "🎤", color: "#4338CA" },
  "visitas guiadas": { emoji: "🗺️", color: "#1E40AF" },
  infantil:        { emoji: "🧸", color: "#F59E0B" },
  deportes:        { emoji: "⚽", color: "#16A34A" },
  ferias:          { emoji: "🛍️", color: "#DC2626" },
  otros:           { emoji: "📌", color: "#6B7280" },
  gratis:          { emoji: "🆓", color: "#16A34A" },
  "aire libre":    { emoji: "🌳", color: "#22C55E" },
  accesible:       { emoji: "♿", color: "#2563EB" },
  destacado:       { emoji: "⭐", color: "#EAB308" },
  "fotografía":    { emoji: "📷", color: "#6B7280" },
  "gastronomía":   { emoji: "🍽️", color: "#EA580C" },
  literatura:      { emoji: "📖", color: "#7C2D12" },
  mercados:        { emoji: "🛒", color: "#15803D" },
  fiestas:         { emoji: "🎉", color: "#DC2626" },
  musicales:       { emoji: "🎶", color: "#7C3AED" },
  flamenco:        { emoji: "💃", color: "#DC2626" },
  magia:           { emoji: "🪄", color: "#7C3AED" },
  // Legacy aliases
  musica:          { emoji: "🎵", color: "#7C3AED" },
  fotografia:      { emoji: "🏛️", color: "#0891B2" },
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
    "fotografia", "cine",
    "deportes", "ferias",
    "musica", "teatro", "talleres", "conferencias",
    "literatura", "exposiciones", "otros",
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
    const [evRes, calRes, locRes] = await Promise.all([
      fetch("data/events.json"),
      fetch("data/calendar.json"),
      fetch("data/locations.json"),
    ]);
    allEvents = await evRes.json();
    const locations = await locRes.json();
    for (const [id, ev] of Object.entries(allEvents)) {
      ev.id = id;
      if (ev.lid) {
        const loc = locations[ev.lid];
        if (loc) Object.assign(ev, loc);
      }
    }
    calendarData = await calRes.json();

    // Build allData for categories (unique events)
    allData = Object.values(allEvents);
    buildCategories();
  } catch (e) {
    container.innerHTML = "<p class='empty-state'>Error al cargar eventos.</p>";
    console.error(e);
  }
}

let allCatSet = new Set();

function buildCategories() {
  allCatSet = new Set();
  allData.forEach(ev => {
    (ev.categories || []).forEach(c => { if (c) allCatSet.add(c); });
  });
}

function _applyCatFilter(events) {
  // Stage 1: Mis Intereses — exclude events that have ANY excluded category
  const excluded = Settings.get("excludedCats", []);
  if (excluded.length) {
    events = events.filter(ev => !(ev.categories || []).some(c => excluded.includes(c)));
  }
  // Stage 2: Quick filter — categories (OR within)
  if (activeCatFilter.length) {
    events = events.filter(ev => (ev.categories || []).some(c => activeCatFilter.includes(c)));
  }
  // Stage 3: Quick filter — tags (OR within, AND with categories)
  if (activeTagFilter.length) {
    events = events.filter(ev => (ev.categories || []).some(c => activeTagFilter.includes(c)));
  }
  return events;
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
  return events.filter(ev => !ev.start_time || (ev.end_time || ev.start_time) >= nowTime);
}

function matchesSearch(ev) {
  if (!activeSearch) return true;
  const haystack = `${ev.title} ${ev.description || ""} ${ev.location_name || ""}`.toLowerCase();
  return haystack.includes(activeSearch);
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

  if (activeSearch) {
    filtered = filtered.filter(matchesSearch);
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
      return ta.localeCompare(tb) || a.title.localeCompare(b.title);
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
    if (activeSearch) { renderSearchList(); return; }
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
  const nav = document.querySelector(".bottom-nav");
  const isMobile = nav && getComputedStyle(nav).display !== "none";
  return isMobile ? renderEventMobile(ev) : renderEventDesktop(ev);
}

function _eventCommon(ev) {
  const time = fmtTime(ev.start_time);
  const endTime = fmtTime(ev.end_time);
  const timeStr = time === "00:00" && endTime === "23:59" ? "Todo el día"
    : time ? (endTime && endTime !== time ? `${time} - ${endTime}` : time) : "";
  const location = ev.location_name || ev.location || "";
  const title = esc(ev.title);
  const imgSrc = Array.isArray(ev.image) ? ev.image[0] : ev.image;
  const isFav = UserData.has("favorites", ev.id);
  let distStr = "";
  if (userLatLng && ev.latitude && ev.longitude) {
    const d = haversineDistance(userLatLng.lat, userLatLng.lng, parseFloat(ev.latitude), parseFloat(ev.longitude));
    distStr = ` (${d.toFixed(1)} km)`;
  }
  let locationHtml = "";
  if (location) {
    const isLocActive = activeLocation === location;
    const locClass = ` location-clickable${isLocActive ? ' location-active' : ''}`;
    const locClick = ` onclick="event.preventDefault(); event.stopPropagation(); toggleLocation('${esc(location)}')"`;
    locationHtml = `<div class="event-location${locClass}"${locClick}><span class="location-pin">📍</span> ${esc(location)}${distStr ? `<span class="location-dist">${distStr}</span>` : ""}</div>`;
  }
  return { timeStr, location, title, imgSrc, isFav, locationHtml };
}

function _wrapCard(ev, cardContent) {
  if (ev.url) {
    return `<a href="${esc(ev.url)}" target="_blank" rel="noopener" class="event-card event-card-link" data-eid="${esc(ev.id)}">${cardContent}</a>`;
  }
  return `<div class="event-card" data-eid="${esc(ev.id)}">${cardContent}</div>`;
}

function renderEventDesktop(ev) {
  const { timeStr, title, imgSrc, isFav, locationHtml } = _eventCommon(ev);
  const desc = ev.description
    ? `<p class="event-desc">${esc(ev.description)}</p>`
    : "";
  const { priceBadge, catBadge } = eventBadges(ev, "tag");
  const mainSource = (ev.source || "").split(",").filter(Boolean)[0] || "";
  const sourceTag = mainSource ? (() => {
    const label = SOURCE_LABELS[mainSource] || mainSource;
    const sourceUrl = ev.source_url || "";
    if (sourceUrl) {
      return `<span class="tag tag-source tag-link" onclick="event.preventDefault(); event.stopPropagation(); window.open('${esc(sourceUrl)}', '_blank')">${esc(label)}</span>`;
    }
    return `<span class="tag tag-source">${esc(label)}</span>`;
  })() : "";
  const badges = priceBadge + catBadge + sourceTag;

  const isSeen = UserData.has("seen", ev.id);
  const isDismissed = UserData.has("dismissed", ev.id);
  const actionsHtml = `<span class="event-actions">
    <button class="ev-action ev-fav${isFav ? ' active' : ''}" data-id="${esc(ev.id)}" data-action="fav" title="Favorito"><svg width="18" height="18" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>
    <button class="ev-action ev-seen${isSeen ? ' active' : ''}" data-id="${esc(ev.id)}" data-action="seen" title="Visto"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>
    <button class="ev-action ev-dismiss${isDismissed ? ' active' : ''}" data-id="${esc(ev.id)}" data-action="dismiss" title="Ocultar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </span>`;
  const thumbHtml = imgSrc ? `<img class="event-thumb" src="${esc(imgSrc)}" alt="" loading="lazy" />` : "";

  const headerHtml = `<div class="event-header">${timeStr ? `<span class="event-time">${esc(timeStr)}</span>` : ""}${badges ? `<div class="event-tags">${badges}</div>` : ""}</div>`;
  const bodyHtml = `
      <div class="event-title">${title}</div>
      ${desc}
      <div class="event-footer">
        ${locationHtml}
        ${actionsHtml}
      </div>`;

  const cardContent = imgSrc
    ? `<div class="event-with-thumb">${thumbHtml}<div class="event-main">${headerHtml}${bodyHtml}</div></div>`
    : `${headerHtml}${bodyHtml}`;

  return _wrapCard(ev, cardContent);
}

function renderEventMobile(ev) {
  const { timeStr, title, imgSrc, isFav, locationHtml } = _eventCommon(ev);
  const desc = ev.description
    ? `<p class="event-desc">${esc(ev.description)}</p>`
    : "";
  const { priceBadge, catBadge } = eventBadges(ev, "tag");
  const badges = priceBadge + catBadge;
  const thumbHtml = imgSrc ? `<img class="event-thumb" src="${esc(imgSrc)}" alt="" loading="lazy" />` : "";

  const isSeen = UserData.has("seen", ev.id);
  const isDismissed = UserData.has("dismissed", ev.id);

  const cardContent = `
      <div class="swipe-hint swipe-hint-right">♥ Favorito</div>
      <div class="swipe-hint swipe-hint-left">✕ Ocultar</div>
      <div class="event-mobile-top">
        ${timeStr ? `<span class="event-time">${esc(timeStr)}</span>` : ""}
        ${badges ? `<div class="event-tags">${badges}</div>` : ""}
      </div>
      ${thumbHtml}
      <div class="event-mobile-body">
        <div class="event-title">${title}</div>
        ${desc}
        ${locationHtml}
      </div>
      <div class="event-mobile-actions">
        <button class="ev-action-mobile${isFav ? ' active' : ''}" data-id="${esc(ev.id)}" data-action="fav"><svg width="22" height="22" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>
        <button class="ev-action-mobile${isSeen ? ' active' : ''}" data-id="${esc(ev.id)}" data-action="seen"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>
        <button class="ev-action-mobile${isDismissed ? ' active' : ''}" data-id="${esc(ev.id)}" data-action="dismiss"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>`;

  return _wrapCard(ev, cardContent);
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
  activeCatFilter.forEach(c => {
    const info = CAT_ICONS[c] || { emoji: "📍" };
    parts.push(`<span class="tag tag-active" onclick="toggleActiveCat('${esc(c)}')">${info.emoji} ${esc(CATEGORY_LABELS[c] || c)} ✕</span>`);
  });
  activeTagFilter.forEach(t => {
    const info = CAT_ICONS[t] || { emoji: "📍" };
    parts.push(`<span class="tag tag-active" onclick="toggleActiveTag('${esc(t)}')">${info.emoji} ${esc(CATEGORY_LABELS[t] || t)} ✕</span>`);
  });
  container.innerHTML = parts.join("");
  updateFilterBadge();
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
  if (activeSearch) {
    events = events.filter(matchesSearch);
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

  const mainCats = MAIN_CATS;
  const tagCats = TAG_ORDER;
  const excludedCats = Settings.get("excludedCats", []);

  function catGrid(cats) {
    return cats.map(c => {
      const info = CAT_ICONS[c] || { emoji: "📍", color: "#6B7280" };
      const active = !excludedCats.includes(c);
      return `<button class="cat-circle${active ? " active" : ""}" onclick="toggleCatPref('${esc(c)}')">
        <span class="cat-circle-icon">${info.emoji}</span>
        <span class="cat-circle-label">${esc(CATEGORY_LABELS[c] || c)}</span>
      </button>`;
    }).join("");
  }

  const catGridHtml = `
    <div class="pref-subheading">Categorías principales</div>
    <div class="cat-grid-circles">${catGrid(mainCats)}</div>
    <div class="pref-subheading">Subcategorías</div>
    <div class="cat-grid-circles">${catGrid(tagCats)}</div>
  `;

  document.getElementById("user-container").innerHTML = `
    <div class="user-page">
      ${profileHtml}
      ${statsHtml}

      <section class="pref-section">
        <div class="pref-section-header">
          <h3>Mis Intereses</h3>
        </div>
        <p class="pref-hint">Lo que desactives se ocultará en toda la app: lista, mapa y calendario.</p>
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
            <span class="setting-grid-label">Tema visual</span>
            ${customDropdown("theme",
              Object.entries(THEMES).map(([key, t]) => ({ value: key, label: `${t.emoji} ${t.label}` })),
              currentTheme, "applyTheme")}
          </div>
          <div class="setting-grid-item">
            <span class="setting-grid-label">Estilo del mapa</span>
            ${tilesHtml}
          </div>
          ${sources.length > 1 ? `<div class="setting-grid-item">
            <span class="setting-grid-label">Fuente de datos</span>
            ${customDropdown("source",
              [{ value: "", label: "Todas" }, ...sources.map(s => ({ value: s, label: SOURCE_LABELS[s] || s }))],
              activeSource, "applySource")}
          </div>` : ""}
        </div>
      </section>


      <div class="user-actions-row">
        ${user ? `<button class="btn-logout" onclick="FirebaseSync.logout(); setView('list')">➜] Cerrar sesión</button>` : ""}
        <button class="btn-logout btn-danger" onclick="resetUserData()">⟳ Resetear todo</button>
      </div>

      <footer class="user-footer">
        <p>En algunos casos la programación de ciertos eventos no se hace pública hasta pocos días antes de que se celebren.</p>
        <p>Los eventos se actualizan con frecuencia. Consulta la fuente original para confirmar detalles.</p>
        <p><a href="/info.html">Info</a></p>
      </footer>
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

function toggleActiveCat(cat) {
  const idx = activeCatFilter.indexOf(cat);
  if (idx >= 0) activeCatFilter.splice(idx, 1);
  else activeCatFilter.push(cat);
  renderActiveFilters();
  render();
  const panel = document.getElementById("filter-panel");
  if (panel) renderFilterPanelContent(panel);
}

function toggleActiveTag(tag) {
  const idx = activeTagFilter.indexOf(tag);
  if (idx >= 0) activeTagFilter.splice(idx, 1);
  else activeTagFilter.push(tag);
  renderActiveFilters();
  render();
  const panel = document.getElementById("filter-panel");
  if (panel) renderFilterPanelContent(panel);
}

function clearActiveFilters() {
  activeCatFilter = [];
  activeTagFilter = [];
  renderActiveFilters();
  render();
  const panel = document.getElementById("filter-panel");
  if (panel) panel.remove();
}

function updateFilterBadge() {
  const count = activeCatFilter.length + activeTagFilter.length;
  const badge = document.getElementById("filter-count-badge");
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? "" : "none";
  }
  const btn = document.getElementById("filter-toggle-btn");
  if (btn) btn.classList.toggle("has-filters", count > 0);
}

function renderFilterPanelContent(panel) {
  const excluded = Settings.get("excludedCats", []);
  const mainCats = MAIN_CATS;
  const tagCats = TAG_ORDER;

  function chips(items, activeList, toggleFn) {
    return items.map(c => {
      const info = CAT_ICONS[c] || { emoji: "📍", color: "#6B7280" };
      const isActive = activeList.includes(c);
      const isExcluded = excluded.includes(c);
      if (isExcluded) return `<button class="filter-chip disabled" title="Desactivado en Mis Intereses (Ajustes)">${info.emoji} ${esc(CATEGORY_LABELS[c] || c)}</button>`;
      return `<button class="filter-chip${isActive ? " active" : ""}" onclick="${toggleFn}('${esc(c)}')">${info.emoji} ${esc(CATEGORY_LABELS[c] || c)}</button>`;
    }).join("");
  }

  const hasFilters = activeCatFilter.length + activeTagFilter.length > 0;
  panel.innerHTML = `
    <div class="filter-panel-section">
      <div class="filter-panel-label">Categorías principales</div>
      <div class="filter-chips">${chips(mainCats, activeCatFilter, "toggleActiveCat")}</div>
    </div>
    <div class="filter-panel-section">
      <div class="filter-panel-label">Subcategorías</div>
      <div class="filter-chips">${chips(tagCats, activeTagFilter, "toggleActiveTag")}</div>
    </div>
    ${hasFilters ? `<button class="filter-clear-btn" onclick="clearActiveFilters()">Limpiar filtros</button>` : ""}
  `;
}

function toggleFilterPanel() {
  const existing = document.getElementById("filter-panel");
  if (existing) { existing.remove(); return; }

  const bar = document.querySelector(".filter-bar");
  const panel = document.createElement("div");
  panel.id = "filter-panel";
  panel.className = "filter-panel";
  renderFilterPanelContent(panel);
  bar.appendChild(panel);
}

function applySource(val) {
  activeSource = val;
  Settings.set("source", val);
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
  let excluded = Settings.get("excludedCats", []);
  if (excluded.includes(cat)) {
    excluded = excluded.filter(c => c !== cat);
  } else {
    excluded.push(cat);
  }
  Settings.set("excludedCats", excluded);
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

// Unregister any existing Service Worker and clear caches
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) =>
    regs.forEach((r) => r.unregister())
  );
  caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
}

// ==============================
// SWIPE VIEW (Mix / Tinder mode)
// ==============================

let swipeQueue = [];
let swipeIndex = 0;
let swipeActive = false;
let swipeSkipped = new Set(); // track skipped event IDs within the session
let swipeDay = null; // track which day the skip set belongs to

function _getSwipeEvents() {
  let events = _getDayEvents(dateStr(selectedDate));
  events = events.filter(ev => !UserData.has("favorites", ev.id) && !UserData.has("seen", ev.id) && !UserData.has("dismissed", ev.id) && !swipeSkipped.has(ev.id));
  return events.sort((a, b) => (a.start_time || "99:99").localeCompare(b.start_time || "99:99"));
}

function renderSwipeView(forceReset) {
  const day = dateStr(selectedDate);
  if (forceReset || swipeDay !== day) {
    swipeSkipped.clear();
    swipeDay = day;
    swipeQueue = _getSwipeEvents();
    swipeIndex = 0;
    swipeActive = false;
  }
  updateDateLabel(swipeQueue.length - swipeIndex);
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
  el.innerHTML = _swipeCardInner(ev0, swipeIndex + 1, swipeQueue.length);
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

function _swipeCardInner(ev, pos, total) {
  const cat = ev.categories?.[0] || "otros";
  const catInfo = CAT_ICONS[cat] || { emoji: "📍", color: "#6B7280" };
  const color = catInfo.color;

  const timeStr = (() => {
    const s = fmtTime(ev.start_time), e = fmtTime(ev.end_time);
    return s === "00:00" && e === "23:59" ? "Todo el día"
      : s ? (e && e !== s ? `${s} – ${e}` : s) : "";
  })();

  const { priceBadge, distBadge, catBadge, isFree } = eventBadges(ev, "swipe-info-badge");
  const shortPrice = (!isFree && ev.price) ? ev.price : "";

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
      ${priceBadge}
      ${distBadge}
      ${catBadge}
    </div>
    <div class="swipe-info">
      ${pos ? `<div class="swipe-counter">${pos} / ${total}</div>` : ""}
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

  // Force a reflow so the browser registers the current position before animating
  void card.offsetWidth;
  card.style.transition = "transform 0.38s ease, opacity 0.28s ease";
  card.style.transform = `translateX(${tx}px) translateY(${ty}px) rotate(${rot}deg)`;
  card.style.opacity = "0";

  if (dir === "right" && !UserData.has("favorites", id)) UserData.toggle("favorites", id);
  else if (dir === "left" && !UserData.has("dismissed", id)) UserData.toggle("dismissed", id);
  else if (dir === "up") swipeSkipped.add(id);

  card.addEventListener("transitionend", () => {
    swipeIndex++;
    swipeActive = false;
    _buildSwipeDeck();
  }, { once: true });
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
