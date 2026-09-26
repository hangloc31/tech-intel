import { notFound } from "next/navigation";
import SourceIcon from "../../components/SourceIcon";
import Thumb from "../../components/Thumb";
import ui from "../../components/ui.module.css";
import { timeAgo, topicColor } from "../../../lib/format";
import { getStory, topTopics } from "../../../lib/stories";
import s from "./detail.module.css";

export const dynamic = "force-dynamic";

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let story;
  try {
    story = await getStory(id);
  } catch {
    return (
      <div className={ui.alert} role="alert">
        Story unavailable — is the database reachable?
      </div>
    );
  }
  if (!story) notFound();

  const original = story.items.find((i) => i.role === "original") ?? story.items[0];
  const rest = story.items.filter((i) => i !== original);
  const topics = topTopics(story.items);

  return (
    <article className={s.wrap}>
      <a href="/" className={s.back}>
        ← feed
      </a>
      <h1 className={s.title}>{story.title}</h1>
      <p className={s.meta}>
        {story.source_count > 1 && (
          <span className={ui.badgeAccent}>
            {story.source_count} outlets covering this
          </span>
        )}
        {original && <SourceIcon articleUrl={story.origin_url ?? original.url} source={original.source_id} />}
        {topics.map((t) => (
          <span key={t} className={ui.badge}>
            <span className={ui.dot} style={{ background: topicColor(t) }} />
            {t}
          </span>
        ))}
        <time dateTime={story.first_seen_at} title={story.first_seen_at}>
          {timeAgo(story.first_seen_at)}
        </time>
      </p>

      {story.image_url && (
        <div className={s.media}>
          <Thumb src={story.image_url} alt="" fill />
        </div>
      )}

      {story.summary && <p className={s.lede}>{story.summary}</p>}

      {/* Only rendered when enrichment actually ran — the panel used to be a
          permanent empty promise while the enrichments table was empty. */}
      {story.enrichment && (
        <section className={s.panel} aria-label="ai summary">
          <h2 className={s.aiTitle}>AI summary · {story.enrichment.model_name}</h2>
          <p className={s.aiBody}>{story.enrichment.summary}</p>
          {story.enrichment.why_it_matters && <p className={s.aiMatters}>Why it matters: {story.enrichment.why_it_matters}</p>}
          {story.enrichment.key_points.length > 0 && (
            <ul className={s.keyPoints}>
              {story.enrichment.key_points.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {rest.length > 0 && (
        <section className={s.panel} aria-label="other coverage">
          <h2 className={s.panelTitle}>Other coverage</h2>
          <ul className={s.itemList}>
            {rest.map((i) => (
              <li key={i.id} className={s.item}>
                <h3 className={s.itemTitle}>
                  <a data-story href={i.url} rel="noopener noreferrer">
                    {i.title}
                  </a>
                </h3>
                <p className={s.itemMeta}>
                  <SourceIcon articleUrl={i.url} source={i.source_id} />
                  <span className={s.role}>{i.role}</span>
                  <time dateTime={i.published_at}>{fmt(i.published_at)}</time>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {story.related.length > 0 && (
        <section className={s.panel} aria-label="related stories">
          <h2 className={s.panelTitle}>Related</h2>
          <ul className={s.itemList}>
            {story.related.map((r) => (
              <li key={r.id} className={s.item}>
                <h3 className={s.itemTitle}>
                  <a data-story href={`/story/${r.id}`}>
                    {r.title}
                  </a>
                </h3>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={s.panel} aria-label="timeline">
        <h2 className={s.panelTitle}>Timeline</h2>
        <ul className={s.timeline}>
          {story.items.map((i) => (
            <li key={i.id}>
              <time dateTime={i.published_at}>{fmt(i.published_at)}</time> published · discovered{" "}
              <time dateTime={i.discovered_at}>{fmt(i.discovered_at)}</time> · {i.source_id}
              {i.author && ` · by ${i.author}`}
            </li>
          ))}
        </ul>
        <p
          className={s.debug}
          title="Rank signals: recency decay, originating-source trust, and how many outlets cover this story."
        >
          Ranked #{story.top_rank ?? "–"} in Top · {story.source_count}{" "}
          {story.source_count === 1 ? "outlet" : "outlets"}
          {story.origin_trust !== null && <> · origin trust {Math.round(story.origin_trust * 100)}%</>} · first seen{" "}
          <time dateTime={story.first_seen_at}>{fmt(story.first_seen_at)}</time>
        </p>
      </section>

      {original && (
        <div className={s.cta}>
          <a data-story href={original.url} rel="noopener noreferrer" className={s.ctaLink}>
            Read the original at {original.source_id} →
          </a>
          <p className={s.ctaNote}>We keep the headline and summary only — full text stays on the publisher&apos;s site.</p>
        </div>
      )}
    </article>
  );
}
