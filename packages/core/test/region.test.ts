import { describe, expect, it } from "vitest";
import { classifyRegion } from "../src/filters/region.js";
import { outreachLinks } from "../src/outreach/index.js";

describe("classifyRegion", () => {
  it("classifies the geos", () => {
    expect(classifyRegion("Bengaluru, India", "onsite")).toBe("india");
    expect(classifyRegion("Dubai, UAE", "onsite")).toBe("uae");
    expect(classifyRegion("Singapore", "onsite")).toBe("singapore");
    expect(classifyRegion("Berlin, Germany", "onsite")).toBe("europe");
    expect(classifyRegion("London", "onsite")).toBe("europe");
    expect(classifyRegion("Remote", "remote")).toBe("remote");
    expect(classifyRegion("San Francisco, CA", "onsite")).toBe("other");
  });

  it("prefers India when a role lists multiple eligible regions", () => {
    expect(classifyRegion("Remote - India or Europe", "remote")).toBe("india");
  });
});

describe("outreachLinks", () => {
  it("builds LinkedIn people-search + Google links scoped to the company", () => {
    const links = outreachLinks("Acme", "Senior Backend Engineer");
    expect(links.length).toBeGreaterThanOrEqual(4);
    const hm = links.find((l) => l.label === "Hiring manager")!;
    expect(hm.url).toContain("linkedin.com/search/results/people");
    expect(decodeURIComponent(hm.url)).toContain("Acme");
    expect(links.some((l) => l.url.includes("google.com/search"))).toBe(true);
  });
});
