import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnvFile, parseEnv } from "./env.mjs";

// Regression: the web app silently lost DATABASE_URL because nothing loaded the
// repo-root `.env`, so every page rendered "Feed unavailable".
describe("parseEnv", () => {
  it("parses plain assignments, blanks and comments", () => {
    const parsed = parseEnv(
      ["# comment", "", "AI_PROVIDER=none", "LOG_LEVEL=info", "  # indented comment"].join("\n"),
    );
    expect(parsed).toEqual({ AI_PROVIDER: "none", LOG_LEVEL: "info" });
  });

  it("keeps quoted values verbatim (URLs contain & and ?)", () => {
    // Regression: the DATABASE_URL is quoted because the query string has `&`.
    const url = "postgresql://u:p@host/db?sslmode=require&channel_binding=require";
    expect(parseEnv(`DATABASE_URL='${url}'`)).toEqual({ DATABASE_URL: url });
    expect(parseEnv(`DATABASE_URL="${url}"`)).toEqual({ DATABASE_URL: url });
  });

  it("handles empty values, inline comments and the export prefix", () => {
    expect(parseEnv(["GITHUB_TOKEN=", "AI_API_KEY=abc # trailing note", "export X=1"].join("\n"))).toEqual({
      GITHUB_TOKEN: "",
      AI_API_KEY: "abc",
      X: "1",
    });
  });

  it("ignores junk lines instead of throwing", () => {
    expect(parseEnv("not an assignment\nDATABASE_URL=x\n")).toEqual({ DATABASE_URL: "x" });
  });
});

describe("loadEnvFile", () => {
  it("applies file values and never overwrites already-set variables", () => {
    const file = join(tmpdir(), `tech-intel-env-${process.pid}.env`);
    writeFileSync(file, "DATABASE_URL='postgres://from-file'\nAI_PROVIDER=none\n");
    try {
      const env = { DATABASE_URL: "postgres://from-real-env" };
      const applied = loadEnvFile(file, env);
      // Real environment variables win over the file.
      expect(env.DATABASE_URL).toBe("postgres://from-real-env");
      expect(env.AI_PROVIDER).toBe("none");
      expect(applied).toEqual(["AI_PROVIDER"]);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("is a no-op for a missing file", () => {
    const env = {};
    expect(loadEnvFile("/nonexistent/path/.env", env)).toEqual([]);
    expect(env).toEqual({});
  });
});
