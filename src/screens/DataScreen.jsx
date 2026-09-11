/* Fuvarterv — the Data tab: teams and master data under one heading.

   A thin router: it owns the category selection and delegates every category to its own
   screen. */

import { useState } from "react";
import { DangerBtn } from "../ui/base.jsx";
import { TeamsScreen } from "./TeamsScreen.jsx";
import { MasterScreen } from "./MasterScreen.jsx";
import { UsersPanel } from "./UsersPanel.jsx";

/* ---------- Data: teams and master data in one place ---------- */
export const DATA_CATS = [
  { key: "teams", label: "Csapatok" },
  { key: "stations", label: "Állomások" },
  { key: "venues", label: "Helyszínek" },
  { key: "bases", label: "Telephelyek" },
  { key: "vehicles", label: "Járművek" },
  { key: "drivers", label: "Sofőrök" },
  { key: "users", label: "Felhasználók" },
];

export function DataScreen({ state, update, resetSeed, notice, setNotice, myEmail }) {
  const [sub, setSub] = useState("teams");
  return (
    <div className="pb-4">
      <div className="data-cats flex gap-2 overflow-x-auto px-4 pt-3 pb-1">
        {DATA_CATS.map((c) => (
          <button key={c.key} className={`chip ${sub === c.key ? "on" : ""}`} style={{ whiteSpace: "nowrap" }}
            onClick={() => { setSub(c.key); setNotice(""); }}>{c.label}</button>
        ))}
      </div>
      {sub === "teams" && <TeamsScreen state={state} update={update} notice={notice} />}
      {sub === "users" && <UsersPanel myEmail={myEmail} />}
      {sub !== "teams" && sub !== "users" && (
        <MasterScreen tab={sub} state={state} update={update} notice={notice} setNotice={setNotice} />
      )}

      {/* Egyszer, az Adatok fül alján — korábban mind a négy törzsadat-alfülön
          ott volt, vagyis a teljes valós adat felülírása négy helyen, két
          kattintásra volt elérhető. A Felhasználók alfülön nincs értelme: a
          szerepkörök nem részei a munkaterület-adatnak. */}
      {sub !== "users" && (
        <div className="mt-8 mb-2 flex justify-center">
          <DangerBtn label="Mintaadatok visszaállítása" confirmLabel="Minden adat felülíródik!" onConfirm={resetSeed} />
        </div>
      )}
    </div>
  );
}
