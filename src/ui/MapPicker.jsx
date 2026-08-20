/* Vector — Leaflet térképes koordináta-választó, offline SVG tartalékkal
   Kiemelve a fuvarterv.jsx-ből; a viselkedés változatlan. */

import { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Minus, AlertTriangle, X, Search } from "lucide-react";
import { r5, defaultMapCenter } from "../domain/geo.js";

/* =====================================================================
   3.5 TÉRKÉPES KOORDINÁTA-VÁLASZTÓ — Leaflet + OpenStreetMap
   A könyvtár csak a modál első megnyitásakor töltődik be (cdnjs).
   ===================================================================== */

let leafletLoader = null;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoader) return leafletLoader;
  leafletLoader = new Promise((resolve, reject) => {
    const CSS_ID = "leaflet-css";
    // Csak egyszer fűzzük be a stíluslapot: újrapróbálkozáskor korábban minden
    // kísérlet hagyott maga után egy halott <link>-et és egy halott <script>-et.
    if (!document.getElementById(CSS_ID)) {
      const css = document.createElement("link");
      css.id = CSS_ID;
      css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = () => {
      // A script betöltődhet úgy is, hogy a globális L nem jön létre (pl. CSP);
      // ilyenkor a hívó egyértelmű hibát kapjon, ne egy undefined-ot.
      if (window.L) resolve(window.L);
      else { js.remove(); leafletLoader = null; reject(new Error("Leaflet betöltési hiba")); }
    };
    js.onerror = () => { js.remove(); leafletLoader = null; reject(new Error("Leaflet betöltési hiba")); };
    document.head.appendChild(js);
  });
  return leafletLoader;
}

