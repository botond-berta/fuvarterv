/* Fuvarterv — országos autópálya-matrica jelvénye.
   Két állapotot jelöl ugyanazzal a szóval, mert ugyanarról a tényről szól:
   a járműnél "van matricája", a helyszínnél "matrica kell hozzá". */

export function VignettePill({ need }) {
  return (
    <span className="pill" title={need ? "Csak országos matricás autóval érhető el" : "Van országos autópálya-matricája"}
      style={{ background: "var(--acc-soft)", color: "var(--acc-strong)" }}>
      {need ? "matrica kell" : "matricás"}
    </span>
  );
}
