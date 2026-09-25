import { create } from "zustand";

export type Theme = "dark" | "light";
function initialTheme(): Theme {
  try {
    return localStorage.getItem("transit-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}
export const useTheme = create<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>((set) => ({
  theme: initialTheme(),
  setTheme: (theme) => {
    set({ theme });
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("transit-theme", theme);
    } catch {
      /* Private browsing may disable storage. */
    }
  },
}));
document.documentElement.dataset.theme = useTheme.getState().theme;

// Keep already open dashboards in sync when the preference changes in another tab.
const syncTheme = (event: StorageEvent) => {
  if (event.key !== "transit-theme" && event.key !== null) return;
  const theme: Theme = event.newValue === "dark" ? "dark" : "light";
  useTheme.setState({ theme });
  document.documentElement.dataset.theme = theme;
};
window.addEventListener("storage", syncTheme);
if (import.meta.hot)
  import.meta.hot.dispose(() =>
    window.removeEventListener("storage", syncTheme),
  );
