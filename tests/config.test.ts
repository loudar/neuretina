import { describe, expect, test } from "bun:test";
import { DEFAULT_SEARCH_DOMAINS, loadConfig } from "../src/config/env.ts";

describe("search domain config", () => {
  test("defaults to the reputable allowlist", () => {
    const config = loadConfig({ DB_PATH: ":memory:" });

    expect(config.defaults.searchDomains).toEqual(DEFAULT_SEARCH_DOMAINS);
    expect(DEFAULT_SEARCH_DOMAINS.length).toBeLessThanOrEqual(20);
  });

  test("defaults the search window to the last 3 days", () => {
    const config = loadConfig({ DB_PATH: ":memory:" });

    expect(config.defaults.searchRecency).toBe("3days");
  });

  test("accepts a custom list and the off switch", () => {
    const custom = loadConfig({
      DB_PATH: ":memory:",
      DEFAULT_SEARCH_DOMAINS: "a.com, b.com",
    });
    expect(custom.defaults.searchDomains).toEqual(["a.com", "b.com"]);

    const off = loadConfig({ DB_PATH: ":memory:", DEFAULT_SEARCH_DOMAINS: "off" });
    expect(off.defaults.searchDomains).toEqual([]);
  });

  test("caps the list at Perplexity's 20-domain limit", () => {
    const domains = Array.from({ length: 25 }, (_, index) => `d${index}.com`).join(",");
    const config = loadConfig({ DB_PATH: ":memory:", DEFAULT_SEARCH_DOMAINS: domains });

    expect(config.defaults.searchDomains).toHaveLength(20);
  });
});
