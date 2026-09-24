"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const current = () => document.documentElement.dataset.theme ?? "light";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => "light");
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="btn btn-sm w-full"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("theme", next);
        } catch {}
      }}
      aria-label={`Switch to ${next} mode`}
    >
      {theme === "dark" ? "☀ Light mode" : "☾ Dark mode"}
    </button>
  );
}
