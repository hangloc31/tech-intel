// Minimal stdlib `.env` loader.
//
// Why this exists: Next.js only auto-loads `.env*` from the app directory
// (apps/web), but this repo keeps a single `.env` at the monorepo root, so the
// web app never saw DATABASE_URL and every request failed with
// "Feed unavailable". Node's `--env-file` flag cannot help here because it only
// applies to the process Node starts (the Next server), not to a config file.
//
// No dependency added, on purpose (AGENTS.md: prefer stdlib).
import { readFileSync } from "node:fs";

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*?)\s*$/;

/**
 * Parses the dotenv subset this repo uses: KEY=VALUE, blank lines, `#` comments,
 * optional `export` prefix, and single/double quoted values. Unquoted values may
 * carry a trailing ` # comment`. Anything else is ignored (never throws).
 */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = line.match(ASSIGNMENT);
    if (!m) continue;
    const quote = m[2][0];
    if (m[2].length > 1 && (quote === '"' || quote === "'") && m[2].endsWith(quote)) {
      out[m[1]] = m[2].slice(1, -1);
      continue;
    }
    const hash = m[2].indexOf(" #");
    out[m[1]] = hash === -1 ? m[2] : m[2].slice(0, hash).trim();
  }
  return out;
}

/**
 * Applies an env file to `env` (defaults to process.env) without overwriting
 * variables that are already set: real environment variables always win.
 * A missing/unreadable file is a no-op. Returns the keys that were applied.
 */
export function loadEnvFile(envPath, env = process.env) {
  let text;
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return [];
  }
  const applied = [];
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (env[key] === undefined) {
      env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}
