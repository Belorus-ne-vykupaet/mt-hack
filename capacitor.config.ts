import type { CapacitorConfig } from "@capacitor/cli";

// Android app: the same interface with the bundled demo stream (MSW) inside the WebView.
const config: CapacitorConfig = {
  appId: "ru.transithub.dispatcher",
  appName: "Transit Hub",
  webDir: "dist",
  backgroundColor: "#173037",
  plugins: {
    // Light status-bar icons over the dark header colour.
    SystemBars: { style: "DARK" },
  },
};

export default config;
