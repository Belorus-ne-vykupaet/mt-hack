import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function visible() {
  return !document.hidden;
}

/** Hidden tabs should not keep a WebGL map alive. */
export function useDocumentVisible() {
  return useSyncExternalStore(subscribe, visible, () => true);
}
