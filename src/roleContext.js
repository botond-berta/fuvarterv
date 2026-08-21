/* Vector — szerepkör-kontextus: az AuthGate tölti fel, az App olvassa.
   Külön, apró modul: az App nem importálhat az AuthGate-ből (a varrat köztük
   eddig is eseményalapú volt), egy közös kontextus viszont mindkettőnek jár.

   Az alapérték szándékosan admin: csak provider NÉLKÜL él — tesztekben és a
   window.storage-shimmel futó fejlesztői környezetben, ahol nincs belépés és
   nincs mit korlátozni. Az éles útvonalon az AuthGate mindig providert ad, és
   ott a szerver dönt: akinek nincs user_roles sora, azt sofőrként engedi be. */

import { createContext } from "react";

export const RoleContext = createContext({ role: "admin", email: null });
