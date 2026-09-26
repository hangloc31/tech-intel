"use client";

import { useEffect } from "react";

/** Keyboard shortcuts: `/` focuses search, `j`/`k` move between stories. */
export default function KeyboardNav() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("input[name=q]")?.focus();
      } else if (e.key === "j" || e.key === "k") {
        const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-story]")];
        if (links.length === 0) return;
        e.preventDefault();
        const idx = links.indexOf(document.activeElement as HTMLAnchorElement);
        const next = e.key === "j" ? Math.min(links.length - 1, idx + 1) : Math.max(0, idx === -1 ? 0 : idx - 1);
        links[next].focus();
        links[next].scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
