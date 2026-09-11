/* Fuvarterv — the national motorway vignette badge.

   One word covers two states because they are the same fact seen from either end: on
   a vehicle it reads "has one", on a venue "needs one". */

export function VignettePill({ need }) {
  return (
    <span className="pill" title={need ? "Csak országos matricás autóval érhető el" : "Van országos autópálya-matricája"}
      style={{ background: "var(--acc-soft)", color: "var(--acc-strong)" }}>
      {need ? "matrica kell" : "matricás"}
    </span>
  );
}
