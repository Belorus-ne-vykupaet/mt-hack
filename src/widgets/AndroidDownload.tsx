import { Smartphone } from "lucide-react";

// Inside the Android app itself a link to its own installer is pointless.
const native = () =>
  (
    globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor?.isNativePlatform?.() === true;

/** Header link to the Android build of the dashboard; the site serves the APK itself. */
export function AndroidDownload() {
  if (native()) return null;
  return (
    <a
      className="header-action android-download"
      href="/downloads/transit-hub.apk"
      download="transit-hub.apk"
      title="Скачать приложение для Android (APK)"
    >
      <Smartphone size={18} />
      <span>Скачать APK</span>
    </a>
  );
}
