import { Component } from "react";
import "./ui/styles.css";

/*
 * The app had no error boundary: a single throw on any screen produced a white page
 * the user could not even navigate away from to fix the data that caused it. This
 * boundary keeps the shell alive and offers the two useful ways out — reload, or
 * open the earlier snapshots.
 *
 * Deliberately a class component: in React that is still the only way to write an
 * error boundary.
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
    // The full picture goes to the console; the text shown to the user stays short.
    console.error("Váratlan hiba a felületen:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="shell-screen">
        <div className="shell-card shell-pad shell-info-card">
          <div className="shell-title">Váratlan hiba történt</div>
          <p className="shell-muted" style={{ margin: 0 }}>
            A felület egy része nem tudott megjelenni. Az adataid a szerveren
            érintetlenek — a legutóbbi, még el nem mentett módosításod veszhetett el.
          </p>
          <p className="shell-muted" style={{ margin: 0, fontSize: 13 }}>
            <code>{String(this.state.error?.message || this.state.error)}</code>
          </p>
          <button className="shell-btn shell-btn-primary shell-btn-block" onClick={() => window.location.reload()}>
            Újratöltés
          </button>
          <button
            className="shell-btn shell-btn-ghost shell-btn-block"
            onClick={() => window.dispatchEvent(new CustomEvent("fuvarterv:restore"))}
          >
            Korábbi mentések megnyitása
          </button>
        </div>
      </div>
    );
  }
}
