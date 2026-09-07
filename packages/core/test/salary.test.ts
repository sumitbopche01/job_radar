import { describe, expect, it } from "vitest";
import { formatSalary } from "../src/util/salary.js";

describe("formatSalary", () => {
  it("renders annual ranges in k", () => {
    expect(formatSalary(120000, 160000, "$")).toBe("$120k–$160k");
  });

  it("renders a single value", () => {
    expect(formatSalary(200000, null, "$")).toBe("$200k");
    expect(formatSalary(null, 200000, "$")).toBe("$200k");
  });

  it("collapses equal min/max", () => {
    expect(formatSalary(150000, 150000, "$")).toBe("$150k");
  });

  it("does NOT show $0k for hourly/small values", () => {
    expect(formatSalary(61, 85, "$")).toBe("$61–$85");
  });

  it("returns null when no salary", () => {
    expect(formatSalary(null, null, "$")).toBeNull();
  });
});
