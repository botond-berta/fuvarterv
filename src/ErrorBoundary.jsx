import { Component } from "react";
import "./theme.css";

/*
 * Az alkalmazásnak nem volt hibahatára: egyetlen dobás bármelyik képernyőn fehér
 * oldalt eredményezett, ahonnan a felhasználó még elnavigálni sem tudott, hogy a
 * hibát okozó adatot kijavítsa. Ez a határ megtartja a shellt (fejléc, mentések,
 * kijelentkezés), és felkínálja a két értelmes kiutat: újratöltés vagy a korábbi
 * mentések megnyitása.
 *
 * Szándékosan osztálykomponens — React-ben csak így lehet hibahatárt írni.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Konzolra a teljes kép: a felhasználónak szánt szöveg szándékosan rövid.
    console.error("Váratlan hiba a felületen:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="v-screen">
        <div className="v-card v-pad v-info-card">
          <div className="v-title">Váratlan hiba történt</div>
          <p className="v-muted" style={{ margin: 0 }}>
            A felület egy része nem tudott megjelenni. Az adataid a szerveren
            érintetlenek — a legutóbbi, még el nem mentett módosításod veszhetett el.
          </p>
          <p className="v-muted" style={{ margin: 0, fontSize: 13 }}>
            <code>{String(this.state.error?.message || this.state.error)}</code>
          </p>
          <button className="v-btn v-btn-primary v-btn-block" onClick={() => window.location.reload()}>
            Újratöltés
          </button>
          <button
            className="v-btn v-btn-ghost v-btn-block"
            onClick={() => window.dispatchEvent(new CustomEvent("vector:restore"))}
          >
            Korábbi mentések megnyitása
          </button>
        </div>
      </div>
    );
  }
}
