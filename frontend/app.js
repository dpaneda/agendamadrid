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
        if (u) _pullAndMerge();
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
    const icon = document.getElementById("sync-icon");
    if (!btn) return;
    if (u) {
      btn.classList.add("logged-in");
      label.textContent = u.displayName ? u.displayName.split(" ")[0] : "Sync";
      if (u.photoURL) {
        let img = btn.querySelector(".sync-avatar");
        if (!img) {
          img = document.createElement("img");
          img.className = "sync-avatar";
          img.referrerPolicy = "no-referrer";
          btn.prepend(img);
        }
        img.src = u.photoURL;
        if (icon) icon.style.display = "none";
      }
    } else {
      btn.classList.remove("logged-in");
      label.textContent = "Sync";
      const avatar = btn.querySelector(".sync-avatar");
      if (avatar) avatar.remove();
      if (icon) icon.style.display = "";
    }
  }

  return {
    init,
    login,
    logout,
    push,
    sync: _pullAndMerge,
    isLoggedIn: () => !!user,
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
  "gratis": "gratis",
};

const SOURCE_LABELS = {
  "madrid_agenda": "datos.madrid.es",
  "esmadrid": "esmadrid.com",
  "teatros_canal": "teatroscanal.com",
};

const _initParams = new URLSearchParams(window.location.search);
let selectedDate = (function() {
  const d = _initParams.get("date");
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const parsed = new Date(d + "T12:00:00");
    if (!isNaN(parsed)) return parsed;
  }
  return new Date();
})();
let allEvents = {};   // id -> event data
let calendarData = {}; // date -> [{event_id, start_time, end_time}]
let allData = [];      // flattened for backward compat (buildCategories)
let activeTags = new Set();
let activeLocation = "";
let activeSource = "", activeSort = "hora";
let activeUserFilter = "";
let currentView = "list";
let map = null, markersLayer = null;
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

  document.getElementById("source-filter").addEventListener("change", (e) => {
    activeSource = e.target.value;
    e.target.classList.toggle("active-filter", !!activeSource);
    render();
  });
  document.getElementById("sort-filter").addEventListener("change", (e) => {
    activeSort = e.target.value;
    render();
  });

  document.getElementById("btn-list").addEventListener("click", () => setView("list"));
  document.getElementById("btn-map").addEventListener("click", () => setView("map"));
  document.getElementById("btn-cal").addEventListener("click", () => setView("cal"));

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
      FirebaseSync.sync();
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
  const initSource = _initParams.get("source");
  if (initSource) {
    activeSource = initSource;
    document.getElementById("source-filter").value = initSource;
    document.getElementById("source-filter").classList.add("active-filter");
  }
  const initSort = _initParams.get("sort");
  if (initSort) {
    activeSort = initSort;
    document.getElementById("sort-filter").value = initSort;
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
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      changeDay(dx < 0 ? 1 : -1);
    }
  }, { passive: true });
}

function setView(view) {
  currentView = view;
  document.getElementById("btn-list").classList.toggle("active", view === "list");
  document.getElementById("btn-map").classList.toggle("active", view === "map");
  document.getElementById("btn-cal").classList.toggle("active", view === "cal");
  document.getElementById("events-container").hidden = view !== "list";
  document.getElementById("map-container").hidden = view !== "map";
  document.getElementById("cal-container").hidden = view !== "cal";
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
  }
}

