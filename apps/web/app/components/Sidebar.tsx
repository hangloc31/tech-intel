import s from "./Sidebar.module.css";
import type { Insights } from "../../lib/insights";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className={s.statValue}>{value.toLocaleString("en-GB")}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}

/**
 * Right rail. Shows live corpus numbers instead of decoration, so the page
 * reads as a system rather than a link dump. Renders nothing when the
 * aggregate queries fail — the feed must never depend on it.
 */
export default function Sidebar({ data }: { data: Insights | null }) {
  if (!data) return null;
  const quiet = data.storiesToday === 0 && data.itemsToday === 0;
  return (
    <aside className={s.rail} aria-label="corpus overview">
      <section className={s.card}>
        <h2 className={s.title}>Last 24 hours</h2>
        <div className={s.stats}>
          <Stat value={data.storiesToday} label="stories" />
          <Stat value={data.itemsToday} label="items" />
          <Stat value={data.sourcesToday} label="sources" />
          <Stat value={data.topics.length} label="topics" />
        </div>
      </section>

      {data.topics.length > 0 && (
        <section className={s.card}>
          <h2 className={s.title}>Most covered topics</h2>
          <ul className={s.list}>
            {data.topics.map((t) => (
              <li key={t.topic} className={s.item}>
                <a href={`/?topic=${encodeURIComponent(t.topic)}`} className={s.itemLabel}>
                  {t.topic}
                </a>
                <span className={s.itemValue}>{t.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.sources.length > 0 && (
        <section className={s.card}>
          <h2 className={s.title}>Top sources · 7d</h2>
          <ul className={s.list}>
            {data.sources.map((src) => (
              <li key={src.id} className={s.item}>
                <a href={`/?source=${encodeURIComponent(src.id)}`} className={s.itemLabel}>
                  {src.id}
                </a>
                <span className={s.trust} title={`source trust ${src.trust.toFixed(2)}`}>
                  <span className={s.trustBar}>
                    <span className={s.trustFill} style={{ width: `${Math.round(src.trust * 100)}%` }} />
                  </span>
                  {src.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {quiet && (
        <section className={s.card}>
          <p className={`${s.pulse} ${s.pulseEmpty}`}>
            Nothing ingested in the last 24h. Run <code>npm run worker -- --once</code>.
          </p>
        </section>
      )}
    </aside>
  );
}
