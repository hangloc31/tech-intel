import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./lib/env.mjs";

// Next.js only auto-loads `.env*` from apps/web, so the repo-root `.env` is
// loaded explicitly here. Runs before the app reads any env var; already-set
// real environment variables take precedence. See lib/env.mjs.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const loaded = loadEnvFile(join(repoRoot, ".env"));
if (loaded.length > 0) {
  // Keys only, never values: this file must stay safe to paste into a bug report.
  console.log(`[config] loaded .env from repo root: ${loaded.join(", ")}`);
}

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Keep `pg` as a real runtime require. Bundled, its conditional
  // `pg-native` / `cloudflare:sockets` requires cannot be resolved by webpack.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
