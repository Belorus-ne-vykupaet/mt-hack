import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_DISPATCH_SETTINGS,
  normalizeSettings,
} from "../entities/dispatch-settings";
import type { DispatchSettings } from "../entities/dispatch-settings";
interface DispatchSettingsState {
  settings: DispatchSettings;
  update: (patch: Partial<DispatchSettings>) => void;
  reset: () => void;
}
export const useDispatchSettings = create<DispatchSettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_DISPATCH_SETTINGS,
      update: (patch) =>
        set((state) => ({
          settings: normalizeSettings({ ...state.settings, ...patch }),
        })),
      reset: () => set({ settings: DEFAULT_DISPATCH_SETTINGS }),
    }),
    {
      name: "transit-dispatch-settings-v1",
      version: 1,
      merge: (persisted, current) => ({
        ...current,
        settings: normalizeSettings(
          (persisted as Partial<DispatchSettingsState> | undefined)?.settings,
        ),
      }),
    },
  ),
);
