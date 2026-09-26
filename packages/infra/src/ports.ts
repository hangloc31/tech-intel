export interface SearchFilters {
  topic?: string;
  source?: string;
  author?: string;
  entity?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export interface SearchPort {
  indexItem(item: { id: string; title: string; summary?: string }): Promise<void>;
  search(q: string, filters?: SearchFilters): Promise<Array<{ id: string; score: number }>>;
}

/** No-op search (tests / Typesense-later swap point). Contract: always []. */
export class NoopSearch implements SearchPort {
  async indexItem(): Promise<void> {}
  async search(): Promise<Array<{ id: string; score: number }>> {
    return [];
  }
}

export interface Enrichment {
  summary: string;
  why_it_matters: string;
  key_points: string[];
}

export interface EnrichmentProvider {
  readonly name: string;
  summarize(title: string, summary?: string): Promise<Enrichment | null>;
}

/** Default: no AI — feed still works (ADR-005). */
export class NoneEnrichment implements EnrichmentProvider {
  readonly name = "none";
  async summarize(): Promise<null> {
    return null;
  }
}
