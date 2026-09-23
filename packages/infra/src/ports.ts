export interface SearchPort {
  indexItem(item: { id: string; title: string; summary?: string }): Promise<void>;
  search(q: string, filters?: { topic?: string; source?: string }): Promise<Array<{ id: string; score: number }>>;
}

/** Postgres FTS implementation (M4). Contract-tested; swap to Typesense later. */
export class NoopSearch implements SearchPort {
  async indexItem(): Promise<void> {}
  async search(): Promise<Array<{ id: string; score: number }>> {
    return [];
  }
}

export interface EnrichmentProvider {
  readonly name: string;
  summarize(title: string, summary?: string): Promise<{ summary: string; why_it_matters: string } | null>;
}

/** Default: no AI — feed still works (ADR-005). */
export class NoneEnrichment implements EnrichmentProvider {
  readonly name = "none";
  async summarize(): Promise<null> {
    return null;
  }
}
