// React needs this flag to run effects and state updates inside act() without
// warning; without it every act() call in the smoke test logs a false alarm.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
