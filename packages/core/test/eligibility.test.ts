import { describe, expect, it } from "vitest";
import { isEligible } from "../src/filters/eligibility.js";

describe("isEligible", () => {
  it("keeps India onsite", () => {
    expect(isEligible("Bengaluru, India", "onsite")).toBe(true);
    expect(isEligible("Gurugram", "onsite")).toBe(true);
    expect(isEligible("IN-Bengaluru", "onsite")).toBe(true);
  });

  it("keeps Dubai/UAE and Singapore onsite", () => {
    expect(isEligible("Dubai, United Arab Emirates", "onsite")).toBe(true);
    expect(isEligible("Singapore", "onsite")).toBe(true);
  });

  it("keeps generic/global/APAC remote", () => {
    expect(isEligible("Remote", "remote")).toBe(true);
    expect(isEligible("Remote - Global", "remote")).toBe(true);
    expect(isEligible("Remote - APAC", "remote")).toBe(true);
    expect(isEligible("Anywhere", "remote")).toBe(true);
    expect(isEligible(null, "remote")).toBe(true);
  });

  it("keeps remote explicitly tied to India", () => {
    expect(isEligible("Remote - India", "remote")).toBe(true);
  });

  it("drops onsite outside eligible geos", () => {
    expect(isEligible("San Francisco, CA", "onsite")).toBe(false);
    expect(isEligible("London, UK", "onsite")).toBe(false);
    expect(isEligible("Tokyo, Japan", "onsite")).toBe(false);
    expect(isEligible("United States", "onsite")).toBe(false);
  });

  it("drops region-locked remote", () => {
    expect(isEligible("Remote - US", "remote")).toBe(false);
    expect(isEligible("Remote - USA", "remote")).toBe(false);
    expect(isEligible("Remote (EMEA)", "remote")).toBe(false);
    expect(isEligible("Remote - Canada", "remote")).toBe(false);
    expect(isEligible("Remote - Americas", "remote")).toBe(false);
  });

  it("drops remote roles pinned to a non-eligible city (the HQ-remote trap)", () => {
    expect(isEligible("San Francisco", "remote")).toBe(false);
    expect(isEligible("New York, NY (HQ)", "remote")).toBe(false);
    expect(isEligible("London", "remote")).toBe(false);
    expect(isEligible("San Francisco, CA, US; Remote, US", "remote")).toBe(false);
  });

  it("keeps multi-region remote that includes an eligible geo", () => {
    expect(isEligible("Remote - US or India", "remote")).toBe(true);
  });
});
