import { describe, expect, it } from "vitest";
import { pendingMigrations } from "../migrate.js";

describe("pendingMigrations", () => {
  it("returns .sql files in order, skipping applied ones", () => {
    expect(pendingMigrations(["002_x.sql", "001_init.sql", "README.md"], new Set(["001_init.sql"]))).toEqual([
      "002_x.sql",
    ]);
  });

  it("returns everything when nothing was applied", () => {
    expect(pendingMigrations(["003.sql", "001.sql", "002.sql"], new Set())).toEqual(["001.sql", "002.sql", "003.sql"]);
  });

  it("is empty when fully applied", () => {
    expect(pendingMigrations(["001_init.sql"], new Set(["001_init.sql"]))).toEqual([]);
  });
});
