import Filters from "./components/Filters";
import KeyboardNav from "./components/KeyboardNav";
import LoadMore from "./components/LoadMore";
import Sidebar from "./components/Sidebar";
import StoryCard, { StoryHero } from "./components/StoryCard";
import Tabs from "./components/Tabs";
import TopicRail from "./components/TopicRail";
import ui from "./components/ui.module.css";
import s from "./components/Shell.module.css";
import { loadInsights } from "../lib/insights";
import { listStories, parseListQuery, type ListQuery } from "../lib/stories";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

/** Canonical params for API + fallback links (cursor appended by LoadMore). */
function feedParams(query: ListQuery): string {
  const p = new URLSearchParams({ tab: query.tab, limit: String(query.limit) });
  if (query.topic) p.set("topic", query.topic);
  if (query.source) p.set("source", query.source);
  if (query.entity) p.set("entity", query.entity);
  if (query.q) p.set("q", query.q);
  return p.toString();
}

function errMessage(e: unknown): string {
  return e && typeof e === "object" && "body" in e ? (e as { body: { message: string } }).body.message : "bad request";
}

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  let query;
  try {
    query = parseListQuery(sp);
  } catch (e) {
    return (
      <div className={ui.alert} role="alert">
        Invalid query: {errMessage(e)}. <a href="/">Reset filters</a>
      </div>
    );
  }

  let data;
  try {
    data = await listStories(query);
  } catch {
    return (
      <div className={ui.alert} role="alert">
        Feed unavailable — is the database reachable and the worker running?{" "}
        <span style={{ color: "var(--text-muted)" }}>
          Check <code>npm run worker -- --once</code> and the health endpoint.
        </span>
      </div>
    );
  }

  // Rail data is decoration: load it after the feed so a failure cannot break the page.
  const insights = await loadInsights();

  const [lead, ...rest] = data.stories;
  const hero = lead && lead.image_url ? lead : null;
  const rows = hero ? rest : data.stories;

  return (
    <div className={s.columns}>
      <div className={s.main}>
        <div className={s.navRow}>
          <Tabs active={query.tab} topic={query.topic} source={query.source} entity={query.entity} q={query.q} />
          <Filters tab={query.tab} topic={query.topic} source={query.source} entity={query.entity} q={query.q} />
        </div>
        <TopicRail topics={insights?.topics ?? []} active={query.topic} tab={query.tab} />

        {data.stories.length === 0 ? (
          <p className={ui.empty}>
            No stories match. Run the ingestion worker with <code>npm run worker -- --once</code>, or{" "}
            <a href="/">clear the filters</a>.
          </p>
        ) : (
          <>
            {hero && <StoryHero story={hero} />}
            <h2 className={s.sectionTitle}>
              {hero ? "More stories" : query.tab === "latest" ? "Latest" : query.tab === "trending" ? "Trending" : "Top stories"}
              <span className={s.sectionCount}>{rows.length} shown</span>
            </h2>
            <ul className={s.feedList}>
              {rows.map((story, i) => (
                <li key={story.id}>
                  <StoryCard story={story} rank={hero ? i + 2 : i + 1} />
                </li>
              ))}
              {data.next_cursor && (
                <LoadMore
                  apiBase={`/api/stories?${feedParams(query)}`}
                  pageBase={`/?${feedParams(query)}`}
                  initialCursor={data.next_cursor}
                  startRank={rows.length + (hero ? 2 : 1)}
                />
              )}
            </ul>
          </>
        )}

        <p className={s.hint}>
          <kbd>/</kbd> search · <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>Esc</kbd> leave field
        </p>
        <KeyboardNav />
      </div>
      <Sidebar data={insights} />
    </div>
  );
}
