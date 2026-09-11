# Fuvarterv — dokumentáció

| Dokumentum | Mire válaszol | Kinek |
|---|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | **Miért így van felépítve?** Rétegek, invariánsok, adatáramlás, az ütemező pipeline, biztonsági modell, kockázatok. | aki módosítani vagy bővíteni fog |
| [`DECISIONS.md`](DECISIONS.md) | **Mit döntöttünk el, és mi volt a másik út?** 28 rövid döntésrekord (ADR). | aki egy meglévő döntést kérdőjelez meg |
| [`ACTION_PLAN.md`](ACTION_PLAN.md) | **Mit csináljunk ezután, és milyen sorrendben?** Prioritált teendők az átvilágításból, ellenőrzési lépésekkel. | aki a következő munkát tervezi |
| [`MAINTENANCE.md`](MAINTENANCE.md) | **Mit futtassak, mit ellenőrizzek?** Munkafolyamat, konvenciók, review- és deploy-ellenőrzőlisták, hibaelhárítás. | aki napi szinten dolgozik a kóddal |
| [`DEVELOPER.md`](DEVELOPER.md) | **Hogyan működik?** Fájlról fájlra, mezőről mezőre haladó referencia (angolul). | aki egy konkrét részletet keres |
| [`../README.md`](../README.md) | Mit tud a termék, hogyan kell beüzemelni (Supabase, futtatás, deploy). | aki telepíti vagy használja |
| [`../supabase/migrations/README.md`](../supabase/migrations/README.md) | Migrációk sorrendje, az első admin létrehozása, diagnosztika. | aki az adatbázist állítja be |

## Ajánlott olvasási sorrend

**Új fejlesztőként:** főoldali `README` → `ARCHITECTURE.md` 1–5. fejezet →
`MAINTENANCE.md` 1–3. → aztán a `DEVELOPER.md` abban a részben, amihez hozzányúlsz.

**Az ütemezőhöz:** `ARCHITECTURE.md` 10. fejezet → `DECISIONS.md` ADR-13…ADR-17 →
`src/domain/optimizer.js`.

**Hibakereséshez:** `MAINTENANCE.md` 7. fejezet (tünet → hol nézd) →
`ARCHITECTURE.md` „Hova nyúlj, ha…” táblázata.
