# Fuvarterv — döntésnapló (ADR)

Ez a napló a **tervezési döntéseket** rögzíti: mi volt a helyzet, mit választottunk,
mi ennek az ára, és mit vetettünk el. A cél, hogy egy későbbi módosítás ne írjon
felül tudatos döntést véletlenül — és hogy ha mégis felül kell írni, tudjuk, mibe
nyúlunk bele.

A döntések a kódból és a kód kommentjeiből visszafejtve, utólag lettek leírva; a
státusz azt jelenti, hogy a döntés **ma is érvényes**, hacsak más nem szerepel.

Formátum: **kontextus → döntés → következmény → elvetett alternatíva → hol él**.

| # | Döntés | Terület |
|---|---|---|
| [ADR-01](#adr-01--az-egész-állapot-egyetlen-json-blob) | Egyetlen JSON blob | perzisztencia |
| [ADR-02](#adr-02--a-windowstorage-kv-varrat-megtartása) | `window.storage` varrat | perzisztencia |
| [ADR-03](#adr-03--fuvartervjsx-barrelként-marad) | Barrel-fájl | modulszerkezet |
| [ADR-04](#adr-04--egyirányú-rétegzés-a-geo-levélmodullal) | Rétegzés, `geo` levél | modulszerkezet |
| [ADR-05](#adr-05--nincs-globális-állapotkezelő) | Nincs store | állapot |
| [ADR-06](#adr-06--kliensoldali-alaknormalizálás-ensureshape-verziószám-nélkül) | `ensureShape` | migráció |
| [ADR-07](#adr-07--egyszerkesztős-modell-optimista-őrrel) | Optimista őr | konkurencia |
| [ADR-08](#adr-08--az-elveszett-válasz-megkülönböztetése-a-valódi-ütközéstől) | Elveszett válasz | konkurencia |
| [ADR-09](#adr-09--mentési-előzmény-best-effort-20-pillanatkép) | Előzmény | perzisztencia |
| [ADR-10](#adr-10--nincs-saját-backend-supabase--vercel) | Nincs backend | infrastruktúra |
| [ADR-11](#adr-11--szerepkörök-e-mail-alapján-fail-closed) | Szerepkörök | biztonság |
| [ADR-12](#adr-12--az-rls-a-határ-a-felület-csak-ux) | RLS a határ | biztonság |
| [ADR-13](#adr-13--háromfázisú-optimalizálás-egyetlen-egzakt-modell-helyett) | 3 fázis | optimalizálás |
| [ADR-14](#adr-14--heldkarp-10-megállóig) | Held–Karp | optimalizálás |
| [ADR-15](#adr-15--a-fizetett-idő-telephelytől-telephelyig-tart) | Telephely, műszak | optimalizálás |
| [ADR-16](#adr-16--kemény-korlátok-és-egyetlen-puha-tag) | Kemény/puha korlát | optimalizálás |
| [ADR-17](#adr-17--kapacitásbontás-megállónként-first-fit-decreasing) | Feladatfelosztás | optimalizálás |
| [ADR-18](#adr-18--a-beosztás-a-fuvarok-forrása) | Beosztás → fuvarok | domain |
| [ADR-19](#adr-19--a-koordináta-kötelező) | Kötelező koordináta | domain |
| [ADR-20](#adr-20--üresjárati-mátrix-egyetlen-osrm-hívásból-kulccsal-invalidálva) | Mátrix | külső szolgáltatás |
| [ADR-21](#adr-21--leaflet-lusta-betöltés--offline-tartalék) | Térkép + tartalék | felület |
| [ADR-22](#adr-22--csp-unsafe-inline-nélkül) | CSP | biztonság |
| [ADR-23](#adr-23--eseményalapú-varrat-az-app-és-a-shell-között) | Esemény-varrat | architektúra |
| [ADR-24](#adr-24--explicit-0-és-üres-létszám-megkülönböztetése) | 0 vs. üres | domain |
| [ADR-25](#adr-25--minden-kihagyás-indoklást-kap) | Indoklások | domain/UX |
| [ADR-26](#adr-26--magyar-felület-és-kommentek-angolos-azonosítók) | Nyelv | konvenció |
| [ADR-27](#adr-27--tesztek-a-barrelen-keresztül-vitest--jsdom) | Tesztstratégia | tesztelés |
| [ADR-28](#adr-28--hibahatár-a-shellen-belül) | ErrorBoundary | hibakezelés |

---

## ADR-01 — Az egész állapot egyetlen JSON blob

**Kontextus.** Néhány tucat entitás (csapatok, állomások, járművek, sofőrök, edzések,
fuvarok), erősen összefüggő olvasási mintákkal: a beosztás és az ütközésvizsgálat
lényegében mindent egyszerre néz. Az app egy Claude-artifactból nőtt ki, ahol csak
egy kulcs-érték tároló volt.

**Döntés.** A teljes munkaterület egyetlen JSON objektum, amely egyetlen
`app_state` sorban él.

**Következmény.** Atomi mentés és triviális visszaállítás; nincs join, nincs
szerveroldali séma, nincs migrációs futtató. Cserébe nincs részleges mentés, nincs
valós idejű együttszerkesztés, és a blob mérete gyakorlati korlát.

**Elvetve.** Relációs séma entitásonkénti táblákkal — több nagyságrenddel több
infrastruktúra ahhoz a haszonhoz képest, amit ekkora adaton adna.

**Hol.** `src/data/storage.js`, `supabase/migrations/0001_app_state.sql`.

---

## ADR-02 — A `window.storage` KV varrat megtartása

**Kontextus.** Az eredeti artifact a sandbox `window.storage` API-ját használta. A
committolt Vite-projektben Supabase-re volt szükség.

**Döntés.** A varrat megmarad: az app továbbra is `window.storage.get/set`-et hív, és
az `AuthGate` import-időben egy Supabase-alapú implementációt tesz a helyére.

**Következmény.** A perzisztencia **egyetlen, szűk ponton** cserélhető (teszt, más
backend, offline mód), és az app-kód nem tud semmit az adatbázisról. Ára: a szerződés
nem típusos, és a `set` már stringgé alakított értéket vár.

**Elvetve.** A Supabase kliens közvetlen hívása a képernyőkről — az minden képernyőt
az adatbázishoz kötött volna.

**Hol.** `src/supabaseStorage.js`, `src/AuthGate.jsx`, `src/data/storage.js`.

---

## ADR-03 — `fuvarterv.jsx` barrelként marad

**Kontextus.** A monolit szétvágásakor a `src/main.jsx` és az összes teszt ebből a
fájlból importált.

**Döntés.** A fájl megmarad, de csak újraexportál: az `App`-ot és a tesztek által
használt tiszta függvényeket.

**Következmény.** A szétvágás egyetlen importot sem tört el, és a tesztek függetlenek
a belső modulhatároktól. Ára: új publikus függvényt fel kell venni az export-listára,
és a fájl szerepét minden új fejlesztőnek el kell magyarázni (a fájl fejléce megteszi).

**Elvetve.** A fájl törlése és minden import átírása — a tesztek egyszerre változtak
volna a kóddal, elveszítve a biztonsági hálót pont a legkockázatosabb átalakításkor.

**Hol.** `fuvarterv.jsx`.

---

## ADR-04 — Egyirányú rétegzés, a `geo` levélmodullal

**Kontextus.** A `logic.rideWindow` és az `optimizer.genDayTasks` is menetidőt számol.

**Döntés.** `screens → ui → domain → data`, és a `legMin` külön levélmodulba
(`domain/geo.js`) kerül.

**Következmény.** Nincs körkörös függés `logic` és `optimizer` között, és a domain
tesztelhető böngésző nélkül. Ára: a szabályt ma nem gép őrzi (lásd R6 az
architektúra-dokumentumban).

**Hol.** `src/domain/geo.js` fejléce.

---

## ADR-05 — Nincs globális állapotkezelő

**Kontextus.** Minden képernyő az egész állapotot olvassa, a mentés blob-alapú.

**Döntés.** Egyetlen `useState` az `App`-ban, `state` és `update(fn)` propokként lefelé.

**Következmény.** Nincs kitalálandó absztrakció, a mentés triviálisan összeköthető az
állapottal (blob-összehasonlítás), és minden képernyő ugyanabból a pillanatképből
számol. Ára: minden módosítás újrarendereli a fát — a klub léptékében észrevehetetlen.

**Elvetve.** Redux/Zustand/Context-store — a valódi problémát (perzisztencia,
ütközés, optimalizálás) egyik sem oldotta volna meg.

**Hol.** `src/App.jsx`.

---

## ADR-06 — Kliensoldali alaknormalizálás (`ensureShape`), verziószám nélkül

**Kontextus.** A blobnak nincs szerveroldali sémája, viszont a mezőkészlet fejlődik.

**Döntés.** Betöltéskor minden állapot átmegy az `ensureShape`-en, amely minden felső
szintű gyűjteményt normalizál, és az **új mezők alapértéke pontosan a korábbi
viselkedést adja**. Nincs verziószám és nincs lépcsős migrációs lánc.

**Következmény.** Régi mentés mindig betölthető, és egy új mező bevezetése nem
igényel adatmigrációt. Ára: az `ensureShape` idővel hosszú lesz, és a „mi volt a
korábbi viselkedés” tudás a kommentjeiben él — ezért vannak ott hosszú kommentek.

**Hol.** `src/data/seed.js`.

---

## ADR-07 — Egyszerkesztős modell optimista őrrel

**Kontextus.** A klubban gyakorlatilag egy ember szerkeszt, de két böngészőlap
könnyen előfordul.

**Döntés.** A tároló megjegyzi a legutóbb olvasott `updated_at`-et, és csak akkor ír,
ha a sor még mindig ugyanaz. Ütközéskor blokkoló overlay, ami újratöltésre kényszerít.

**Következmény.** Senki adata nem vész el csendben. Ára: a vesztes fél elveszíti a nem
mentett módosításait — ezt az overlay ki is mondja.

**Elvetve.** Utolsó írás nyer (adatvesztés), illetve mezőszintű merge (megoldhatatlan
blobon, és kezelhetetlen felület ennek a felhasználói körnek).

**Hol.** `src/supabaseStorage.js` (`doSet`), `AuthGate` `StaleOverlay`.

---

## ADR-08 — Az elveszett válasz megkülönböztetése a valódi ütközéstől

**Kontextus.** Ha egy írás a szerveren lefut, de a válasz elvész (hálózat), az őr
0 sort talál — pontosan úgy, mintha más mentett volna. A munkaterület indokolatlanul
blokkolódott.

**Döntés.** A tároló megjegyzi az utoljára **megkísérelt** blobot; ütközéskor
visszaolvassa a sort, és ha a szerveren pont az áll, akkor a saját írása landolt:
átveszi az időbélyeget és újrapróbálja (egyszer).

**Következmény.** A hamis riasztás megszűnik, a valódi ütközés továbbra is blokkol.
Ára: egy extra olvasás ütközéskor, és a `jsonb` kulcssorrend miatt `stableStr`
összehasonlítás kell.

**Hol.** `src/supabaseStorage.js` — `lastAttempt`, `stableStr`.

---

## ADR-09 — Mentési előzmény: best-effort, 20 pillanatkép

**Kontextus.** Egy rossz felülírás (vagy „mintaadat visszaállítása”) az egész
munkaterületet elviheti.

**Döntés.** Minden sikeres felülíráskor az **előző** blob bekerül az
`app_state_history`-ba; a kliens 20 pillanatképre nyes. Az előzmény írása minden
hibát elnyel, és azonos blobot nem archivál.

**Következmény.** Van visszaút, és az előzmény sosem buktat el egy mentést. Ára: ha a
`0002` migráció nem futott le, a felület „nincs mentés”-t mutatna — ezért a
`RestorePanel` külön felismeri és megnevezi ezt az esetet.

**Hol.** `src/supabaseStorage.js` (`archivePrevious`), `src/RestorePanel.jsx`.

---

## ADR-10 — Nincs saját backend: Supabase + Vercel

**Kontextus.** Egyetlen fejlesztő, klubméretű felhasználószám, nulla üzemeltetési
kapacitás.

**Döntés.** Statikus SPA a Vercelen, adat és belépés Supabase-ből, minden logika a
kliensben.

**Következmény.** Nincs üzemeltetendő szerver és nincs deploy-koreográfia. Ára:
minden védelemnek az adatbázisban kell lennie (ADR-12), és nincs hely szerveroldali
validációnak (R9).

**Hol.** `vercel.json`, `supabase/`.

---

## ADR-11 — Szerepkörök e-mail alapján, fail-closed

**Kontextus.** Két felhasználótípus kell: admin (mindent) és sofőr (csak a saját napi
tervét olvassa). Az adminnak a dashboard megnyitása nélkül kell szerepet osztania.

**Döntés.** `user_roles` tábla **e-mail** kulccsal; a jogosultságot az `is_admin()`
SQL-függvény dönti el a JWT e-mailjéből. Akinek nincs sora, az sofőr.

**Következmény.** Szerepet olyan címnek is lehet adni, amely még nem lépett be, és egy
elfelejtett fiók nem tud írni. Ára: e-mail-változtatás új sort igényel.

**Egy szándékos kivétel.** Ha a `user_roles` tábla nem létezik (a `0004` nem futott
le), a kliens mindenkit adminnak vesz — ilyenkor a szerver sem korlátoz, tehát az
elrejtés csak színház lenne, viszont e nélkül egy új kliens olvasásra némítana egy
régi adatbázist.

**Hol.** `supabase/migrations/0004_user_roles.sql`, `src/AuthGate.jsx` (`fetchRole`).

---

## ADR-12 — Az RLS a határ, a felület csak UX

**Kontextus.** A teljes alkalmazás a böngészőben fut, az anon kulcs a bundle-ben
utazik.

**Döntés.** Minden jogosultsági szabály az adatbázisban él (RLS + `is_admin()`); a
felületi szerepkör-őrök kizárólag azért vannak, hogy a sofőr ne kapjon értelmetlen
gombokat és tiltott írásokat. A modell másik fele egy konzolbeállítás: a **publikus
regisztráció kikapcsolása**.

**Következmény.** A kliens megkerülése nem ad többletjogot. Ára: a beállítás nem
verziókezelhető — ezért szerepel a README-ben, a migrációk README-jében és a `0003`
fejlécében is.

**Hol.** `supabase/migrations/0003_tighten_rls.sql`, `0004_user_roles.sql`.

---

## ADR-13 — Háromfázisú optimalizálás egyetlen egzakt modell helyett

**Kontextus.** Az ütemezés (ki, mivel, mikor, milyen sorrendben) NP-nehéz, és a
böngészőben, másodperc alatt kell lefutnia.

**Döntés.** (1) láncolás min-költségű folyammal átlagbéren, (2) egzakt visszalépéses
(sofőr, jármű) hozzárendelés a valódi költségen, iterációkorláttal, (3) lokális
javítás összevonásokkal, szigorú javulási feltétellel.

**Következmény.** Gyakorlati optimumközeli megoldás, magyarázható lépésekkel; ha a
keresés a korlátba ütközik, azt a rendszer **kimondja** (`capped` → „heurisztikus”).
Ára: nincs optimumgarancia, és a fázisok költségfüggvényeit szinkronban kell tartani
(lásd ADR-16 aranyszabálya).

**Elvetve.** MILP/CP-SAT megoldó — böngészőben nem futtatható ésszerű mérettel és
függőségekkel.

**Hol.** `src/domain/optimizer.js` — `minCostChains`, `assignResources`, `optimizeDay`.

---

## ADR-14 — Held–Karp 10 megállóig

**Kontextus.** A megállósorrend egy kis TSP-változat, rögzíthető első/utolsó
megállóval és a helyszínnel mint végponttal.

**Döntés.** Egzakt dinamikus programozás (`2^n × n`) legfeljebb 10 megállóig; felette
a beadott sorrend marad.

**Következmény.** A valós körökre (3–8 megálló) bizonyítottan optimális sorrend,
azonnal. Ára: 10 fölött nincs optimalizálás — ez ma nem fordul elő, de ha mégis, a
következő lépés egy beszúrásos heurisztika + 2-opt, nem a korlát emelése.

**Hol.** `bestStationOrder`.

---

## ADR-15 — A fizetett idő telephelytől telephelyig tart

**Kontextus.** Korábban a fizetett idő a feladatoktól számított, így egy távoli
helyszínen várakozó sofőrről a rendszer hallgatólagosan feltételezte, hogy hazament.
A valóságban ott várt — fizetve.

**Döntés.** A sáv a telephelytől a telephelyig tart (`spanOf`), az egymásba érő sávok
egy műszakká olvadnak (`mergeShifts`), és a **kiszállási díj műszakonként** jár. A
telephely járművenként állítható, `null` esetén a klubé (`settings.defaultBaseId`).

**Következmény.** A „hazamehet-e két fuvar között?” kérdésre nem kell külön szabály:
ha nincs idő rá, a sávok átfednek, tehát egy műszak van, benne a fizetett várakozással
(`onSiteWait`). Telephely hiányában a számítás a korábbi (E8).

**Hol.** `spanOf`, `mergeShifts`, `driverPay`, `onSiteWait`; `test/base-shift.test.js`.

---

## ADR-16 — Kemény korlátok és egyetlen puha tag

**Kontextus.** A férőhely és a matrica fizikai korlát; a „a sofőr a szokott buszát
vigye” viszont preferencia.

**Döntés.** Kemény korlát kizárja az opciót (kapacitás, matrica, elérhetőség,
erőforrás-ütközés, zárolás); a preferált jármű **puha**, forintban kifejezett
büntetés (`settings.preferredBias`, 0 = kikapcsolva).

**Következmény.** Az optimalizálás eleve nem ad olyan javaslatot, amit kézzel vissza
kellene javítani, a preferencia mégis felülírható, ha valódi megtakarítás áll vele
szemben.

> **Aranyszabály.** Aki új költségtagot vezet be, ugyanazt a tagot a csontváz-láncok
> árába (`skelCost`) is tegye bele. Amikor ez elcsúszott, a javítóciklus torzított és
> torzítatlan költséget hasonlított össze, és az optimalizálás *után* nőtt a kijelzett
> napi költség.

**Hol.** `assignResources`, `skelCost` az `optimizeDay`-ben; `test/vignette.test.js`.

---

## ADR-17 — Kapacitásbontás megállónként (first-fit-decreasing)

**Kontextus.** Egy 12–14 fős csapat nem fér egy 8 személyes buszba.

**Döntés.** Ha a létszám meghaladja a legnagyobb jármű férőhelyét, a feladat
**megállónként** bomlik buszokra: egy megálló teljes létszáma egy buszba kerül, a
csomagolás first-fit-decreasing a lehető legkevesebb buszba. Minden rész önálló,
párhuzamos fuvar, saját optimális útvonallal és menetrenddel.

**Következmény.** Nincs „fél megálló”: a gyerekek nem oszlanak szét ugyanannál a
megállónál két busz között, ami a gyakorlatban kezelhetetlen lenne. Ára: nem osztható
az a feladat, ahol egyetlen megálló önmagában nagyobb egy busznál, vagy ahol nincs
megállónkénti bontás — ezeket a rendszer **pontos indoklással** hagyja ki (ADR-25).

**Hol.** `splitStationsByCapacity`, `genDayTasks`.

---

## ADR-18 — A beosztás a fuvarok forrása

**Kontextus.** A beosztás (láncok) és a fuvarok (`rides`) sokáig két külön világ volt:
az optimalizált beosztás nem látszott a Hét és a Sofőr nézetben.

**Döntés.** A javaslat alkalmazása (és a külön gomb) **materializálja** a láncokat
fuvarokká: feladatonként egy fuvar, iránnyal (`dir`) és `source: "schedule"`
jelöléssel. A generálás lecseréli az adott nap érintett edzéseinek **összes** fuvarját.

**Következmény.** Egy forrás van, tehát nincs két, egymásnak ellentmondó igazság; a
beosztás megjelenik minden nézetben, és részt vesz az ütközésvizsgálatban. Ára: a
generált fuvar kézi módosítása a következő generáláskor felülíródik — ezt a felület
megerősítéssel kérdezi meg.

**Részlet, ami könnyen elromlik.** ODA-nál a megálló kiírt ideje az **indulás**
(felszállás után), VISSZA-nál az **érkezés** (leszállás). Amíg mindkét irányban az
érkezés került ki, a Hét nézet ütközésablaka `dwellMin` percet csúszott a beosztáshoz
képest.

**Hol.** `ridesFromChains`, `withGeneratedRides`; `test/ride-direction.test.jsx`.

---

## ADR-19 — A koordináta kötelező

**Kontextus.** Koordináta nélküli pontnál a `legMin` a `fallbackLegMin`-re esik
vissza, és a pont kimarad a mátrixból — az optimalizáló órákat tervez rossz
menetidőkkel, jelzés nélkül.

**Döntés.** Állomás, helyszín és telephely **nem menthető** koordináta nélkül; a régi,
koordináta nélküli rekordok figyelmeztetést kapnak, és a szerkesztésük is csak
koordinátával zárható le. A koordináta térképen jelölhető, vagy beilleszthető
(Google Maps formátum, tizedesvessző elfogadva).

**Következmény.** A menetidők megbízhatóak. Ára: egy plusz lépés minden új pont
felvételekor — a térképválasztó és a beillesztés ezt olcsóvá teszi.

**Hol.** `MasterForm` (`needsCoord`); `test/master-coord.test.jsx`.

---

## ADR-20 — Üresjárati mátrix egyetlen OSRM hívásból, kulccsal invalidálva

**Kontextus.** Pontpáronkénti útvonalkérés több száz hívás lenne, és a Nominatim/OSRM
demószolgáltatások korlátozottak.

**Döntés.** Egyetlen OSRM `table` hívás minden koordinátás pontra; az eredmény a
blobban tárolódik `key`, `source`, `computedAt`, `n` mezőkkel. A `key` az összes pont
id-jét és kerekített koordinátáját tartalmazza, így a felület jelezni tudja, ha a
mátrix elavult.

**Következmény.** Egy kérés, gyors ismételt számítás, és látható „elavult” állapot.
Ára: a mátrix csak kézi gombnyomásra frissül (szándékosan — ADR-25 szellemében a
felület jelzi, ha kellene).

**Hol.** `computeMatrix`, `matrixKey`; `ScheduleScreen` mátrixgombja.

---

## ADR-21 — Leaflet lusta betöltés + offline tartalék

**Kontextus.** A térkép csak a koordinátaválasztáshoz kell, a könyvtár CDN-ről jön, és
a futtatókörnyezet (artifact-előnézet, szigorú CSP, hálózat nélküli sandbox) blokkolhatja.

**Döntés.** A Leaflet és a CSS a modál **első** megnyitásakor töltődik be, egyszer
befűzött `<link>`-kel és hibaágon takarított `<script>`-tel. Ha nem tölthető be, egy
beépített SVG-választó jelenik meg a meglévő pontokkal, rácssal, közeli pontra
snappeléssel.

**Következmény.** A koordináta-megadás **soha nem lehetetlen**, csak kényelmetlenebb.
Ára: két választó felület karbantartása.

**Hol.** `src/ui/MapPicker.jsx` — `loadLeaflet`, `OfflinePicker`.

---

## ADR-22 — CSP `'unsafe-inline'` nélkül

**Kontextus.** Statikus hosting, külső CDN-ek, térképcsempék.

**Döntés.** A `vercel.json` CSP-je pontosan a használt origókat engedi, és nincs benne
`'unsafe-inline'`: a production `index.html`-ben nincs inline script/stílus, a React és
a Leaflet pedig CSSOM-on át állít stílust, amit a CSP nem szabályoz.

**Következmény.** Szigorú védelem XSS ellen. Ára: minden új külső szolgáltatás
kötelezően CSP-módosítást igényel, különben a böngésző **némán** blokkol — ez a
legkönnyebben elfelejthető lépés az egész projektben.

**Hol.** `vercel.json`.

---

## ADR-23 — Eseményalapú varrat az app és a shell között

**Kontextus.** Az `App` (artifact-örökség) nem importálhat auth-kódot, a
`supabaseStorage` viszont modul-szintű objektum, nem komponens — mégis kell, hogy
felületet tudjon vezérelni (ütközés, mentési hiba), és az appnak is el kell érnie a
shell funkcióit (kijelentkezés, korábbi mentések).

**Döntés.** Négy `CustomEvent` a `window`-on: `fuvarterv:stale`,
`fuvarterv:saveerror`, `fuvarterv:restore`, `fuvarterv:signout`.

**Következmény.** A két rész függetlensége megmarad, és a shell bármikor kicserélhető.
Ára: a kapcsolat nem típusos és nem követhető statikusan — ezért van a négy név
táblázatba szedve az architektúra-dokumentum 5.1 pontjában.

**Hol.** `src/AuthGate.jsx`, `src/supabaseStorage.js`, `src/App.jsx`, `src/ErrorBoundary.jsx`.

---

## ADR-24 — Explicit `0` és üres létszám megkülönböztetése

**Kontextus.** A megállónkénti létszámmezőnél két, teljesen különböző dolgot jelenthet
az „üresség”: *ide most nem kell menni* vagy *még nem adtuk meg*.

**Döntés.** A szerkesztő a kiürített mezőt `""`-ként, a beírt nullát számként tárolja.
A `0` fős megálló kimarad az útvonalból; az üres mező nem. A szállítandó létszám a
bontás és az összlétszám **maximuma**, tehát egy félig kitöltött bontás nem
rövidítheti le a csapatot.

**Következmény.** Nem marad gyerek a megállóban egy félig kitöltött táblázat miatt, és
a fölösleges kör is elkerülhető. Ára: a `""` vs. `0` különbséget minden új
létszámkezelő kódnak tiszteletben kell tartania.

**Hol.** `genDayTasks` (`zeroed`), `legPax`; `test/zero-count-stops.test.js`.

---

## ADR-25 — Minden kihagyás indoklást kap

**Kontextus.** A felhasználók nem fejlesztők; egy hiányzó fuvar okát nem tudják
kikövetkeztetni. A rendszer korábban némán hagyott ki feladatokat.

**Döntés.** Minden kihagyás és minden fedetlen feladat konkrét, magyar nyelvű
indoklást kap: nincs állomás, minden megállónál 0 fő, nincs létszámadat, nincs
elegendő férőhelyű (vagy matricás) jármű, nincs elérhető sofőr, erőforrás-ütközés,
elavult lánc. Ezek nem naplóüzenetek, hanem a modell kimenetének részei.

**Következmény.** A hiba a felhasználó számára javítható lesz. Ára: minden új korlát
kötelezően indoklással jár — ez a feature része, nem külön feladat.

**Hol.** `genDayTasks().skipped`, `optimizeDay().uncovered[].reasons`,
`contentionReasons`, `resolveDay` `issues` és `droppedChains`.

---

## ADR-26 — Magyar felület és kommentek, angolos azonosítók

**Kontextus.** A felhasználók magyar klubszemélyzet; a karbantartó is magyarul
gondolkodik a domainről (fuvar, telephely, matrica, lánc).

**Döntés.** A felület és a kódkommentek magyarul, az azonosítók angolosan (`legMin`,
`rideWindow`), a domain-szavak megtartott magyarsággal (`dir: "oda" | "vissza"`).
A kommentek **miért**-kommentek: a rossz viselkedést írják le, amit a kód kizár.

**Következmény.** A kód olvasható annak, aki a domaint ismeri; a kommentek egy része
gyakorlatilag a regressziók dokumentációja. Ára: kevert nyelvű kódbázis — a
szószedet a `DEVELOPER.md` végén oldja fel.

---

## ADR-27 — Tesztek a barrelen keresztül, Vitest + jsdom

**Kontextus.** A modulbontás közben a tesztek nem törhettek el, és a felület
renderelését is ellenőrizni kellett (a build nem veszi észre a hiányzó azonosítót).

**Döntés.** Vitest + jsdom; a tesztek a barrelből importálnak; a `window.storage`
varratot hamis tároló tölti ki; a smoke-teszt ténylegesen mountolja az `<App/>`-ot és
végigjárja a füleket; az optimalizálót property-tesztek fedik magvas PRNG-vel.

**Következmény.** A modulhatárok szabadon mozgathatók, a regressziók pedig
elmagyarázott tesztekként rögzülnek. Ára: a barrel export-listáját karban kell tartani.

**Hol.** `test/`, `vite.config.js` (`test` blokk), `.github/workflows/ci.yml`.

---

## ADR-28 — Hibahatár a shellen belül

**Kontextus.** Hibahatár nélkül egyetlen dobás bármelyik képernyőn fehér oldalt adott,
ahonnan a felhasználó el sem tudott navigálni, hogy a hibát okozó adatot kijavítsa.

**Döntés.** `ErrorBoundary` (osztálykomponens — React-ben csak így lehet), amely a
`RoleContext`-en **belül**, de a shell funkciói **fölött** áll: hiba esetén megmarad
az újratöltés és a „Korábbi mentések” gomb.

**Következmény.** Egy hibás adatrekord nem zárja ki a felhasználót a saját adataiból.
Ára: a határ csak a rendereléskor dobott hibát fogja el, az eseménykezelőkben
dobottakat nem.

**Hol.** `src/ErrorBoundary.jsx`, `src/AuthGate.jsx`.
