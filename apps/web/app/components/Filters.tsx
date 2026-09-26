import s from "./Nav.module.css";
import ui from "./ui.module.css";

/**
 * Scoped feed filters. Everything lives in the URL (?tab&topic&source&entity&q)
 * per AGENTS.md. The common case is "no filter", so the source/entity inputs are
 * tucked behind a disclosure instead of three always-visible text boxes.
 */
export default function Filters({
  tab,
  topic,
  source,
  entity,
  q,
}: {
  tab: string;
  topic?: string;
  source?: string;
  entity?: string;
  q?: string;
}) {
  const active = Boolean(topic || source || entity || q);
  const input = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    padding: "5px 9px",
    borderRadius: "var(--radius-sm)",
    font: "inherit",
    fontSize: 13,
  } as const;
  return (
    <details className={s.filters} open={active}>
      <summary className={active ? ui.chipActive : ui.chip}>
        Refine
        {active && <span className={s.railCount}>{[topic, source, entity, q].filter(Boolean).length}</span>}
      </summary>
      <form method="get" action="/" role="search" aria-label="filter stories" className={s.filterForm}>
        <input type="hidden" name="tab" value={tab} />
        <input
          name="q"
          placeholder="Filter this list…"
          defaultValue={q ?? ""}
          aria-label="filter these results by keywords"
          style={input}
        />
        <input name="topic" placeholder="Topic" defaultValue={topic ?? ""} aria-label="topic" style={input} />
        <input name="source" placeholder="Source id" defaultValue={source ?? ""} aria-label="source" style={input} />
        <input name="entity" placeholder="Entity" defaultValue={entity ?? ""} aria-label="entity" style={input} />
        <button type="submit" className={ui.btn}>
          Apply
        </button>
        {active && (
          <a href={`/?tab=${tab}`} className={ui.btnGhost}>
            Clear
          </a>
        )}
      </form>
    </details>
  );
}
