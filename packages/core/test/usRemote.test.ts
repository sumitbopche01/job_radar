import { describe, expect, it } from "vitest";
import { hasContractSignal, hasUsStrict, isUsPinned } from "../src/filters/usRemote.js";
import { usAccessOf } from "../src/filters/region.js";
import { isEligible } from "../src/filters/eligibility.js";
import { relativeAgeToDate } from "../src/ingest/remoteBoards.js";

describe("isUsPinned", () => {
  it("recognises US locations", () => {
    for (const l of ["Remote - US", "US Only", "Remote, United States", "USA", "San Francisco, CA", "Remote (US; CA)", "Austin, TX"]) {
      expect(isUsPinned(l)).toBe(true);
    }
  });
  it("does not misfire on India / EU / country codes", () => {
    for (const l of ["Bengaluru, IN", "Berlin, DE", "Remote", "Worldwide", "India", "Jakarta, ID"]) {
      expect(isUsPinned(l)).toBe(false);
    }
  });
  it("ignores US territories inside APAC country lists", () => {
    expect(isUsPinned("American Samoa, Australia, Bangladesh, Guam, India, United States Minor Outlying Islands")).toBe(false);
    expect(isUsPinned("Guam, Japan, United States")).toBe(true); // mainland still listed
  });
});

describe("hasUsStrict", () => {
  it("catches US-only requirements", () => {
    expect(hasUsStrict("must be authorized to work in the united states")).toBe(true);
    expect(hasUsStrict("candidates must be authorized to work in the u.s. without sponsorship")).toBe(true);
    expect(hasUsStrict("requires an active security clearance")).toBe(true);
    expect(hasUsStrict("we will not sponsor visas for this role")).toBe(true);
    expect(hasUsStrict("this is a remote role open to candidates residing in the us")).toBe(true);
    expect(hasUsStrict("work authorization: us citizen or us visa holder only")).toBe(true);
  });
  it("ignores unrelated text", () => {
    expect(hasUsStrict("we build tools for teams across the world")).toBe(false);
  });
});

describe("hasContractSignal — must describe THIS role's arrangement", () => {
  it("accepts real contract / hire-anywhere signals", () => {
    expect(hasContractSignal("this is a full-time contract position")).toBe(true);
    expect(hasContractSignal("you will be engaged as an independent contractor")).toBe(true);
    expect(hasContractSignal("we pay contractors via deel")).toBe(true);
    expect(hasContractSignal("employment type: contractor")).toBe(true);
    expect(hasContractSignal("work authorization: not required (open to international candidates)")).toBe(true);
    expect(hasContractSignal("", "AI Security Engineer (Remote Contract, USD 22/hr)")).toBe(true);
  });
  it("rejects the boilerplate / product copy the audit found", () => {
    // Reddit's privacy notice
    expect(hasContractSignal("to evaluate your application for employment or an independent contractor role, as applicable")).toBe(false);
    expect(hasContractSignal("security for government agencies and contractors")).toBe(false);
    expect(hasContractSignal("experience in b2b saas")).toBe(false);
    expect(hasContractSignal("a fully remote, globally distributed team")).toBe(false);
  });
});

describe("usAccessOf tiers", () => {
  it("india_ok when the allowed set lists India", () => {
    expect(usAccessOf("India, United States", "remote", "", "Senior Full Stack Engineer")).toBe("india_ok");
  });
  it("strict beats contract", () => {
    expect(
      usAccessOf("Remote - US", "remote", "this is a contract position. must be authorized to work in the united states", "Backend Engineer"),
    ).toBe("us_only");
  });
  it("contract when US-pinned with a real contract signal", () => {
    expect(usAccessOf("United States", "remote", "", "Unreal Engine Developer, Remote - Contract")).toBe("contract");
  });
  it("plain 'Remote - US' with no signal is us_only", () => {
    expect(usAccessOf("Remote - US", "remote", "great benefits", "Backend Engineer")).toBe("us_only");
  });
  it("generic remote with US hours", () => {
    expect(usAccessOf("Remote", "remote", "timezone: utc-8 to utc-5 (us hours)", "Engineer")).toBe("us_hours");
  });
  it("non-US roles return null", () => {
    expect(usAccessOf("Bengaluru, India", "onsite", "", "Engineer")).toBeNull();
  });
});

describe("isEligible — the US-contract door", () => {
  it("lets contract-friendly US roles through, keeps strict ones out", () => {
    expect(isEligible("Remote - US", "remote", "this is a contract position paid via deel")).toBe(true);
    expect(isEligible("Remote - US", "remote", "must be authorized to work in the united states")).toBe(false);
    expect(isEligible("Remote - US", "remote", "great benefits")).toBe(false);
    expect(isEligible("Remote - US", "remote")).toBe(false); // no description -> not eligible
  });
});

describe("relativeAgeToDate (YC createdAt)", () => {
  const now = Date.UTC(2026, 10, 23);
  it("parses relative ages", () => {
    expect(relativeAgeToDate("5 days", now)?.getTime()).toBe(now - 5 * 86_400_000);
    expect(relativeAgeToDate("about 1 year", now)?.getTime()).toBe(now - 31_536_000_000);
    expect(relativeAgeToDate("less than a minute", now)?.getTime()).toBe(now - 60_000);
    expect(relativeAgeToDate(undefined, now)).toBeNull();
  });
});

import { isAiTrainingGig } from "../src/filters/gig.js";

describe("isAiTrainingGig", () => {
  it("flags AI-training / labeling gig listings", () => {
    expect(isAiTrainingGig("ML Engineer – Remote (Worldwide)", "We are looking for experts to contribute to an AI training project involving model development")).toBe(true);
    expect(isAiTrainingGig("AI Trainer (Engineering Sciences)", "")).toBe(true);
  });
  it("keeps real AI-engineering roles that merely mention RLHF / annotation", () => {
    expect(isAiTrainingGig("Senior ML Engineer", "experience with RLHF pipelines and data annotation tooling is a plus")).toBe(false);
    expect(isAiTrainingGig("Applied Scientist", "you will train large language models at scale")).toBe(false);
  });
});
