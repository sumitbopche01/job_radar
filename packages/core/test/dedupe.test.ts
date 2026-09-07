import { describe, expect, it } from "vitest";
import {
  dedupeKey,
  locationBucket,
  normalizeCompany,
  normalizeTitle,
} from "../src/util/normalize.js";

describe("normalizeCompany", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(normalizeCompany("Acme, Inc.")).toBe("acme");
    expect(normalizeCompany("Acme Labs")).toBe("acme");
    expect(normalizeCompany("Acme Technologies LLC")).toBe("acme");
  });

  it("treats the same brand across sources as one key", () => {
    expect(normalizeCompany("Stripe")).toBe(normalizeCompany("Stripe Inc"));
  });
});

describe("normalizeTitle", () => {
  it("removes parentheticals and punctuation", () => {
    expect(normalizeTitle("Senior Engineer (Remote)")).toBe("senior engineer");
    expect(normalizeTitle("Backend Engineer, Payments")).toBe("backend engineer payments");
  });

  it("does NOT collapse different seniorities (avoid over-merging)", () => {
    expect(normalizeTitle("Staff Engineer")).not.toBe(normalizeTitle("Senior Engineer"));
  });
});

describe("locationBucket", () => {
  it("buckets remote regardless of location text", () => {
    expect(locationBucket("Anywhere", "remote")).toBe("remote");
  });
  it("uses the first location segment otherwise", () => {
    expect(locationBucket("Berlin, Germany", "onsite")).toBe("berlin");
  });
});

describe("dedupeKey", () => {
  it("collides a genuine cross-source duplicate", () => {
    const a = dedupeKey("Acme Inc", "Senior Engineer (Remote)", "Remote - US", "remote");
    const b = dedupeKey("Acme", "Senior Engineer", "Anywhere", "remote");
    expect(a).toBe(b);
  });

  it("keeps distinct roles apart", () => {
    const eng = dedupeKey("Acme", "Backend Engineer", "Berlin", "onsite");
    const pm = dedupeKey("Acme", "Product Manager", "Berlin", "onsite");
    expect(eng).not.toBe(pm);
  });

  it("keeps the same role in different cities apart", () => {
    const berlin = dedupeKey("Acme", "Backend Engineer", "Berlin", "onsite");
    const london = dedupeKey("Acme", "Backend Engineer", "London", "onsite");
    expect(berlin).not.toBe(london);
  });
});
