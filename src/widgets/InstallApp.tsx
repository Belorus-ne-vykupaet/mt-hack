import { useState } from "react";
import { MonitorDown } from "lucide-react";
import { installApp, useInstallState } from "../app/install";

/** Header button that installs the dashboard as a standalone app (PC or phone). */
export function InstallApp() {
  const state = useInstallState();
  const [hint, setHint] = useState(false);
  if (state === "installed" || state === "none") return null;
  return (
    <div className="install-app">
      <button
        className="header-action"
        title="Установить Transit Hub как приложение"
        aria-expanded={state === "ios" ? hint : undefined}
        onClick={() => (state === "ios" ? setHint(!hint) : void installApp())}
      >
        <MonitorDown size={18} />
        <span>Установить</span>
      </button>
      {state === "ios" && hint && (
        <p className="install-hint" role="status">
          В Safari нажмите «Поделиться», затем «На экран „Домой“».
        </p>
      )}
    </div>
  );
}
