import { createHash } from "node:crypto";
import type { NormalizedItem } from "./types.js";

export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    // Drop common tracking params
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]) {
      u.searchParams.delete(p);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return url.trim();
  }
}

export function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}

export function contentHash(item: Pick<NormalizedItem, "title" | "canonical_url">): string {
  return createHash("sha256")
    .update(`${normalizeTitle(item.title)}|${canonicalizeUrl(item.canonical_url)}`)
    .digest("hex");
}

/** 64-bit SimHash over unigram+bigram shingles for near-duplicate detection.
 *  Full SHA-256 is XOR-folded to 64 bits so all digest bytes contribute. */
export function simHash(text: string): bigint {
  const words = normalizeTitle(text).split(" ").filter(Boolean);
  const shingles: string[] = [...words];
  for (let i = 0; i < words.length - 1; i++) shingles.push(words[i] + " " + words[i + 1]);
  if (shingles.length === 0) return 0n;
  const vec = new Array<number>(64).fill(0);
  for (const shingle of shingles) {
    const h = createHash("sha256").update(shingle).digest();
    // XOR-fold 32 bytes -> 8 bytes -> 64-bit fingerprint
    let folded = 0n;
    for (let off = 0; off < 32; off += 8) {
      folded ^= h.readBigUInt64LE(off);
    }
    for (let b = 0; b < 64; b++) {
      const bit = (folded >> BigInt(b)) & 1n;
      vec[b] += bit === 1n ? 1 : -1;
    }
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (vec[b] > 0) out |= 1n << BigInt(b);
  return out;
}

export function simHashDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export type DupKind = "exact" | "near_duplicate" | "same_story" | "related" | "independent";

export function classifyPair(a: NormalizedItem, b: NormalizedItem, nowMs = Date.now()): DupKind {
  if (contentHash(a) === contentHash(b)) return "exact";
  const d = simHashDistance(simHash(a.title), simHash(b.title));
  const dtHrs = Math.abs(Date.parse(a.published_at) - Date.parse(b.published_at)) / 36e5;
  const sharedEntities = a.entities.filter((e) => b.entities.includes(e)).length;
  if (d <= 3 && dtHrs <= 72) return "near_duplicate";
  if (d <= 12 && dtHrs <= 72 && sharedEntities > 0) return "same_story";
  if (sharedEntities >= 2) return "related";
  void nowMs;
  return "independent";
}
