export type ContentType = "article" | "post" | "discussion" | "release" | "paper" | "video";
export type SourceKind = "news" | "blog" | "engineering_blog" | "community" | "official" | "social" | "code";

export interface NormalizedItem {
  source_id: string;
  external_id: string;
  title: string;
  url: string;
  canonical_url: string;
  author?: string;
  published_at: string; // UTC ISO
  content_type: ContentType;
  summary?: string;
  image_url?: string;
  topics: string[];
  entities: string[];
}

export interface RankInput {
  published_at: string;
  source_trust: number; // 0..1
  source_count: number; // cross-source confirmation
  engagement: number; // normalized >= 0
}
