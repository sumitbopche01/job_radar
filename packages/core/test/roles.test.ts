import { describe, expect, it } from "vitest";
import { matchesRole } from "../src/filters/roles.js";

describe("matchesRole", () => {
  it("matches the four target families", () => {
    expect(matchesRole("AI Engineer, GTM")).toBe(true);
    expect(matchesRole("Machine Learning Engineer II")).toBe(true);
    expect(matchesRole("Member of Technical Staff")).toBe(true);
    expect(matchesRole("Forward Deployed Engineer")).toBe(true);
    expect(matchesRole("Solutions Architect")).toBe(true);
    expect(matchesRole("Staff Backend Engineer, India")).toBe(true);
    expect(matchesRole("Full-Stack Developer")).toBe(true);
    expect(matchesRole("Software Development Engineer (SDE III)")).toBe(true);
  });

  it("rejects non-engineering titles", () => {
    expect(matchesRole("Senior Payroll Manager, APAC")).toBe(false);
    expect(matchesRole("Adoption Strategist")).toBe(false);
    expect(matchesRole("Revenue Leader - Mid-Market")).toBe(false);
    expect(matchesRole("SAP Functional SME")).toBe(false);
    expect(matchesRole("People Research Data Scientist")).toBe(false); // data scientist not in target families
  });
});

import { isTitleRegexBlocked } from "../src/filters/stage0.js";

describe("isTitleRegexBlocked (Java-primary, not JavaScript)", () => {
  it("blocks Java-primary titles", () => {
    expect(isTitleRegexBlocked("(Senior) Backend Software Engineer (Java)")).toBe(true);
    expect(isTitleRegexBlocked("Java Developer")).toBe(true);
    expect(isTitleRegexBlocked("Senior Java/Kotlin Engineer")).toBe(true);
  });
  it("keeps JavaScript / non-Java titles", () => {
    expect(isTitleRegexBlocked("JavaScript Engineer")).toBe(false);
    expect(isTitleRegexBlocked("Full-Stack Engineer (React/JavaScript)")).toBe(false);
    expect(isTitleRegexBlocked("Backend Engineer (Go)")).toBe(false);
    expect(isTitleRegexBlocked("AI Engineer")).toBe(false);
  });
});