function initMap() {
  map = L.map("map").setView([40.4168, -3.7038], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
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
    map.setView([userLatLng.lat, userLatLng.lng], 15);
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

function renderMap() {
  if (!map || !markersLayer) return;
  markersLayer.clearLayers();

  const events = getFilteredDayEvents();
  updateDateLabel(events.length);
  const bounds = [];

  events.forEach(ev => {
    if (!ev.latitude || !ev.longitude) return;
    const lat = parseFloat(ev.latitude);
    const lng = parseFloat(ev.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    bounds.push([lat, lng]);

    const time = ev.start_time ? ev.start_time.slice(0, 5) : "";
    const location = ev.location_name || ev.location || "";
    const titleHtml = ev.url
      ? `<a href="${esc(ev.url)}" target="_blank" rel="noopener">${esc(ev.title)}</a>`
      : esc(ev.title);
    const tags = ev.categories.map(c => `<span class="tag">${esc(c)}</span>`).join("");

    const mapFav = UserData.has("favorites", ev.id);
    const mapSeen = UserData.has("seen", ev.id);
    const popup = `<div class="map-popup">
      <div class="popup-title">${titleHtml}</div>
      ${time ? `<div class="popup-meta">${esc(time)}</div>` : ""}
      ${location ? `<div class="popup-location">${esc(location)}</div>` : ""}
      ${tags ? `<div class="popup-tags">${tags}</div>` : ""}
      <div class="popup-actions">
        <button class="ev-action ev-fav${mapFav ? ' active' : ''}" onclick="mapAction('fav','${esc(ev.id)}',this)" title="Favorito"><svg width="16" height="16" viewBox="0 0 24 24" fill="${mapFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>
        <button class="ev-action ev-seen${mapSeen ? ' active' : ''}" onclick="mapAction('seen','${esc(ev.id)}',this)" title="Visto"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>
        <button class="ev-action ev-dismiss" onclick="mapAction('dismiss','${esc(ev.id)}',this)" title="Ocultar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>`;

    let distanceLabel = "";
    if (userLatLng) {
      const dist = map.distance(userLatLng, [lat, lng]);
      const distKm = (dist / 1000).toFixed(1);
      distanceLabel = `${distKm} km`;
    }

    const marker = L.marker([lat, lng]).addTo(markersLayer);
    marker.bindPopup(popup);
  });

  const urlParams = new URLSearchParams(window.location.search);
  const mlat = urlParams.get("mlat"), mlng = urlParams.get("mlng"), mz = urlParams.get("mz");
  if (mlat && mlng && mz) {
    map.setView([parseFloat(mlat), parseFloat(mlng)], parseInt(mz));
  } else if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [30, 30] });
  } else if (bounds.length === 1) {
    map.setView(bounds[0], 15);
  } else {
    map.setView([40.4168, -3.7038], 13);
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
  const individualSources = new Set();
  const allCats = new Set();
  allData.forEach(ev => {
    (ev.source || "").split(",").forEach(s => { if (s) individualSources.add(s); });
    (ev.categories || []).forEach(c => { if (c) allCats.add(c); });
  });

  const catSelect = document.getElementById("category-filter");
  [...allCats].sort((a, b) => (CATEGORY_LABELS[a] || a).localeCompare(CATEGORY_LABELS[b] || b)).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = CATEGORY_LABELS[c] || c;
    catSelect.appendChild(opt);
  });

  const srcSelect = document.getElementById("source-filter");
  [...individualSources].sort().forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = SOURCE_LABELS[s] || s;
    srcSelect.appendChild(opt);
  });
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
  const url = new URL(window.location);

  if (ds === today) url.searchParams.delete("date");
  else url.searchParams.set("date", ds);

  if (activeTags.size === 1) url.searchParams.set("cat", [...activeTags][0]);
  else url.searchParams.delete("cat");

  if (activeSource) url.searchParams.set("source", activeSource);
  else url.searchParams.delete("source");

  if (activeSort !== "hora") url.searchParams.set("sort", activeSort);
  else url.searchParams.delete("sort");

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
  }
}

function renderEvents() {
  const container = document.getElementById("events-container");
  const dayEvents = getFilteredDayEvents();

  updateDateLabel(dayEvents.length);

  if (!dayEvents.length) {
    container.innerHTML = "<p class='empty-state'>No hay eventos para este dia.</p>";
    return;
  }

  container.innerHTML = dayEvents.map(renderEvent).join("");
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

function mapAction(action, id, btn) {
  if (action === "fav") {
    UserData.toggle("favorites", id);
    btn.classList.toggle("active", UserData.has("favorites", id));
    const svg = btn.querySelector("svg path");
    if (svg) svg.setAttribute("fill", UserData.has("favorites", id) ? "currentColor" : "none");
  } else if (action === "seen") {
    UserData.toggle("seen", id);
    btn.classList.toggle("active", UserData.has("seen", id));
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
