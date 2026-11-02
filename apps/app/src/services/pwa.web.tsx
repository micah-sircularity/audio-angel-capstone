import { useEffect } from "react";
export function PwaRegistration() {
  useEffect(() => {
    if (!__DEV__ && "serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js")
        .catch((error) =>
          console.warn("App shell caching unavailable", String(error)),
        );
    }
  }, []);
  return null;
}