/* Koordináta-szöveg értelmezése: "46.25311, 20.14503" vagy "46,25311 20,14503" */
export function parseLatLon(str) {
  const m = String(str || "").trim().match(/^(-?\d{1,3}(?:[.,]\d+)?)[;,\s]+(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(",", ".")), lon = parseFloat(m[2].replace(",", "."));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/* Egyszerű helyi vetítés az offline térképhez (városi léptékben pontos) */
export const DEG_M = 111320; // méter / szélességi fok
export function projPx(view, size, lat, lon) {
  const cosL = Math.cos((view.lat * Math.PI) / 180);
  return {
    x: size.w / 2 + ((lon - view.lon) * DEG_M * cosL) / view.mpp,
    y: size.h / 2 - ((lat - view.lat) * DEG_M) / view.mpp,
  };
}
export function projGeo(view, size, x, y) {
  const cosL = Math.cos((view.lat * Math.PI) / 180);
  return {
    lat: view.lat - ((y - size.h / 2) * view.mpp) / DEG_M,
    lon: view.lon + ((x - size.w / 2) * view.mpp) / (DEG_M * cosL),
  };
}

/* Offline (csempementes) választó: rács + a meglévő pontok tájékozódásul.
   Koppintás = jelölő (közeli ismert pontra rásnappel), húzás = pásztázás,
   jelölő húzható, +/− gombokkal nagyítás. */
export function OfflinePicker({ state, view, setView, pos, setPos }) {
  const boxRef = useRef(null);
  const drag = useRef(null);
  const [size, setSize] = useState({ w: 320, h: 320 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const upd = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => [
    ...state.stations.filter((p) => p.lat != null && p.lon != null).map((p) => ({ ...p, kind: "st" })),
    ...state.venues.filter((p) => p.lat != null && p.lon != null).map((p) => ({ ...p, kind: "ve" })),
  ], [state]);

  const local = (e) => {
    const r = boxRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e) => {
    const { x, y } = local(e);
    let mode = "pan";
    if (pos) {
      const p = projPx(view, size, pos.lat, pos.lon);
      if (Math.hypot(p.x - x, p.y - y) < 24) mode = "marker";
    }
    drag.current = { x, y, sLat: view.lat, sLon: view.lon, mode, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = local(e);
    if (Math.hypot(x - d.x, y - d.y) > 5) d.moved = true;
    if (d.mode === "marker") setPos(projGeo(view, size, x, y));
    else if (d.moved) {
      const cosL = Math.cos((d.sLat * Math.PI) / 180);
      setView({ ...view, lat: d.sLat + ((y - d.y) * view.mpp) / DEG_M, lon: d.sLon - ((x - d.x) * view.mpp) / (DEG_M * cosL) });
    }
  };
  const onUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || d.mode !== "pan") return;
    const { x, y } = local(e);
    let g = projGeo(view, size, x, y);
    for (const p of pts) {
      const pp = projPx(view, size, p.lat, p.lon);
      if (Math.hypot(pp.x - x, pp.y - y) < 14) { g = { lat: p.lat, lon: p.lon }; break; }
    }
    setPos({ lat: g.lat, lon: g.lon });
  };
  const zoom = (f) => setView({ ...view, mpp: Math.min(60, Math.max(0.3, view.mpp * f)) });

  const stepM = [50, 100, 250, 500, 1000, 2500, 5000].find((s) => s / view.mpp >= 64) || 5000;
  const stepPx = stepM / view.mpp;
  const cosL = Math.cos((view.lat * Math.PI) / 180);
  const kx = (DEG_M * cosL) / view.mpp, ky = DEG_M / view.mpp;
  const offX = ((size.w / 2 - view.lon * kx) % stepPx + stepPx) % stepPx;
  const offY = ((size.h / 2 + view.lat * ky) % stepPx + stepPx) % stepPx;
  const vLines = []; for (let x = offX; x <= size.w; x += stepPx) vLines.push(x);
  const hLines = []; for (let y = offY; y <= size.h; y += stepPx) hLines.push(y);

  return (
    <div ref={boxRef} className="map-canvas" style={{ touchAction: "none", userSelect: "none", cursor: "crosshair", background: "#E6EDEF", overflow: "hidden" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}>
      <svg width={size.w} height={size.h} style={{ display: "block" }} aria-label="Egyszerűsített térkép">
        {vLines.map((x) => <line key={"v" + x} x1={x} y1={0} x2={x} y2={size.h} stroke="#DCE1E7" strokeWidth="1" />)}
        {hLines.map((y) => <line key={"h" + y} x1={0} y1={y} x2={size.w} y2={y} stroke="#DCE1E7" strokeWidth="1" />)}
        {pts.map((p) => {
          const q = projPx(view, size, p.lat, p.lon);
          if (q.x < -80 || q.y < -30 || q.x > size.w + 80 || q.y > size.h + 30) return null;
          return (
            <g key={p.kind + p.id}>
              {p.kind === "ve"
                ? <rect x={q.x - 5} y={q.y - 5} width={10} height={10} rx={2} fill="#12B76A" />
                : <circle cx={q.x} cy={q.y} r={5} fill="#14161C" />}
              <text x={q.x + 8} y={q.y + 4} fontSize="11" fill="#6A7180">{p.name}</text>
            </g>
          );
        })}
        {pos && (() => {
          const q = projPx(view, size, pos.lat, pos.lon);
          return (
            <g transform={`translate(${q.x},${q.y})`} style={{ cursor: "grab" }}>
              <path d="M0 0 C -8 -12, -13 -17, -13 -25 A 13 13 0 1 1 13 -25 C 13 -17, 8 -12, 0 0 Z" fill="#14161C" />
              <circle cx="0" cy="-25" r="4.5" fill="#00C2E8" />
            </g>
          );
        })()}
        <rect x={10} y={size.h - 24} width={stepPx} height={3} fill="#14161C" />
        <text x={10} y={size.h - 30} fontSize="11" fill="#6A7180">{stepM >= 1000 ? `${stepM / 1000} km` : `${stepM} m`}</text>
      </svg>
      <div style={{ position: "absolute", right: 10, top: 10, display: "flex", flexDirection: "column", gap: 6 }}
        onPointerDown={(e) => e.stopPropagation()}>
        <button className="iconbtn" onClick={() => zoom(1 / 1.5)} aria-label="Nagyítás"><Plus size={16} /></button>
        <button className="iconbtn" onClick={() => zoom(1.5)} aria-label="Kicsinyítés"><Minus size={16} /></button>
      </div>
    </div>
  );
}

export function MapPickerModal({ state, item, title, onSave, onClose }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const placeRef = useRef(null);
  const posRef = useRef(null);
  const c0 = defaultMapCenter(state, item);
  const [mode, setMode] = useState("loading"); // loading | osm | offline
  const [offReason, setOffReason] = useState("");
  const [pos, setPos] = useState(item && item.lat != null && item.lon != null ? { lat: item.lat, lon: item.lon } : null);
  const [oView, setOView] = useState({ lat: c0.lat, lon: c0.lon, mpp: 5 });
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [manual, setManual] = useState("");
  const [manualErr, setManualErr] = useState(false);

  useEffect(() => { posRef.current = pos; }, [pos]);

  useEffect(() => {
    let alive = true;
    let timer = null;
    const goOffline = (reason) => {
      if (!alive) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markerRef.current = null; placeRef.current = null;
      const p = posRef.current;
      if (p) setOView((v) => ({ ...v, lat: p.lat, lon: p.lon }));
      setOffReason(reason); setMode("offline");
    };
    loadLeaflet().then((L) => {
      if (!alive || !mapDivRef.current) return;
      const map = L.map(mapDivRef.current).setView([c0.lat, c0.lon], c0.zoom);
      let okTiles = 0, errTiles = 0, tries = 0;
      const layer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> közreműködők',
      });
      layer.on("tileload", () => { okTiles++; });
      layer.on("tileerror", () => { errTiles++; });
      layer.addTo(map);
      const pinIcon = L.divIcon({ className: "", html: '<div class="ft-pin"><span></span></div>', iconSize: [30, 40], iconAnchor: [15, 36] });
      const place = (latlng) => {
        if (markerRef.current) {
          markerRef.current.setLatLng(latlng);
        } else {
          markerRef.current = L.marker(latlng, { draggable: true, icon: pinIcon }).addTo(map);
          markerRef.current.on("dragend", () => {
            const p = markerRef.current.getLatLng();
            setPos({ lat: p.lat, lon: p.lng });
          });
        }
        setPos({ lat: latlng.lat, lon: latlng.lng });
      };
      placeRef.current = (lat, lon) => { place({ lat, lng: lon }); map.setView([lat, lon], Math.max(map.getZoom(), 15)); };
      map.on("click", (e) => place(e.latlng));
      map.on("contextmenu", (e) => place(e.latlng)); // mobilon: hosszú nyomás
      if (item && item.lat != null && item.lon != null) place({ lat: item.lat, lng: item.lon });
      mapRef.current = map;
      setMode("osm");
      setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 80);
      // Csempe-ellenőrzés: ha csak hibák jönnek és egy csempe sem tölt be, offline módra váltunk
      const check = () => {
        if (!alive || okTiles > 0) return;
        if (errTiles > 0) { goOffline("tiles"); return; }
        if (++tries < 4) timer = setTimeout(check, 2500);
      };
      timer = setTimeout(check, 2500);
    }).catch(() => goOffline("script"));
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markerRef.current = null;
    };
  }, []);

  const doSearch = async () => {
    const query = q.trim();
    if (!query || searchBusy) return;
    setSearchBusy(true); setSearchErr(""); setResults(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=hu&q=${encodeURIComponent(query)}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error("http");
      const js = await r.json();
      setResults(Array.isArray(js) ? js : []);
    } catch (e) {
      setSearchErr("A címkeresés most nem érhető el — jelölj kézzel, vagy illessz be koordinátát lent.");
    } finally {
      setSearchBusy(false);
    }
  };
  const jumpTo = (res) => {
    setResults(null);
    const lat = Number(res.lat), lon = Number(res.lon);
    if (mode === "osm" && mapRef.current) mapRef.current.setView([lat, lon], 16);
    else setOView((v) => ({ ...v, lat, lon, mpp: 2 }));
  };
  const applyManual = () => {
    const g = parseLatLon(manual);
    if (!g) { setManualErr(true); return; }
    setManualErr(false);
    if (mode === "osm" && placeRef.current) placeRef.current(g.lat, g.lon);
    else { setPos(g); setOView((v) => ({ ...v, lat: g.lat, lon: g.lon })); }
    setManual("");
  };

  return (
    <div className="map-bg" onClick={onClose}>
      <div className="map-modal" onClick={(e) => e.stopPropagation()}>
        <div className="map-head">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="disp text-lg flex-1 truncate">{title}</h3>
            <button className="iconbtn" onClick={onClose} aria-label="Bezárás"><X size={18} /></button>
          </div>
          <div className="flex gap-2" style={{ position: "relative" }}>
            <input className="inp" placeholder="Címkeresés (pl. Szeged, Kossuth utca 1.)" value={q}
              onChange={(e) => { setQ(e.target.value); setSearchErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }} />
            <button className="btn btn-pri" onClick={doSearch} disabled={searchBusy} aria-label="Keresés">
              <Search size={17} />
            </button>
            {results && (
              <div className="map-results card">
                {results.length === 0 && <div className="p-3 text-sm" style={{ color: "var(--ink2)" }}>Nincs találat.</div>}
                {results.map((r, i) => (
                  <button key={i} className="map-result" onClick={() => jumpTo(r)}>{r.display_name}</button>
                ))}
              </div>
            )}
          </div>
          {searchErr && <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>{searchErr}</div>}
          <p className="text-xs mt-1" style={{ color: "var(--ink2)" }}>
            A keresés csak odaugrik a térképen. A pontot koppintással vagy hosszú nyomással jelölöd ki, a jelölő utána húzható.
          </p>
          {mode === "offline" && (
            <div className="banner banner-warn mt-1" style={{ fontSize: 12.5, padding: "8px 10px" }}>
              <AlertTriangle size={15} />
              <span>
                {offReason === "script" ? "A térképkönyvtár nem tölthető be ebben a környezetben" : "Az OSM-csempéket ez a környezet nem engedi betölteni (az előnézet blokkolja a külső képeket)"}
                {" "}— egyszerűsített térkép fut, a meglévő pontjaid tájékozódási pontként látszanak. Telepítve a teljes OpenStreetMap működik. Google Mapsből másolt koordinátát lent be is illeszthetsz.
              </span>
            </div>
          )}
        </div>
        <div className="map-body">
          {mode !== "offline" && <div ref={mapDivRef} className="map-canvas" />}
          {mode === "offline" && <OfflinePicker state={state} view={oView} setView={setOView} pos={pos} setPos={setPos} />}
          {mode === "loading" && (
            <div className="map-overlay"><span className="disp text-lg">Térkép betöltése…</span></div>
          )}
        </div>
        <div className="map-foot" style={{ flexWrap: "wrap" }}>
          <div className="flex items-center gap-2 w-full">
            <input className="inp" style={{ minHeight: 38, padding: "6px 10px", flex: 1 }}
              placeholder="Koordináta beillesztése: 46.25311, 20.14503"
              value={manual} onChange={(e) => { setManual(e.target.value); setManualErr(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") applyManual(); }} />
            <button className="btn btn-ghost" style={{ minHeight: 38, padding: "6px 12px" }} onClick={applyManual}>Beszúr</button>
          </div>
          {manualErr && <div className="text-xs w-full" style={{ color: "var(--danger)" }}>Nem értelmezhető — várt formátum: 46.25311, 20.14503</div>}
          <div className="flex-1 min-w-0">
            <div className="text-xs" style={{ color: "var(--ink2)" }}>Kijelölt pont</div>
            <div className="tnum text-lg">{pos ? `${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}` : "—"}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Mégse</button>
          <button className="btn btn-pri" disabled={!pos} onClick={() => pos && onSave(r5(pos.lat), r5(pos.lon))}>Mentés</button>
        </div>
      </div>
    </div>
  );
}
