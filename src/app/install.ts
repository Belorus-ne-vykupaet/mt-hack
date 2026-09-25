import { useSyncExternalStore } from "react";
import { config } from "../shared/config/env";

/** Chrome/Edge install prompt, captured at startup: it fires once, before the header mounts. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export type InstallState = "installed" | "available" | "ios" | "none";

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const standalone = () =>
  globalThis.matchMedia?.("(display-mode: standalone)").matches ||
  (globalThis.navigator as { standalone?: boolean } | undefined)?.standalone === true;
// Safari on iPhone/iPad has no install prompt: the app is added from the share menu.
const ios = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function state(): InstallState {
  if (installed || standalone()) return "installed";
  if (deferred) return "available";
  return ios() ? "ios" : "none";
}

export function startInstallSupport() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
  // MSW owns the service worker in the demo; the offline shell is for the real service only.
  if (import.meta.env.PROD && config.dataSource === "api" && "serviceWorker" in navigator)
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    });
}

export async function installApp() {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "accepted") installed = true;
  notify();
  return outcome === "accepted";
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useInstallState = () => useSyncExternalStore(subscribe, state, () => "none");
