import s from "./Nav.module.css";
import ui from "./ui.module.css";
import type { TopicCount } from "../../lib/insights";

/**
 * Horizontal topic rail. Only topics that actually have recent coverage are
 * rendered (24% of items carry a topic today, so a static list would be mostly
 * dead links). Selection lives in the URL (?topic=).
 */
export default function TopicRail({
  topics,
  active,
  tab,
}: {
  topics: TopicCount[];
  active?: string;
  tab?: string;
}) {
  if (topics.length === 0) return null;
  const link = (topic?: string) => {
    const p = new URLSearchParams();
    if (tab && tab !== "top") p.set("tab", tab);
    if (topic) p.set("topic", topic);
    const qs = p.toString();
    return qs ? `/?${qs}` : "/";
  };
  return (
    <nav aria-label="topics" className={s.rail}>
      <span className={s.railLabel}>Topics</span>
      <a href={link()} className={!active ? ui.chipActive : ui.chip} aria-current={!active ? "true" : undefined}>
        All
      </a>
      {topics.map((t) => (
        <a
          key={t.topic}
          href={link(t.topic)}
          className={active === t.topic ? ui.chipActive : ui.chip}
          aria-current={active === t.topic ? "true" : undefined}
        >
          {t.topic}
          <span className={s.railCount}>{t.count}</span>
        </a>
      ))}
    </nav>
  );
}
