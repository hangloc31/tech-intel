import { TABS, type Tab } from "../../lib/stories";
import s from "./Nav.module.css";

function href(tab: Tab, rest: { topic?: string; source?: string; entity?: string; q?: string }): string {
  const p = new URLSearchParams({ tab });
  if (rest.topic) p.set("topic", rest.topic);
  if (rest.source) p.set("source", rest.source);
  if (rest.entity) p.set("entity", rest.entity);
  if (rest.q) p.set("q", rest.q);
  return `/?${p.toString()}`;
}

const LABELS: Record<Tab, string> = { top: "Top", latest: "Latest", trending: "Trending" };

// Same default as lib/stories.ts. Read here (not imported) to keep this
// presentational component free of the DB layer.
const TRENDING_WINDOW_HOURS = Number(process.env.TRENDING_WINDOW_HOURS ?? 48);

/** Segmented tab control. Active state comes from the URL (?tab=). */
export default function Tabs({ active, topic, source, entity, q }: { active: Tab; topic?: string; source?: string; entity?: string; q?: string }) {
  return (
    <nav aria-label="feed tabs" className={s.tabs}>
      {TABS.map((t) => (
        <a
          key={t}
          href={href(t, { topic, source, entity, q })}
          aria-current={t === active ? "page" : undefined}
          className={t === active ? s.tabActive : s.tab}
          title={t === "trending" ? `Stories gaining traction in the last ${TRENDING_WINDOW_HOURS} hours` : undefined}
        >
          {LABELS[t]}
          {t === "trending" && <span className={s.tabSuffix}>{TRENDING_WINDOW_HOURS}h</span>}
        </a>
      ))}
    </nav>
  );
}
