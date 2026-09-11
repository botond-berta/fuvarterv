# Fuvarterv — cselekvési terv

Ez a dokumentum egy 2026. szeptemberi kódbázis-átvilágítás eredménye: **mit érdemes
megcsinálni, milyen sorrendben, és miről tudjuk, hogy elkészült.** Nem hibalista — a
tételek többsége tudatos kompromisszum továbbvitele vagy egy felderített gyenge pont
lezárása.

A „miért így van” továbbra is az [`ARCHITECTURE.md`](ARCHITECTURE.md) és a
[`DECISIONS.md`](DECISIONS.md) dolga, a napi munkafolyamat a
[`MAINTENANCE.md`](MAINTENANCE.md)-é. Ez a fájl csak a **teendőket** rendezi sorba.

Ahol egy tétel az `ARCHITECTURE.md` [16. fejezetének](ARCHITECTURE.md#16-ismert-kockázatok-és-technikai-adósság)
kockázatát zárja le, ott az `R…` hivatkozás jelzi.

---

## 0. Az átvilágítás kiindulópontja

Minden szám a `main` ág állapotára vonatkozik, mért értékek (`npm run lint`,
`npm test`, `npm run build`):

| Mérőszám | Érték |
|---|---|
| Forrás (js/jsx) | 5 015 sor |
| Tesztek | 2 307 sor, 19 fájl, 168 teszt — mind zöld |
| Dokumentáció | 2 882 sor |
| SQL migrációk | 340 sor |
| Lint | 0 hiba, 20 figyelmeztetés |
| Production bundle | 523,85 kB (gzip 151,01 kB), egyetlen chunk |

**Ami erős, és amihez NEM nyúlunk:** az egyirányú rétegzés (`constants` →
`datetime`/`geo` → `logic` → `optimizer` → `ui` → `screens` → `App`, körkörös import
nélkül), a „komment = a kizárt hibás viselkedés” konvenció, a `test/optimizer.test.js`
invariáns-alapú property tesztje, a perzisztencia hibaágai (`NOT_FOUND` sentinel,
elveszett válasz felismerése, írás-sorosítás, 20 elemű előzmény), és a biztonsági
modell (az RLS a határ, a felület csak UX).

A terv ezeket **nem** bolygatja. Minden alábbi tétel a kimért gyenge pontokra megy.

---

## 1. Prioritások egy pillantásra

| # | Teendő | Méret | Kockázat | Zárja |
|---|---|---|---|---|
| **P0-1** | Production source map bekapcsolása | 1 sor | nincs | — |
| **P0-2** | A `taskHardIssues` és az optimalizáló indoklásainak egyesítése | ~1 óra | alacsony | ADR-25 megsértése |
| **P0-3** | A 20 lint-figyelmeztetés lenullázása | ~1 óra | nincs | — |
| **P0-4** | A munkaterület-kulcs egyetlen forrásra hozása | ~30 perc | alacsony | — |
| **P1-1** | Mintaadat anonimizálása | ~1 óra | nincs | R5 |
| **P1-2** | Stíluskezelés egységesítése | 1–2 nap | közepes | — |
| **P1-3** | A nagy képernyő-komponensek bontása | 1–2 nap | közepes | — |
| **P1-4** | Import-határok gépi őrzése | ~2 óra | alacsony | R6 |
| **P2-1** | Stabil feladatazonosító | 1–2 nap | **magas** | R1 |
| **P2-2** | Bundle-bontás (Leaflet, Supabase) | ~fél nap | alacsony | — |
| **P2-3** | Hibabejelentés éles környezetből | ~fél nap | alacsony | — |
| **P2-4** | Tesztek a modulokra, ne a barrelre | ~fél nap | alacsony | R8 |

**Javasolt sorrend:** a P0 egyetlen PR-ben is elfér. A P1 tételei függetlenek,
tetszőleges sorrendben mehetnek. A P2-1 előtt a P1-3-nak érdemes kész lennie (a
`ScheduleScreen` úgyis változik).

---

## 2. P0 — azonnali, olcsó, nagy haszon

### P0-1 · Production source map bekapcsolása

**Miért.** Az `ErrorBoundary` a teljes vermet kiírja a konzolra
(`src/ErrorBoundary.jsx`, `componentDidCatch`), a Vercelen viszont ez a verem
**minifikált**, tehát használhatatlan. Ha egy klubvezető azt mondja, hogy „hibakártya
jött”, ma csak helyi reprodukálással lehet elindulni. Ez a kódbázis leggyengébb
hibakeresési pontja, és egy soros a javítása.

**Mit.** A `vite.config.js`-ben:

```js
build: { sourcemap: true },
```

**Ellenőrzés.** `npm run build`, majd a `dist/assets/` alatt legyen `.js.map`. A
preview deployon idézz elő szándékos hibát (pl. egy képernyőn `throw new Error("x")`),
és a böngésző konzolján a verem forrásfájlra és sorra mutasson.

**Megjegyzés.** A source map publikus lesz. Ennél az alkalmazásnál ez nem titok: a
kód amúgy is a böngészőben fut, és nincs benne szerveroldali logika vagy kulcs (az
anon kulcs szándékosan publikus, a határ az RLS — lásd ADR-12).

---

### P0-2 · A `taskHardIssues` és az optimalizáló indoklásainak egyesítése

**Miért.** Két helyen él ugyanaz a megvalósíthatósági vizsgálat, és **már el is
csúszott egymástól**:

| Ellenőrzés | `optimizeDay` (`src/domain/optimizer.js`) | `taskHardIssues` (`src/screens/ScheduleScreen.jsx:17`) |
|---|---|---|
| férőhely (`pax > maxSeats`) | van | van |
| sofőr-elérhetőség | van | van |
| **országos matrica** | **van** | **nincs** |

Következmény: egy olyan fedetlen feladat, amit **csak** a matrica hiánya blokkol, a
„Fedetlen feladatok" listában **indoklás nélkül** jelenik meg. Ez pontosan az, amit az
[ADR-25](DECISIONS.md#adr-25--minden-kihagyás-indoklást-kap) tilt: néma kihagyás nincs.

**Mit.** A vizsgálat költözzön a domainbe, egyetlen függvénybe, és mindkét hívó azt
használja:

```js
// src/domain/optimizer.js
export function taskFeasibility(state, weekday, t) { /* a három ok, egy helyen */ }
```

- `optimizeDay` a „szabad feladatok kemény megvalósíthatósága” blokkban ezt hívja.
- A `ScheduleScreen` `taskHardIssues`-a megszűnik, helyette `taskFeasibility`.
- A barrel (`fuvarterv.jsx`) exportálja az újat, a régit ne.

**Ellenőrzés.** Új teszt: olyan állapot, ahol a helyszín `needsVignette: true`, és
egyik jármű sem matricás; a feladat kerüljön a fedetlenek közé, és a `reasons` tömbje
**ne** legyen üres. Ez a teszt a mai kódon bukik — ez a bizonyíték, hogy valódi a hiba.

---

### P0-3 · A 20 lint-figyelmeztetés lenullázása

**Miért.** Ma minden CI-futás 20 figyelmeztetéssel zöld. Egy 21. figyelmeztetés — akár
egy valódi hibára mutató — így észrevétlen marad. A zaj a lint értékét nullázza.

**Mit.**

1. **Kihasználatlan importok törlése** (9 db, mechanikus): `byId`
   (`MasterScreen.jsx:7`), `toISO` és `InfoDot` (`RideScreen.jsx:8,11`), `InfoDot` és
   `notice` (`TeamsScreen.jsx:11,91`), `InfoDot` (`WeekScreen.jsx:9`), `e`
   (`MapPicker.jsx:266`).
2. **`UsersPanel.jsx:26` `set-state-in-effect`:** a „nincs beállítva a szerver” ág ne
   effektben állítson állapotot, hanem a `useState` kezdőértékében dőljön el
   (`isConfigured` a renderelés előtt is ismert).
3. **`ScheduleScreen.jsx:253` `exhaustive-deps`:** lásd lent, külön alpont.
4. **`MapPicker.jsx:254` `exhaustive-deps`:** a `c0`/`item` szándékosan csak a
   megnyitáskori kezdőnézetet adja. Ezt `eslint-disable-next-line`-nal **és egy
   mondatos indoklással** némítsd — a néma kivétel rosszabb, mint a figyelmeztetés.
5. Ha mind elfogyott: a `no-unused-vars` menjen `warn`-ról `error`-ra az
   `eslint.config.js`-ben, hogy vissza se szivároghasson.

**A `ScheduleScreen` esete külön figyelmet érdemel.** A `weekMon` minden
rendereléskor új `new Date()`, ezért a `useMemo` függőségei közé betenni annyi, mint
kikapcsolni a memoizációt. A mai kihagyás pragmatikus, de latens hibát hordoz: a
képernyő ahhoz a héthez tapad, amelyikben a memo először lefutott, tehát egy vasárnap
éjfélen át nyitva hagyott munkamenet rossz hetet mutat. Javítás: a `weekMon` legyen
**stabil, összehasonlítható érték** (pl. `toISO(mondayOf(new Date()))` stringként a
függőségi tömbben), a `mondayOf` pedig ebből számoljon a memón belül.

**Ellenőrzés.** `npm run lint` → `0 problems`. A `npm test` maradjon 168/168.

---

### P0-4 · A munkaterület-kulcs egyetlen forrásra hozása

**Miért.** A `"fuvarterv:v1"` szó szerint három helyen szerepel: `src/data/storage.js`
(`STORAGE_KEY`), `src/supabaseClient.js` (`WORKSPACE_ID`) és az RLS-szabályok
törzsében. A kliensoldali kettősség fölösleges, és pont ez az, ami a 0005/0006
migrációpárt megdrágította: egy átnevezés ma **négy** fájlt érint.

**Mit.** A `WORKSPACE_ID` ne önálló literál legyen, hanem a `STORAGE_KEY`
újraexportálása (vagy fordítva — a lényeg, hogy egy literál maradjon a kliensben). Az
SQL-oldali duplikáció marad: azt a `supabase/migrations/README.md` már kezeli, és
migrációt utólag átírni tilos.

**Ellenőrzés.** `grep -rn '"fuvarterv:v1"' src` pontosan **egy** találatot adjon.
A `test/login.test.jsx`, `test/fetchrole.test.js` és `test/load-error.test.js`
mockjai maradhatnak — azok szándékosan rögzítik a szerződést.

---

## 3. P1 — valódi adósság

### P1-1 · Mintaadat anonimizálása (R5)

**Miért.** A `src/data/seed.js` **valódi sofőrneveket** (`Sipos Zsolti`,
`Habenyák Alex`, …) és **valódi rendszámokat** (`PAK-543`, …) tartalmaz, egy
verziókövetett repóban. A `README` figyelmeztet rá, de a figyelmeztetés nem intézkedés.

**Mit.** A mintaadat neve és rendszáma legyen kitalált (`Sofőr 1`, `AAA-001`), a
megállók, helyszínek és koordináták maradhatnak — azok közérdekű helyadatok. A
`note` mezőkből is ki kell venni a neveket (ma pl. „váltásban Csomor Tamással”).

**Fontos.** Ez a Git-előzményből nem tünteti el az adatot. Ha ez elvárás, az külön
döntés (history-átírás), és nem ennek a tételnek a része — de a döntést ki kell
mondani.

**Ellenőrzés.** `npm test` zöld (a tesztek nem támaszkodnak konkrét mintanevekre —
ezt a futtatás igazolja). A `test/smoke.test.jsx` mintaadatról indul, tehát az a
tényleges regressziós háló.

---

### P1-2 · Stíluskezelés egységesítése

**Miért.** Ma **három, párhuzamos** rendszer él egymás mellett:

| Rendszer | Hol | Mennyiség |
|---|---|---|
| Tailwind utility osztályok | mindenhol | ~510 `className` |
| Saját szemantikus CSS, `ft-*` / `.btn` / `.card` | `src/ui/styles.css` | 127 sor |
| Saját szemantikus CSS, `v-*` | `src/theme.css` | 140 sor |
| Beágyazott `style={{…}}` objektum | 16 fájl | **146 db** |

Egy gombszín megváltoztatása ma nem egy helyen történik, hanem attól függ, melyik
komponens melyik rendszert használta. Ez a kódbázis legdrágább karbantartási pontja.

**Mit.** Ne nagytakarítás legyen, hanem **kimondott tulajdonos + fokozatos behúzás**:

1. **Döntés (ADR!):** a `theme.css` (`v-*`) szolgálja a **belépés előtti héjat** —
   `AuthGate`, `LoginScreen`, `ErrorBoundary`, `RestorePanel`, `UsersPanel` —, a
   `styles.css` pedig a **belépés utáni alkalmazást**. Ez ma is majdnem így van; a
   szabályt csak ki kell mondani, és az `UsersPanel`-t egyértelműsíteni. Rögzítsd
   `DECISIONS.md`-ben.
2. **Tailwind szerepe:** kizárólag elrendezés (`flex`, `gap-*`, `mt-*`, `w-full`).
   Szín, méret, tipográfia és állapot **soha** — az CSS-osztály.
3. **A 146 inline stílus behúzása.** Kezdd a top 3 fájllal (`ScheduleScreen` 25,
   `RideScreen` 16, `TeamsScreen`/`DriverScreen` 15-15). Ami kétszer előfordul, az
   osztály lesz; ami tényleg egyedi és számított (pl. csapatszín), az maradhat inline
   — az inline stílus önmagában nem hiba, a **véletlenszerűsége** az.

**Ellenőrzés.** Nincs automatikus mérce; a mérőszám maga a darabszám:
`grep -ro 'style={{' src | wc -l` menjen 146-ról 50 alá. Minden PR után `npm test`
(a smoke teszt minden fület renderel) és **szemrevételezés** a preview deployon.

---

### P1-3 · A nagy képernyő-komponensek bontása

**Miért.** Öt komponens hordja a képernyő-réteg terhét:

| Komponens | Sor | Mit kever |
|---|---|---|
| `RideForm` (`RideScreen.jsx`) | 267 | piszkozat-állapot, validáció, megállószerkesztés, elrendezés |
| `ScheduleScreen` | 251 | 8 useState, mátrixhívás, optimalizálás, modálok, elrendezés |
| `MasterForm` (`MasterScreen.jsx`) | 161 | 5 entitástípus űrlapja egyetlen függvényben |
| `UsersPanel` | 153 | hálózati állapotgép + lista + űrlap |
| `StopListEditor` | 147 | — |

**Mit.** A cél nem a sorszám, hanem hogy **egy komponens egy dolgot csináljon**.
Konkrétan:

- `ScheduleScreen`: a modálok (`MoveModal`, beállítások, generálás-megerősítés) már
  külön komponensek — a maradék állapotot vidd egy `useScheduleActions` hookba
  (mátrix, optimalizálás, fuvargenerálás), hogy a komponens elrendezés maradjon.
- `MasterForm`: az entitásonkénti mezőkészlet legyen adatvezérelt (kind → mezőleírás),
  ne ág.
- `RideForm`: a megállólista-szerkesztés külön komponens, a `StopListEditor` mintájára.

**Ellenőrzés.** A `test/smoke.test.jsx` minden fület renderel, a
`test/training-stops-ui.test.jsx`, `test/master-coord.test.jsx`,
`test/ride-direction.test.jsx` és `test/vignette-ui.test.jsx` a konkrét viselkedést —
ez a háló a refaktorhoz. **Ha egy bontás közben tesztet kell átírni, az jelzés:
viselkedés változott, nem csak forma.**

---

### P1-4 · Import-határok gépi őrzése (R6)

**Miért.** A rétegzés ma **konvenció**, nem szabály. Egy `import` a `screens`-ből a
`supabaseClient`-be, vagy a `domain`-ből a `ui`-ba, semmilyen ellenőrzésen nem bukik
el — csak akkor derül ki, ha valaki észreveszi a review-ban.

**Mit.** `eslint-plugin-import` (vagy `eslint-plugin-boundaries`) zóna-szabállyal:

| Réteg | Mit importálhat |
|---|---|
| `src/domain/**` | csak `src/domain/**` (se `window`, se hálózat, se React) |
| `src/data/**` | `src/domain/**` |
| `src/ui/**` | `src/domain/**`, React |
| `src/screens/**` | `src/domain/**`, `src/data/**`, `src/ui/**` |
| `src/App.jsx` | bármelyik fenti |

**Ellenőrzés.** A szabály bevezetése után **szándékosan** írj be egy tiltott importot,
és a `npm run lint` bukjon el rá. Ez a lépés nélkül a szabály csak dísz.

---

## 4. P2 — strukturális, ha az idő engedi

### P2-1 · Stabil feladatazonosító (R1)

**Miért.** A feladat azonosítója ma `${trainingId}:${suffix}:${dir}${tag}`, és a `tag`
a **kapacitásbontás indexe**. Ha a megállók vagy a létszámok változnak, a `…:vissza`
azonosítóból `…:vissza#1` lehet — és a mentett lánc a benne tárolt sofőrrel, járművel
és zárolással együtt kiesik. A `resolveDay` ma ezt **számolja és megmondja**
(`droppedChains`), ami korrekt kármentés, de a beosztás így is elveszett.

**Mit.** Az azonosító identitása legyen felosztástól független (edzés + irány +
nap), a felosztás pedig külön mező (`part: 1/2`). A `resolveDay` a mentett láncot
akkor is fel tudja oldani, ha a feladat közben kettévált — a kettévált részeket vagy
ugyanahhoz a lánchoz köti, vagy explicit kérdést tesz fel a felhasználónak.

**Kockázat.** Ez **adatformátum-változás**: a mentett `assignments` `taskIds` mezője
ma a régi alakot tárolja. Kell hozzá `ensureShape`-beli felokosítás, és **nem lehet
visszafelé törni** — egy régi kliens ugyanazt a blobot olvassa. Ez a terv egyetlen
magas kockázatú tétele; csak akkor kezdj bele, ha a P1-3 kész, és van idő a
tesztekre.

**Ellenőrzés.** Új teszt: mentett lánc + a létszámok olyan módosítása, ami felosztást
vált ki → a lánc sofőrje, járműve és zárolása **maradjon meg**. A mai kódon a lánc
eltűnik, tehát a teszt előbb bukik.

---

### P2-2 · Bundle-bontás

**Miért.** Egyetlen 523,85 kB-os chunk (gzip 151 kB) tölt be minden oldalnyitásnál,
benne a Leaflet térképpel és a teljes Supabase klienssel, olyan felhasználóknak is,
akik sofőrként **csak a napi tervüket** nézik meg telefonon.

**Mit.** A `MapPicker` már lustán tölti a Leafletet (ADR-21) — ezt a mintát terjeszd
ki: a `screens/` route-szintű `React.lazy`, és `manualChunks` a `@supabase/supabase-js`
és a `lucide-react` számára.

**Ellenőrzés.** `npm run build` ne írjon ki chunk-méret figyelmeztetést, és a belépési
chunk menjen 250 kB alá. Sofőr-szerepkörrel a térképkód ne töltődjön be (Network fül).

---

### P2-3 · Hibabejelentés éles környezetből

**Miért.** A teljes forrásban **négy** `console` hívás van, hibabejelentő szolgáltatás
nincs. Egy éles hiba csak akkor derül ki, ha valaki telefonál. A P0-1 (source map)
ennek az előfeltétele — enélkül a bejelentett verem is olvashatatlan.

**Mit.** A legkisebb hasznos lépés nem egy külső szolgáltatás, hanem hogy a hiba
**bent maradjon a rendszerben**: az `ErrorBoundary` és a `persistState` hibaága írjon
egy sort egy `app_errors` táblába (időbélyeg, e-mail, üzenet, verem, app-verzió), a
`user_roles` mintájára RLS-szel (insert bárkinek, select csak adminnak). Így az admin
a felületről látja, mi történt a sofőröknél.

**Alternatíva.** Sentry vagy hasonló — több képesség, de új külső függőség, új CSP-ág
(`connect-src`) és adatvédelmi kérdés. Döntés kérdése; rögzítsd ADR-ként.

**Ellenőrzés.** Szándékos hiba a preview deployon → megjelenik a táblában, és a
sofőr-szerepkörű felhasználó **ne** lássa a listát.

---

### P2-4 · Tesztek a modulokra, ne a barrelre (R8)

**Miért.** 19 tesztfájlból **13** a gyökérben lévő `fuvarterv.jsx` barrelből importál.
Ez volt a modulbontás célja (egyetlen import se törjön el), de mellékhatása, hogy a
tesztek a **re-export felületre** vannak rögzítve: egy új domain-függvény addig nem
tesztelhető, amíg a barrelbe be nem kerül, és a barrel elfelejtése csendes hiba.

**Mit.** Az új tesztek a **valódi modulból** importáljanak
(`../src/domain/optimizer.js`), és maradjon **egy** dedikált szerződéstesztje a
barrelnek, ami azt ellenőrzi, hogy minden publikus domain-függvény exportálva van.
A meglévő teszteket nem kell mind átírni — az érték a szabályban van, nem a
migrációban.

**Ellenőrzés.** A szerződésteszt bukjon el, ha egy `export function`-t kiveszel a
barrelből.

---

## 5. Amit tudatosan NEM csinálunk most

| Ötlet | Miért nem |
|---|---|
| **Több párhuzamos szerkesztő (CRDT/merge)** | R2 tudatos kompromisszum. Az egyszerkesztős modell dokumentált, látható, és a klub valós használatát fedi. Nagy lépés, valós igény nélkül. |
| **TypeScript-migráció** | A domain már ma is erősen tesztelt, és a `ensureShape` a futásidejű alakvédelem. A migráció ára (teljes fa + a barrel + a tesztek) ma nagyobb, mint a haszon. Ha mégis: `checkJS` + JSDoc a `src/domain/`-on, fokozatosan. |
| **Saját backend** | ADR-10. A Supabase + Vercel pont azt adja, amire szükség van, üzemeltetés nélkül. |
| **Optimalizálás Web Workerbe** | R10. Előbb **mérni** kell: ma a legrosszabb mért eset másfél másodperc. Optimalizálás mérés nélkül találgatás. |
| **Prettier bevezetése** | A kódstílus ma is egységes, kézzel. Egy formázó-PR az egész fa `git blame`-jét elmossa — ez a kódbázisban, ahol a kommentek hordozzák a tudást, valódi veszteség. |

---

## 6. Hogyan tartsuk karban ezt a dokumentumot

- Egy tétel akkor kerül ki innen, ha **kész és ellenőrizve** van — nem akkor, ha
  elkezdtük.
- Ha egy tétel egy `R…` kockázatot zár le, az `ARCHITECTURE.md` 16. fejezetéből is
  vegyük ki, ugyanabban a PR-ben.
- Ha egy tétel **döntést** igényel (P1-2 tulajdonos-szabály, P2-3 saját tábla vs.
  Sentry), a döntés a `DECISIONS.md`-be megy ADR-ként, és ez a fájl csak hivatkozik rá.
- Ha egy tételről kiderül, hogy nem éri meg, ne töröljük: kerüljön az
  [5. fejezetbe](#5-amit-tudatosan-nem-csinálunk-most) az indokkal. Az elvetett út
  tudása is tudás.
