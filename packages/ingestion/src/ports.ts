import type { NormalizedItem } from "../../domain/src/types.js";

export interface RawPayload {
  source_id: string;
  external_id: string;
  fetched_at: string;
  url: string;
  raw: unknown;
}

export interface ConnectorMeta {
  id: string;
  type: string;
  cadence_ms: number;
  needs_auth: boolean;
}

export interface SourceConnector {
  meta(): ConnectorMeta;
  fetch(ctx: FetchCtx): AsyncIterable<RawPayload>;
  parse(raw: RawPayload): ParsedItem[];
  normalize(parsed: ParsedItem): NormalizedItem;
}

export interface FetchCtx {
  signal: AbortSignal;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface ParsedItem {
  external_id: string;
  title: string;
  url: string;
  author?: string;
  published_at: string;
  summary?: string;
  image_url?: string;
  raw: unknown;
}
