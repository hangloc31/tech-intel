import { describe, expect, it, vi } from "vitest";
import { runOnce } from "../pipeline.js";
import type { SourceConnector } from "../ports.js";

function item(id: string) {
  return {
    external_id: id,
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    published_at: new Date().toISOString(),
    raw: { id },
  };
}

function fake(id: string, impl: Partial<SourceConnector> = {}): SourceConnector {
  return {
    meta: () => ({ id, type: "test", cadence_ms: 1000, needs_auth: false }),
    fetch: async function* () {},
    parse: (raw) => [item(String(raw.external_id))],
    normalize: (p) => ({
      source_id: id,
      external_id: p.external_id,
      title: p.title,
      url: p.url,
      canonical_url: p.url,
      published_at: p.published_at,
      content_type: "article",
      topics: [],
      entities: [],
    }),
    ...impl,
  };
}

function raw(id: string, ext: string) {
  return { source_id: id, external_id: ext, fetched_at: new Date().toISOString(), url: `https://x/${ext}`, raw: {} };
}

describe("pipeline", () => {
  it("isolates a failing source: others still run", async () => {
    const bad = fake("bad", {
      fetch: async function* () {
        throw new Error("down");
      },
    });
    const good = fake("good", {
      fetch: async function* () {
        yield raw("good", "g1");
      },
    });
    const sink = vi.fn(async () => ({ raw_inserted: 1, items_upserted: 1 }));
    const [rb, rg] = await runOnce([bad, good], { sink, fetchRetries: 0 });
    expect(rb.errors[0]).toMatch(/fetch: down/);
    expect(rg.fetched).toBe(1);
    expect(rg.stored).toBe(1);
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("retries transient fetch failures", async () => {
    let calls = 0;
    const flaky = fake("flaky", {
      fetch: async function* () {
        calls++;
        if (calls === 1) throw new Error("blip");
        yield raw("flaky", "f1");
      },
    });
    const [r] = await runOnce([flaky], { fetchRetries: 2 });
    expect(calls).toBe(2);
    expect(r.errors).toEqual([]);
    expect(r.fetched).toBe(1);
  });

  it("never retries rate-limited fetches", async () => {
    let calls = 0;
    const limited = fake("limited", {
      fetch: async function* () {
        calls++;
        throw new Error("github rate-limited (reset=1)");
      },
    });
    const [r] = await runOnce([limited], { fetchRetries: 3 });
    expect(calls).toBe(1);
    expect(r.errors[0]).toMatch(/rate-limited/);
  });

  it("isolates normalize errors per item", async () => {
    const c = fake("n", {
      fetch: async function* () {
        yield raw("n", "ok");
        yield raw("n", "bad");
      },
      parse: (r) => [item(String(r.external_id))],
      normalize: (p) => {
        if (p.external_id === "bad") throw new Error("nope");
        return fake("n").normalize!(p);
      },
    });
    const sink = vi.fn(async (_sid: string, items: unknown[]) => ({ raw_inserted: 1, items_upserted: 1 }));
    const [r] = await runOnce([c], { sink });
    expect(r.parsed).toBe(2);
    expect(r.normalized).toBe(1);
    expect(r.errors[0]).toMatch(/normalize/);
    expect(sink.mock.calls[0][1]).toHaveLength(1);
  });

  it("drops items older than maxAgeDays before persist", async () => {
    const nowMs = Date.parse("2026-09-26T12:00:00.000Z");
    const dated = (ext: string, iso: string) => ({ ...item(ext), published_at: iso });
    const c = fake("age", {
      fetch: async function* () {
        yield raw("age", "fresh");
        yield raw("age", "stale");
        yield raw("age", "nodate");
      },
      parse: (r) => {
        const ext = String(r.external_id);
        if (ext === "fresh") return [dated(ext, "2026-09-25T12:00:00.000Z")];
        if (ext === "stale") return [dated(ext, "2026-01-01T00:00:00.000Z")];
        return [dated(ext, "not-a-date")];
      },
    });
    const seen: unknown[][] = [];
    const sink = vi.fn(async (_sid: string, items: unknown[]) => {
      seen.push(items);
      return { raw_inserted: items.length, items_upserted: items.length };
    });
    const [r] = await runOnce([c], { sink, nowMs, maxAgeDays: 30 });
    expect(r.normalized).toBe(3);
    expect(r.filtered_stale).toBe(1);
    expect(r.filtered_cap).toBe(0);
    // Fresh + unparseable dates are kept; the January item is dropped.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(2);
    expect(r.stored).toBe(2);
  });

  it("caps each source to the newest items", async () => {
    const c = fake("cap", {
      fetch: async function* () {
        for (const d of ["01", "05", "03", "04", "02"]) yield raw("cap", `2026-09-${d}`);
      },
      parse: (r) => [{ ...item(String(r.external_id)), published_at: `${String(r.external_id)}T12:00:00.000Z` }],
    });
    let kept: Array<{ normalized: { published_at: string } }> = [];
    const sink = vi.fn(async (_sid: string, items: typeof kept) => {
      kept = items;
      return { raw_inserted: items.length, items_upserted: items.length };
    });
    const [r] = await runOnce([c], { sink, maxItemsPerSource: 2, maxAgeDays: 0 });
    expect(r.filtered_stale).toBe(0);
    expect(r.filtered_cap).toBe(3);
    expect(kept.map((i) => i.normalized.published_at)).toEqual([
      "2026-09-05T12:00:00.000Z",
      "2026-09-04T12:00:00.000Z",
    ]);
  });
});
