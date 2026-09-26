/** Relative time ("2h ago") for feed scanning. Pure, server-safe. */
export function timeAgo(iso: string, nowMs = Date.now()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const s = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export const TOPIC_COLORS: Record<string, string> = {
  AI: "#60a5fa",
  Developer: "#34d399",
  Security: "#f87171",
  Hardware: "#fbbf24",
  "Open Source": "#c084fc",
  Research: "#22d3ee",
  Startups: "#fb923c",
  Web: "#a3e635",
  Mobile: "#f472b6",
};

export function topicColor(topic: string): string {
  return TOPIC_COLORS[topic] ?? "#737373";
}

/**
 * Favicon for a source's domain (identity icon, not article art).
 * Takes the article URL rather than a source id: ids are slugs like
 * "hackernews", which no favicon service can resolve.
 */
export function faviconUrl(articleUrl: string): string | null {
  if (!articleUrl) return null;
  try {
    const host = new URL(articleUrl).hostname;
    if (!host) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
  } catch {
    return null;
  }
}
