import StoryCard from "../components/StoryCard";
import ui from "../components/ui.module.css";
import s from "../components/Shell.module.css";
import { parseSearchQuery, searchStories } from "../../lib/search";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

const input = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  padding: "6px 10px",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 14,
  minWidth: 260,
} as const;

function SearchForm({ q }: { q?: string }) {
  return (
    <form method="get" action="/search" role="search" className={s.searchForm}>
      <input name="q" defaultValue={q ?? ""} aria-label="search" placeholder="Search stories…" style={input} />
      <button type="submit" className={ui.btn}>
        Search
      </button>
    </form>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) flat[k] = Array.isArray(v) ? v[0] : v;

  if (!flat.q) {
    return (
      <section>
        <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>Search</h1>
        <SearchForm />
      </section>
    );
  }

  let query;
  try {
    query = parseSearchQuery(flat);
  } catch (e) {
    const msg =
      e && typeof e === "object" && "body" in e ? (e as { body: { message: string } }).body.message : "bad request";
    return (
      <p className={ui.alert} role="alert">
        Invalid query: {msg}
      </p>
    );
  }

  let results;
  try {
    ({ results } = await searchStories(query));
  } catch {
    return (
      <p className={ui.alert} role="alert">
        Search unavailable — is the database reachable?
      </p>
    );
  }

  return (
    <section>
      <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>
        Search: <span style={{ color: "var(--text-muted)" }}>{query.q}</span>{" "}
        <span className={s.sectionCount}>{results.length} result{results.length === 1 ? "" : "s"}</span>
      </h1>
      <SearchForm q={query.q} />
      <div style={{ marginTop: 16 }}>
        {results.length === 0 ? (
          <p className={ui.empty}>No matches. Try fewer or more general keywords.</p>
        ) : (
          <ul className={s.feedList}>
            {results.map((r) => (
              <li key={r.story.id}>
                <StoryCard story={r.story} />
                {r.snippet && (
                  <p className={s.snippet} dangerouslySetInnerHTML={{ __html: `…${r.snippet}…` }} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
