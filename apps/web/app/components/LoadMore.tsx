"use client";

import { useState } from "react";
import StoryCard from "./StoryCard";
import s from "./Shell.module.css";
import type { StoryCard as StoryCardType } from "../../lib/stories";

interface Page {
  stories: StoryCardType[];
  next_cursor: string | null;
}

/**
 * Progressive "more" pagination. Fetches the next cursor page from the JSON API
 * and appends the rows in place, so the reader keeps their scroll position.
 * The URL is updated to the latest cursor (same shape as the old full-page link),
 * so filter state stays in the URL and a refresh lands on a valid page.
 * Without JS the inner <a> still navigates to the next page the old way.
 */
export default function LoadMore({
  apiBase,
  pageBase,
  initialCursor,
  startRank,
}: {
  /** e.g. "/api/stories?tab=top&limit=20" — cursor is appended per fetch. */
  apiBase: string;
  /** e.g. "/?tab=top" — cursor is appended for the fallback link / history. */
  pageBase: string;
  initialCursor: string;
  /** Rank number for the first appended row (hero + page-1 rows precede it). */
  startRank: number;
}) {
  const [items, setItems] = useState<StoryCardType[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!cursor && items.length === 0) return null;

  const pageUrl = (c: string) => `${pageBase}${pageBase.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(c)}`;

  const more = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (loading || !cursor) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`${apiBase}${apiBase.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) throw new Error(`http ${res.status}`);
      const data = (await res.json()) as Page;
      setItems((prev) => [...prev, ...data.stories]);
      setCursor(data.next_cursor);
      // Keep the URL canonical: a refresh renders this tail as a normal page.
      window.history.replaceState(null, "", pageUrl(cursor));
      if (!data.next_cursor) window.history.replaceState(null, "", pageBase);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {items.map((story, i) => (
        <li key={story.id}>
          <StoryCard story={story} rank={startRank + i} />
        </li>
      ))}
      {cursor && (
        <li style={{ listStyle: "none" }}>
          <a href={pageUrl(cursor)} onClick={more} className={s.more} aria-disabled={loading}>
            {loading ? "Loading…" : failed ? "Retry — load failed" : "More stories →"}
          </a>
        </li>
      )}
    </>
  );
}
