import { notFound } from "next/navigation";
import KeyboardNav from "../../components/KeyboardNav";
import LoadMore from "../../components/LoadMore";
import Sidebar from "../../components/Sidebar";
import StoryCard, { StoryHero } from "../../components/StoryCard";
import Tabs from "../../components/Tabs";
import ui from "../../components/ui.module.css";
import s from "../../components/Shell.module.css";
import { loadInsights } from "../../../lib/insights";
import { listStories, parseListQuery } from "../../../lib/stories";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function TopicPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<SP> }) {
  const { name } = await params;
  const topic = decodeURIComponent(name);
  if (!topic || topic.length > 64) notFound();
  const sp = await searchParams;
  const flat: Record<string, string | undefined> = { topic };
  for (const [k, v] of Object.entries(sp)) {
    if (k === "topic") continue;
    flat[k] = Array.isArray(v) ? v[0] : v;
  }

  let data;
  let query;
  try {
    query = parseListQuery({ ...flat, tab: flat.tab ?? "top" });
    data = await listStories(query);
  } catch {
    return (
      <p className={ui.alert} role="alert">
        Topic unavailable — is the database reachable?
      </p>
    );
  }

  const insights = await loadInsights();
  const [lead, ...rest] = data.stories;
  const hero = lead && lead.image_url ? lead : null;
  const rows = hero ? rest : data.stories;
  const feedParams = new URLSearchParams({ tab: query.tab, limit: String(query.limit), topic });
  if (query.source) feedParams.set("source", query.source);
  if (query.entity) feedParams.set("entity", query.entity);
  if (query.q) feedParams.set("q", query.q);

  return (
    <div className={s.columns}>
      <div className={s.main}>
        <div className={s.navRow}>
          <Tabs active={query.tab} topic={topic} source={query.source} entity={query.entity} q={query.q} />
        </div>
        <h1 style={{ fontSize: 20, margin: "0 0 14px" }}>
          Topic: <span style={{ color: "var(--accent)" }}>{topic}</span>{" "}
          <span className={s.sectionCount}>{data.stories.length} stories</span>
        </h1>
        {data.stories.length === 0 ? (
          <p className={ui.empty}>
            No stories in this topic yet. <a href="/">← back to feed</a>
          </p>
        ) : (
          <>
            {hero && <StoryHero story={hero} />}
            <ul className={s.feedList}>
              {rows.map((story, i) => (
                <li key={story.id}>
                  <StoryCard story={story} rank={hero ? i + 2 : i + 1} />
                </li>
              ))}
              {data.next_cursor && (
                <LoadMore
                  apiBase={`/api/stories?${feedParams.toString()}`}
                  pageBase={`/topic/${encodeURIComponent(topic)}?${feedParams.toString()}`}
                  initialCursor={data.next_cursor}
                  startRank={rows.length + (hero ? 2 : 1)}
                />
              )}
            </ul>
          </>
        )}
        <KeyboardNav />
      </div>
      <Sidebar data={insights} />
    </div>
  );
}
