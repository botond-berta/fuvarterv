/* Fuvarterv — megállólista-szerkesztő: megállók, létszámok, útvonal, visszaút.
 *
 * Egy komponens két szinten: a CSAPAT állandó listájához és az EDZÉS saját
 * listájához. Azért működik adapter nélkül, mert a két forrás mezőnevei
 * azonosak (stationIds, stationCounts, routeMode, routeAnchorId, return*) — és
 * ezért adható át a `value` úgy is a legFor/legRouteOrder/legPax hívásoknak,
 * mintha csapat lenne.
 *
 * Kontrollált komponens: minden módosítás egy `onChange(patch)` hívás, a
 * beírás helyét (csapat vagy edzés) a szülő tudja.
 */

import { byId } from "../domain/constants.js";
import { Field } from "../ui/base.jsx";
import { planOda, legRouteOrder, legPax } from "../domain/optimizer.js";

export function StopListEditor({ state, value, onChange, venueId, venueName }) {
  const v = value || {};
  const stationIds = v.stationIds || [];
  const returnIds = v.returnStationIds;

  const toggle = (key, id) => {
    const cur = v[key] || [];
    onChange({ [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const setCount = (key, sid, val) =>
    onChange({ [key]: { ...(v[key] || {}), [sid]: val === "" ? "" : Math.max(0, Number(val) || 0) } });

  /* A visszaút saját listája: null = tükrözze az odautat (a korábbi viselkedés).
     Bekapcsoláskor az odaút megállóival indulunk, hogy legyen mit szerkeszteni,
     kikapcsoláskor null-ra állunk vissza. */
  const setReturnOwn = (own) => onChange(own
    ? { returnStationIds: [...stationIds], returnStationCounts: { ...(v.stationCounts || {}) } }
    : { returnStationIds: null, returnRouteAnchorId: null });

  const countRows = (key, ids, countsKey, label) => (
    <div className="card p-3 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="disp text-sm">{label}</h4>
        <span className="text-sm font-semibold tnum">Σ {legPax(v, null, key)} fő</span>
      </div>
      <div className="flex flex-col gap-2">
        {ids.map((sid) => {
          const st = byId(state.stations, sid);
          return (
            <div key={sid} className="flex items-center gap-2">
              <span className="flex-1 text-sm truncate">{st?.name || "?"}</span>
              <input type="number" min="0" className="inp" style={{ width: 84, minHeight: 38, padding: "6px 8px" }}
                value={(v[countsKey] || {})[sid] ?? ""} placeholder="fő"
                aria-label={`Létszám${key === "vissza" ? " hazafelé" : ""}: ${st?.name || ""}`}
                onChange={(e) => setCount(countsKey, sid, e.target.value)} />
            </div>
          );
        })}
      </div>
      <p className="text-xs mt-2" style={{ color: "var(--ink2)" }}>
        {key === "oda"
          ? <>Az optimalizáló ennek az összegét használja. Ha minden mező üres, a megadott összlétszám számít{v.passengerCount ? ` (most ${v.passengerCount} fő)` : ""}.</>
          : "A visszaút kapacitását és buszokra bontását ez határozza meg — az odaúttól függetlenül."}
      </p>
    </div>
  );

  return (
    <>
      <h3 className="disp text-base mb-2">Állomások (felszállóhelyek)</h3>
      <div className="flex gap-2 flex-wrap mb-1">
        {state.stations.map((s) => (
          <button key={s.id} className={`chip ${stationIds.includes(s.id) ? "on" : ""}`}
            onClick={() => toggle("stationIds", s.id)}>{s.name}</button>
        ))}
        {state.stations.length === 0 && <span className="text-sm" style={{ color: "var(--ink2)" }}>Vegyél fel állomást az Adatok fülön.</span>}
      </div>
      <p className="text-xs mb-2 px-1" style={{ color: "var(--ink2)" }}>A fuvarokhoz csak a bekapcsolt állomások választhatók.</p>
      {stationIds.length > 0 && countRows("oda", stationIds, "stationCounts", "Létszám megállónként")}

      {stationIds.length > 1 && (
        <div className="card p-3 mb-4">
          <h4 className="disp text-sm mb-2">Útvonal (felszállási sorrend)</h4>
          <div className="seg mb-3">
            <button className={(v.routeMode || "auto") === "auto" ? "on" : ""} onClick={() => onChange({ routeMode: "auto" })}>Automatikus</button>
            <button className={v.routeMode === "manual" ? "on" : ""} onClick={() => onChange({ routeMode: "manual" })}>Kézi sorrend</button>
          </div>
          {(v.routeMode || "auto") === "auto" ? (
            <>
              <Field label="Kezdő megálló" hint="Az odaút első megállójaként rögzítjük; üresen a leggyorsabb sorrend nyer.">
                <select className="inp" value={v.routeAnchorId || ""} onChange={(e) => onChange({ routeAnchorId: e.target.value || null })}>
                  <option value="">— szabad (leggyorsabb) —</option>
                  {stationIds.map((sid) => <option key={sid} value={sid}>{byId(state.stations, sid)?.name || "?"}</option>)}
                </select>
              </Field>
              {venueId && (() => {
                const order = legRouteOrder(state, v, null, venueId, "oda");
                const p0 = planOda(state, order, venueId, 0, state.settings.dwellMin ?? 2);
                return (
                  <p className="text-xs" style={{ color: "var(--ink2)" }}>
                    Számított sorrend ({venueName || "helyszín"} felé): <b>{order.map((id) => byId(state.stations, id)?.name || "?").join(" → ")}</b> · össz. {Math.round(-p0.start)} perc az első megállótól.
                  </p>
                );
              })()}
            </>
          ) : (
            <p className="text-xs" style={{ color: "var(--ink2)" }}>
              A megállók bekapcsolási sorrendje a felszállási sorrend
              {returnIds ? "; a visszaútnak saját sorrendje van (lentebb)." : "; a VISSZA irány ennek fordítottja."}
            </p>
          )}
        </div>
      )}

      <h3 className="disp text-base mb-2">Visszaút (leszállóhelyek)</h3>
      <div className="seg mb-2">
        <button className={!returnIds ? "on" : ""} onClick={() => setReturnOwn(false)}>Megegyezik az odaúttal</button>
        <button className={returnIds ? "on" : ""} onClick={() => setReturnOwn(true)}>Külön lista</button>
      </div>

      {!returnIds ? (
        <p className="text-xs mb-4 px-1" style={{ color: "var(--ink2)" }}>
          A busz hazafelé ugyanazokat a megállókat érinti, fordított sorrendben. Válaszd a <b>Külön lista</b> opciót, ha a gyerekek máshol szállnak le, mint ahol felszálltak.
        </p>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap mb-1">
            {state.stations.map((s2) => (
              <button key={s2.id} className={`chip ${returnIds.includes(s2.id) ? "on" : ""}`}
                onClick={() => toggle("returnStationIds", s2.id)}>{s2.name}</button>
            ))}
          </div>
          <p className="text-xs mb-2 px-1" style={{ color: "var(--ink2)" }}>
            Ezek teljesen függetlenek az odaút megállóitól — lehet kevesebb, több vagy egészen más.
          </p>

          {returnIds.length > 0 && countRows("vissza", returnIds, "returnStationCounts", "Létszám megállónként (vissza)")}

          {returnIds.length > 1 && (v.routeMode || "auto") === "auto" && (
            <div className="card p-3 mb-4">
              <Field label="Utolsó megálló (vissza)" hint="A hazaút végére rögzítjük; üresen a leggyorsabb sorrend nyer.">
                <select className="inp" value={v.returnRouteAnchorId || ""} onChange={(e) => onChange({ returnRouteAnchorId: e.target.value || null })}>
                  <option value="">— szabad (leggyorsabb) —</option>
                  {returnIds.map((sid) => <option key={sid} value={sid}>{byId(state.stations, sid)?.name || "?"}</option>)}
                </select>
              </Field>
              {venueId && (
                <p className="text-xs" style={{ color: "var(--ink2)" }}>
                  Számított sorrend ({venueName || "helyszín"} felől):{" "}
                  <b>{legRouteOrder(state, v, null, venueId, "vissza").map((id) => byId(state.stations, id)?.name || "?").join(" → ")}</b>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
