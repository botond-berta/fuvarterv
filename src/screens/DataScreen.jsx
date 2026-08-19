/* Vector — Adatok — csapatok és törzsadatok egy fül alatt
   Kiemelve a fuvarterv.jsx-ből; a viselkedés változatlan. */

import { useState } from "react";
import { DangerBtn } from "../ui/base.jsx";
import { TeamsScreen } from "./TeamsScreen.jsx";
import { MasterScreen } from "./MasterScreen.jsx";

/* ---------- 4.x ADATOK — csapatok + törzsadatok egy helyen ---------- */
export const DATA_CATS = [
  { key: "teams", label: "Csapatok" },
  { key: "stations", label: "Állomások" },
  { key: "venues", label: "Helyszínek" },
  { key: "vehicles", label: "Járművek" },
  { key: "drivers", label: "Sofőrök" },
];

export function DataScreen({ state, update, resetSeed, notice, setNotice }) {
  const [sub, setSub] = useState("teams");
  return (
    <div className="pb-4">
      <div className="data-cats flex gap-2 overflow-x-auto px-4 pt-3 pb-1">
        {DATA_CATS.map((c) => (
          <button key={c.key} className={`chip ${sub === c.key ? "on" : ""}`} style={{ whiteSpace: "nowrap" }}
            onClick={() => { setSub(c.key); setNotice(""); }}>{c.label}</button>
        ))}
      </div>
      {sub === "teams"
        ? <TeamsScreen state={state} update={update} notice={notice} />
        : <MasterScreen tab={sub} state={state} update={update} notice={notice} setNotice={setNotice} />}

      {/* Egyszer, az Adatok fül alján — korábban mind a négy törzsadat-alfülön
          ott volt, vagyis a teljes valós adat felülírása négy helyen, két
          kattintásra volt elérhető. */}
      <div className="mt-8 mb-2 flex justify-center">
        <DangerBtn label="Mintaadatok visszaállítása" confirmLabel="Minden adat felülíródik!" onConfirm={resetSeed} />
      </div>
    </div>
  );
}
