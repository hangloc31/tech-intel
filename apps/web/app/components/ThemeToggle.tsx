"use client";

import { useEffect, useState } from "react";
import s from "./Header.module.css";

type Theme = "light" | "dark" | "system";
const KEY = "ti-theme";

/**
 * Light/dark toggle. The only piece of client state in the shell besides keyboard
 * nav — filter state deliberately stays in the URL (AGENTS.md).
 * Applied as `data-theme` on <html>; "system" removes the attribute so CSS
 * `color-scheme` follows prefers-color-scheme.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Theme | null) ?? "system";
    setTheme(saved);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
  }, [theme, ready]);

  const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const label = theme === "system" ? "System" : theme === "light" ? "Light" : "Dark";

  return (
    <button
      type="button"
      className={s.theme}
      onClick={() => setTheme(next)}
      title={`Theme: ${label} — click for ${next}`}
      aria-label={`Theme: ${label}. Switch to ${next}.`}
    >
      {theme === "light" ? "☀" : theme === "dark" ? "☾" : "◐"}
    </button>
  );
}
