# Fuvarterv — karbantartási kézikönyv

Ez a gyakorlati dokumentum: mit futtass, mit ellenőrizz, és mire figyelj, amikor
hozzányúlsz a kódhoz. A „miért így van” a [`ARCHITECTURE.md`](ARCHITECTURE.md) és a
[`DECISIONS.md`](DECISIONS.md) dolga.

---

## 1. Fejlesztői környezet

Node **20+** kell (`engines` a `package.json`-ban; a Vercel is ezt olvassa).

```bash
cp .env.example .env      # VITE_SUPABASE_URL és VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:5173
```

Vagy egy lépésben, Node telepítésével együtt: `./run-local.sh`.

| Parancs | Mit csinál |
|---|---|
| `npm run dev` | Vite fejlesztői szerver |
| `npm test` | Vitest, egyszeri futás (19 fájl, 168 teszt) |
| `npm run lint` | ESLint (flat config) |
| `npm run build` | production build a `dist/`-be |
| `npm run preview` | a buildelt bundle kiszolgálása |

A CI (`.github/workflows/ci.yml`) minden ághoz és PR-hez lefuttatja a
`npm ci → lint → test → build` sort **Node 20-on és 22-n**. Az `npm ci` szigorúan a
lockfile-ból telepít — ez az a lépés, ami megakadályozza, hogy törött lockfile jusson
el egy deployig.

> **Supabase nélkül is fejleszthetsz** korlátozottan: a tesztek hamis `window.storage`
> tárolót adnak, és az app konfiguráció nélkül a „Hiányzik a beállítás” képernyőt
> mutatja. Valódi kattintgatáshoz kell egy Supabase-projekt (README, „Supabase setup”).

---

## 2. Kódkonvenciók

**Fájlfej.** Minden modul egy rövid fejléccel kezdődik: mi ez a fájl, és mi a szerepe
a rendszerben. Új modulnál tartsd a formát.

**A komment a *miért*.** Ebben a kódbázisban a hosszú kommentek nem magyarázkodás,
hanem **a kizárt hibás viselkedés leírása**:

```js
// Mindkét koordináta kell. Csak a lat-ot ellenőrizve a haversine NaN-t ad, és a
// Math.max(1, NaN) is NaN — az végigfut a menetrenden, minden összehasonlítást
// hamissá tesz (nem épül él, nem látszik ütközés), és "NaN:NaN" időket ír ki.
```

Ha egy hibát javítasz, a javítás mellé kerüljön egy ilyen komment **és** egy teszt.
Az, hogy „mit csinál a kód”, olvasható a kódból; az, hogy „mi történt, amikor nem így
volt”, csak innen.

**Nyelv.** Felület és kommentek magyarul, azonosítók angolosan; a domain-szavak
(`oda`, `vissza`, `telephely`) magyarok maradnak (ADR-26).

**Stílus.** Kettő szóköz behúzás, pontosvesszők, dupla idézőjel, sorvégi vessző a
többsoros literálokban — kövesd a környező kódot. Nincs Prettier-konfiguráció, a lint
csak a valódi hibákat fogja (`no-undef`, `react-hooks/*`).

**React.**
- Komponenst **modulszinten** definiálj; renderfüggvényen belül definiált komponens
  minden rendereléskor új típus, és elveszti az állapotát.
- Szerkesztő űrlap piszkozatát `key` propal újramountolva frissítsd, ne kézi
  szinkronizálással.
- Az `update(fn)` mindig **tiszta** transzformáció, nem helyben módosítás.

**Domain.** A `src/domain/` maradjon tiszta: nincs `window`, nincs hálózat, nincs
`Math.random()` a döntési utakon (az optimalizálás determinizmusa ezen áll).

---

## 3. Mikor kész egy változtatás

Ellenőrzőlista, mielőtt commitolsz:

- [ ] `npm run lint` és `npm test` zöld.
- [ ] Új mező esetén az **`ensureShape`** ad neki alapértéket, ami a **korábbi
      viselkedést** reprodukálja (E8 / ADR-06).
- [ ] Ha az adat hivatkozható lett: a **`deleteGuard`** számol vele (I10).
- [ ] Ha új korlát került az optimalizálóba: van hozzá **indoklás** (ADR-25), és ha
      költségtag, akkor a **`skelCost`-ban is** szerepel (ADR-16 aranyszabály).
- [ ] Ha hibát javítottál: van **regressziós teszt**, amely leírja a kizárt rossz
      viselkedést.
- [ ] Ha új publikus (teszt által használt) függvény keletkezett: rajta van a
      **barrel** export-listáján (`fuvarterv.jsx`).
- [ ] Ha új külső hívás van: **CSP** kiegészítve a `vercel.json`-ban, és van
      visszaesési út (E5).
- [ ] Ha a mentés/betöltés útját érinted: a `test/load-error.test.js` szellemében
      **nem születhet mintaadat valós adat fölé** (I11).

---

## 4. Kód-átvizsgálási szempontok (review)

A leggyakoribb, legdrágább hibafajták ebben a rendszerben — érdemes külön rákérdezni:

| Kérdés | Miért |
|---|---|
| Az új mező befolyásolja a menetidőt vagy a költséget? | akkor az optimalizálás minden fázisában konzisztensen kell megjelennie |
| Új korlát: kemény vagy puha? | kemény korlát az opciólistából zár ki; puha csak drágít — a kettő keverése rossz javaslatot ad |
| A létszámkezelés megkülönbözteti a `""`-t és a `0`-t? | I4 / ADR-24 — ez a „gyerek marad a megállóban” hibaosztály |
| A visszaút tükrözés vagy saját lista? | `legFor` az **egyetlen** hely, ahol ez eldől; máshol ne döntsd el újra |
| A módosítás után is pontosan egy láncba kerül minden feladat? | I5 — az `optimizer.test.js` property-tesztje ezt ellenőrzi |
| Az írási út továbbra is csak adminnak fut? | ADR-12 — az UI-őr nem védelem, de a felesleges hibaüzenetet ő kerüli el |
| Új komponens a renderfüggvényen belül van? | állapotvesztés, felesleges újramount |

