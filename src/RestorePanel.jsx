import { useEffect, useState } from "react";
import { supabase, WORKSPACE_ID } from "./supabaseClient.js";
import "./theme.css";

/*
 * Korábbi mentések (snapshots) listája és visszaállítása. A snapshotokat a
 * supabaseStorage írja az app_state_history táblába minden sikeres mentéskor
 * (az előző blobot). A visszaállítás a NORMÁL, őrzött íráson megy keresztül
 * (window.storage.set) — így nem kerüli meg a "máshol módosult" ellenőrzést —,
 * majd újratölti az oldalt, hogy az app a visszaállított adatot töltse be.
 */

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString("hu-HU", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function counts(d) {
  if (!d || typeof d !== "object") return "";
  const parts = [
    [d.teams, "csapat"],
    [d.drivers, "sofőr"],
    [d.vehicles, "jármű"],
    [d.trainings, "edzés"],
    [d.rides, "fuvar"],
  ];
  return parts
    .filter(([arr]) => Array.isArray(arr))
    .map(([arr, w]) => `${arr.length} ${w}`)
    .join(" · ");
}

export default function RestorePanel({ onClose }) {
  const [rows, setRows] = useState(null); // null=loading | [] | array
  const [err, setErr] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("app_state_history")
      .select("id, saved_at, data")
      .eq("workspace_id", WORKSPACE_ID)
      .order("saved_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // A leggyakoribb ok, hogy a 0002 migráció nem futott le: ilyenkor a
          // tábla nem létezik, és a felhasználó azt hinné, egyszerűen nincs még
          // mentése — pedig valójában soha nem is készül egy sem.
          const missing = error.code === "42P01" || /relation .* does not exist/i.test(error.message || "");
          setErr(missing
            ? "Az előzménytábla hiányzik az adatbázisból — a 0002_app_state_history.sql migráció nem futott le. Amíg ez így van, nem készül biztonsági mentés."
            : (error.message || "Nem sikerült betölteni az előzményeket."));
          setRows([]);
        } else setRows(data || []);
      })
      .catch(() => {
        if (cancelled) return;
        setErr("Nem sikerült betölteni az előzményeket (hálózati hiba).");
        setRows([]);
      });
    return () => { cancelled = true; };
  }, []);

  const restore = async (row) => {
    setBusyId(row.id);
    setErr("");
    try {
      // Normál őrzött írás — ha közben más mentett, ez elbukik és a "máshol
      // módosult" figyelmeztetés lép életbe (nem írjuk felül vakon).
      await window.storage.set(WORKSPACE_ID, JSON.stringify(row.data));
      window.location.reload();
    } catch {
      setBusyId(null);
      setErr("A visszaállítás nem sikerült (lehet, hogy közben máshol módosult az adat). Töltsd újra az oldalt, és próbáld meg ismét.");
    }
  };

  return (
    <div className="v-overlay" onClick={onClose}>
      <div className="v-modal" onClick={(e) => e.stopPropagation()}>
        <div className="v-modal-head">
          <span className="t">Korábbi mentések</span>
          <button onClick={onClose} aria-label="Bezárás" className="v-modal-x">×</button>
        </div>
        <p className="lead">
          Minden mentés előtti állapotot eltárolunk (az utolsó 20-at). Egy visszaállítás
          a kiválasztott állapotot teszi az aktuálissá, és újratölti az oldalt. A mostani
          állapot is bekerül az előzmények közé.
        </p>

        {err && <div className="v-errbox">{err}</div>}

        {rows === null && <div className="v-muted">Betöltés…</div>}
        {rows !== null && rows.length === 0 && !err && (
          <div className="v-muted">Még nincs korábbi mentés. Az első mentés után jelennek meg itt a korábbi állapotok.</div>
        )}

        <div className="v-list">
          {(rows || []).map((row) => (
            <div key={row.id} className="v-snap">
              <div className="when">{fmtWhen(row.saved_at)}</div>
              <div className="counts">{counts(row.data) || "üres vagy ismeretlen tartalom"}</div>
              {confirmId === row.id ? (
                <div className="v-snap-actions">
                  <span className="q">Biztosan visszaállítod?</span>
                  <button className="v-btn v-btn-primary v-btn-sm" disabled={busyId === row.id} onClick={() => restore(row)}>
                    {busyId === row.id ? "Visszaállítás…" : "Igen"}
                  </button>
                  <button className="v-btn v-btn-ghost v-btn-sm" onClick={() => setConfirmId(null)}>Mégse</button>
                </div>
              ) : (
                <button className="v-btn v-btn-ghost v-btn-sm" onClick={() => setConfirmId(row.id)}>Visszaállítás</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
