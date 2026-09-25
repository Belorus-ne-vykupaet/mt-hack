import { create } from "zustand";
interface Preferences {
  enabled: boolean;
  clouds: boolean;
  rain: boolean;
  animate: boolean;
  intensity: number;
}
const defaults: Preferences = {
  enabled: true,
  clouds: true,
  rain: true,
  animate: true,
  intensity: 0.7,
};
function read(): Preferences {
  try {
    const value = JSON.parse(
      localStorage.getItem("transit-weather-v1") || "{}",
    );
    return {
      ...defaults,
      ...Object.fromEntries(
        (["enabled", "clouds", "rain", "animate"] as const)
          .filter((k) => typeof value?.[k] === "boolean")
          .map((k) => [k, value[k]]),
      ),
      intensity:
        typeof value?.intensity === "number" && Number.isFinite(value.intensity)
          ? Math.max(0.25, Math.min(1, value.intensity))
          : defaults.intensity,
    };
  } catch {
    return defaults;
  }
}
export const useWeatherPreferences = create<
  Preferences & { set: (patch: Partial<Preferences>) => void }
>((set, get) => ({
  ...read(),
  set: (patch) => {
    set(patch);
    try {
      localStorage.setItem("transit-weather-v1", JSON.stringify(get()));
    } catch {
      /* Storage is optional. */
    }
  },
}));
