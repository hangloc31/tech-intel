async function getStories() {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/stories`, { next: { revalidate: 60 } });
    if (!res.ok) return { stories: [], note: "api-unavailable" };
    return await res.json();
  } catch {
    return { stories: [], note: "api-unavailable" };
  }
}

export default async function Home({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab ?? "top";
  const data = await getStories();
  return (
    <section>
      <nav aria-label="feed tabs">
        {["top", "latest", "trending"].map((t) => (
          <a key={t} href={`/?tab=${t}`} style={{ marginRight: 12, color: t === tab ? "#fff" : "#888" }}>
            {t}
          </a>
        ))}
      </nav>
      {data.stories.length === 0 ? (
        <p role="status">No stories yet — run the ingestion worker (`npm run worker`). ({data.note})</p>
      ) : (
        <ul>
          {data.stories.map((s: { id: string; title: string }) => (
            <li key={s.id}>
              <a href={`/story/${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ul>
      )}
      <p style={{ color: "#666" }}>
        Keyboard: <kbd>/</kbd> search, <kbd>j</kbd>/<kbd>k</kbd> navigate (M2).
      </p>
    </section>
  );
}
