import { useEffect, useState } from "react";
import { supabase, WORKSPACE_ID } from "./supabaseClient.js";

/*
 * Korábbi mentések (snapshots) listája és visszaállítása. A snapshotokat a
 * supabaseStorage írja az app_state_history táblába minden sikeres mentéskor
 * (az előző blobot). A visszaállítás a NORMÁL, őrzött íráson megy keresztül
 * (window.storage.set) — így nem kerüli meg a "máshol módosult" ellenőrzést —,
 * majd újratölti az oldalt, hogy az app a visszaállított adatot töltse be.
 */

const overlay = {
  position: "fixed",
  inset: 0,
  zIndex: 1100,
  background: "rgba(18, 21, 28, 0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
};
const panel = {
  width: "100%",
  maxWidth: 480,
  maxHeight: "80vh",
  overflowY: "auto",
  background: "#1B1E27",
  color: "#fff",
  borderRadius: 14,
  padding: 20,
  fontFamily: "system-ui, sans-serif",
};
const btn = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "none",
  background: "#E8590C",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};
const ghost = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.25)",
  background: "transparent",
  color: "#fff",
  cursor: "pointer",
};

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
        if (error) { setErr(error.message || "Nem sikerült betölteni az előzményeket."); setRows([]); }
        else setRows(data || []);
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
    } catch (e) {
      setBusyId(null);
      setErr("A visszaállítás nem sikerült (lehet, hogy közben máshol módosult az adat). Töltsd újra az oldalt, és próbáld meg ismét.");
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>Korábbi mentések</span>
          <button onClick={onClose} aria-label="Bezárás" style={{ ...ghost, border: "none", fontSize: 20, padding: "2px 8px" }}>×</button>
        </div>
        <p style={{ color: "#B9C0CC", fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
          Minden mentés előtti állapotot eltárolunk (az utolsó 20-at). Egy
          visszaállítás a kiválasztott állapotot teszi az aktuálissá, és újratölti
          az oldalt. A mostani állapot is bekerül az előzmények közé.
        </p>

        {err && (
          <div style={{ background: "#C92A2A", padding: "8px 10px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{err}</div>
        )}

        {rows === null && <div style={{ color: "#B9C0CC" }}>Betöltés…</div>}
        {rows !== null && rows.length === 0 && !err && (
          <div style={{ color: "#B9C0CC" }}>Még nincs korábbi mentés. Az első mentés után jelennek meg itt a korábbi állapotok.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(rows || []).map((row) => (
            <div key={row.id} style={{ border: "1px solid #2A2F3A", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 600 }}>{fmtWhen(row.saved_at)}</div>
              <div style={{ color: "#B9C0CC", fontSize: 13, margin: "2px 0 10px" }}>{counts(row.data) || "üres vagy ismeretlen tartalom"}</div>
              {confirmId === row.id ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 13, flex: 1 }}>Biztosan visszaállítod?</span>
                  <button style={btn} disabled={busyId === row.id} onClick={() => restore(row)}>
                    {busyId === row.id ? "Visszaállítás…" : "Igen, visszaállítom"}
                  </button>
                  <button style={ghost} onClick={() => setConfirmId(null)}>Mégse</button>
                </div>
              ) : (
                <button style={ghost} onClick={() => setConfirmId(row.id)}>Visszaállítás</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