---

## 5. Adatbázis-migrációk

1. Új fájl: `supabase/migrations/000N_rövid_név.sql`, sorszám szerint.
2. **Újrafuttathatóra** írd: `create table if not exists`, és minden `create policy`
   előtt `drop policy if exists` (a `create policy` nem ismer `if not exists`-et, és
   a SQL editor nem egyetlen tranzakcióban fut, tehát félúton is megállhat).
3. Vedd fel a `supabase/migrations/README.md` táblázatába **és** a főoldali README
   telepítési lépéssorába.
4. Ha a szabály a munkaterület kulcsára hivatkozik, ügyelj rá, hogy a kulcs az legyen,
   amit a kliens ténylegesen küld (`fuvarterv:v1`, lásd `src/supabaseClient.js`).
   A `0005`/`0006` páros pontosan ebből a névváltásból származik.
5. Éles adatbázison a migrációk a Supabase **SQL editorban** futnak, sorrendben. A
   migrációs README tartalmaz egy csak-olvasó lekérdezést, amely megmondja, mi van
   még hátra.

**Két beállítás, ami nincs a repóban, de a biztonsági modell része** (ADR-12):

- Authentication → Providers → Email → **Enable sign-ups: OFF**.
- Az első admin sora a `user_roles` táblában (a `0004` fejléce tartalmazza a
  parancsot; ez egyben a kizárás elleni helyreállítási út is).

---

## 6. Kiadás (Vercel)

1. Ellenőrizd, hogy az adatbázison **mind a hat** migráció lefutott, és a publikus
   regisztráció ki van kapcsolva.
2. `VITE_SUPABASE_URL` és `VITE_SUPABASE_ANON_KEY` a Vercel környezeti változói közt,
   **Production és Preview** jelöléssel. A Vite ezeket **build időben** építi be: ha
   utólag adod hozzá, újra kell deployolni.
3. Preview deploy → kézi ellenőrzés (lásd lent) → merge a `main`-be.

**Kézi ellenőrzési pontok**, amiket az automata tesztek nem fednek:

- Belépés valós fiókkal; sofőr-fiókkal is (csak a Sofőr fül látszik).
- Térképválasztó megnyitása a preview deployon, **böngészőkonzol figyelése**: itt
  derül ki, ha a Leaflet stílusa CSP-be ütközik (R7 az architektúra-dokumentumban).
- „Mátrix számítása” — a felirat mondja meg, OSRM-ből vagy becslésből jött-e.
- Egy mentés, majd a „Korábbi mentések” panel: ha üres marad, a `0002` migráció
  hiányzik.

---

## 7. Hibaelhárítás

| Tünet | Valószínű ok | Hol nézd |
|---|---|---|
| „Hiányzik a beállítás” képernyő | nincs `.env` / a Vercel változói a build után jöttek | `src/supabaseClient.js` |
| „Az adatok máshol módosultak” overlay | valaki más mentett, vagy egy elveszett válasz utáni valódi ütközés | `supabaseStorage.doSet` (ADR-07, ADR-08) |
| Minden mentés elutasítva, üres munkaterület | a `0006` migráció nem futott le (kulcs-eltérés) | `supabase/migrations/README.md` |
| A „Korábbi mentések” mindig üres | a `0002` migráció nem futott le | `RestorePanel` hibaágazata |
| Mindenki adminnak látszik | a `user_roles` tábla hiányzik (`0004` nem futott) | `fetchRole` kivételága (ADR-11) |
| A beosztás láncai eltűntek | megváltoztak a megállók/létszámok → elavult feladatazonosítók | `resolveDay` `droppedChains` (R1) |
| „Mátrix elavult” jelzés | koordináta változott a mátrix számítása óta | `matrixKey` |
| Furcsa, túl rövid menetidők | koordináta nélküli pont → `fallbackLegMin` | `legMin`, `MasterForm` koordináta-kényszer |
| Az optimalizálás „heurisztikus” megjegyzést ír | a keresés elérte a 30 000 iterációs korlátot | `assignResources` (`capped`) |
| Fehér képernyő helyett hibakártya | `ErrorBoundary` elkapta a renderelési hibát; a konzolon a teljes verem | `src/ErrorBoundary.jsx` |

---

## 8. Adatvédelem

A `seedState()` mintaadat **valós sofőrneveket és rendszámokat** tartalmaz. Nyilvános
repó előtt anonimizálni kell (a főoldali README figyelmeztetése). A munkaterület
tartalmaz sofőr-e-mail-címeket is (a Sofőr nézet ezekkel köti a fiókot a sofőrhöz) —
exportot, képernyőképet, hibariportot ennek tudatában ossz meg.

---

## 9. Függőségek

Kis, szándékosan szűk függőségi lista: `react`, `react-dom`, `@supabase/supabase-js`,
`lucide-react` (ikonok). Build: Vite + Tailwind v4 plugin. Teszt: Vitest + jsdom.
A Leaflet **nincs** a `package.json`-ban: futásidőben, CDN-ről töltődik (ADR-21).

Frissítésnél `npm ci` után futtasd a teljes `lint + test + build` sort, és nézd meg a
smoke-tesztet — az fogja meg, ha egy React- vagy Vite-frissítés a renderelési úton tör
el valamit.
