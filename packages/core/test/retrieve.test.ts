import { describe, expect, it } from "vitest";
import { profileKeywords } from "../src/scoring/retrieve.js";
import type { ProfileRow } from "../src/profiles/index.js";

function profile(over: Partial<ProfileRow>): ProfileRow {
  return {
    id: "p1",
    label: "agent-llm-infra",
    resumeMd: "",
    mustHave: null,
    exclude: null,
    embedding: null,
    ...over,
  };
}

describe("profileKeywords", () => {
  it("pulls label tokens (len>2) and stack_any into an OR query", () => {
    const kw = profileKeywords(profile({ mustHave: { stack_any: ["LLM", "Agent", "pgvector"] } }));
    expect(kw).toContain("agent");
    expect(kw).toContain("llm");
    expect(kw).toContain("pgvector");
    expect(kw).toContain(" OR ");
  });

  it("dedupes and lowercases", () => {
    const kw = profileKeywords(profile({ label: "backend-platform", mustHave: { stack_any: ["Go", "go"] } }));
    const terms = kw.split(" OR ");
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms).toContain("backend");
    expect(terms).toContain("platform");
  });

  it("handles a profile with no keyword hints", () => {
    const kw = profileKeywords(profile({ label: "x", mustHave: null }));
    expect(kw).toBe(""); // label 'x' is len<=2, no stack -> empty query
  });
});
