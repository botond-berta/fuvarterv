import { useEffect, useState } from "react";
import { supabase, WORKSPACE_ID } from "./supabaseClient.js";
import "./ui/styles.css";

/*
 * Lists earlier snapshots and restores one. supabaseStorage writes a snapshot (the
 * PREVIOUS blob) to app_state_history on every successful save.
 *
 * Restoring goes through the NORMAL guarded write (window.storage.set), so it does
 * not bypass the "changed elsewhere" check, and then reloads the page so the app
 * boots on the restored data.
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
          // The usual cause is that the schema was never applied, so the table does
          // not exist. Without this the user would assume they simply have no
          // snapshots yet, when in fact none will ever be created.
          const missing = error.code === "42P01" || /relation .* does not exist/i.test(error.message || "");
          setErr(missing
            ? "Az előzménytábla hiányzik az adatbázisból — az adatbázis-séma (supabase/migrations/0001_initial_schema.sql) nem futott le. Amíg ez így van, nem készül biztonsági mentés."
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
      // The normal guarded write. If somebody else saved in the meantime this fails
      // and the "changed elsewhere" warning takes over; we never overwrite blindly.
      await window.storage.set(WORKSPACE_ID, JSON.stringify(row.data));
      window.location.reload();
    } catch {
      setBusyId(null);
      setErr("A visszaállítás nem sikerült (lehet, hogy közben máshol módosult az adat). Töltsd újra az oldalt, és próbáld meg ismét.");
    }
  };

  return (
    <div className="shell-overlay" onClick={onClose}>
      <div className="shell-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shell-modal-head">
          <span className="t">Korábbi mentések</span>
          <button onClick={onClose} aria-label="Bezárás" className="shell-modal-x">×</button>
        </div>
        <p className="lead">
          Minden mentés előtti állapotot eltárolunk (az utolsó 20-at). Egy visszaállítás
          a kiválasztott állapotot teszi az aktuálissá, és újratölti az oldalt. A mostani
          állapot is bekerül az előzmények közé.
        </p>

        {err && <div className="shell-errbox">{err}</div>}

        {rows === null && <div className="shell-muted">Betöltés…</div>}
        {rows !== null && rows.length === 0 && !err && (
          <div className="shell-muted">Még nincs korábbi mentés. Az első mentés után jelennek meg itt a korábbi állapotok.</div>
        )}

        <div className="shell-list">
          {(rows || []).map((row) => (
            <div key={row.id} className="shell-snap">
              <div className="when">{fmtWhen(row.saved_at)}</div>
              <div className="counts">{counts(row.data) || "üres vagy ismeretlen tartalom"}</div>
              {confirmId === row.id ? (
                <div className="shell-snap-actions">
                  <span className="q">Biztosan visszaállítod?</span>
                  <button className="shell-btn shell-btn-primary shell-btn-sm" disabled={busyId === row.id} onClick={() => restore(row)}>
                    {busyId === row.id ? "Visszaállítás…" : "Igen"}
                  </button>
                  <button className="shell-btn shell-btn-ghost shell-btn-sm" onClick={() => setConfirmId(null)}>Mégse</button>
                </div>
              ) : (
                <button className="shell-btn shell-btn-ghost shell-btn-sm" onClick={() => setConfirmId(row.id)}>Visszaállítás</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
