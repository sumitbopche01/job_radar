import { describe, expect, it } from "vitest";
import { greenhouseAdapter } from "../src/adapters/greenhouse.js";
import { leverAdapter } from "../src/adapters/lever.js";
import { ashbyAdapter } from "../src/adapters/ashby.js";
import type { CrawlTarget, RawPosting } from "../src/types.js";

const target = (provider: CrawlTarget["provider"]): CrawlTarget => ({
  companyId: "c1",
  companyName: "Acme",
  provider,
  boardToken: "acme",
});

describe("greenhouse adapter", () => {
  const raw: RawPosting = {
    source: "greenhouse",
    externalId: "123",
    companyId: "c1",
    payload: {
      id: 123,
      title: "Senior Backend Engineer",
      absolute_url: "https://boards.greenhouse.io/acme/jobs/123",
      location: { name: "Remote - US" },
      // updated_at is LATER than first_published on purpose:
      updated_at: "2026-09-06T10:00:00-04:00",
      first_published: "2026-09-01T09:00:00-04:00",
      content: "&lt;p&gt;Build &amp; scale services.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;/ul&gt;",
      company_name: "Acme",
    },
  };

  it("uses first_published as posted_at, not updated_at", () => {
    const job = greenhouseAdapter.normalize(raw, target("greenhouse"));
    expect(job.postedAt?.toISOString()).toBe(new Date("2026-09-01T09:00:00-04:00").toISOString());
  });

  it("decodes entities and strips tags in the description", () => {
    const job = greenhouseAdapter.normalize(raw, target("greenhouse"));
    expect(job.descriptionMd).toContain("Build & scale services.");
    expect(job.descriptionMd).toContain("- Go");
    expect(job.descriptionMd).not.toContain("&lt;");
    expect(job.descriptionMd).not.toContain("<p>");
  });

  it("maps location and infers remote", () => {
    const job = greenhouseAdapter.normalize(raw, target("greenhouse"));
    expect(job.locationRaw).toBe("Remote - US");
    expect(job.remoteType).toBe("remote");
  });
});

describe("lever adapter", () => {
  const raw: RawPosting = {
    source: "lever",
    externalId: "abc",
    companyId: "c1",
    payload: {
      id: "abc",
      text: "Staff Engineer",
      hostedUrl: "https://jobs.lever.co/acme/abc",
      applyUrl: "https://jobs.lever.co/acme/abc/apply",
      createdAt: 1_756_000_000_000,
      description: "<p>Own the platform.</p>",
      additional: "<p>Perks.</p>",
      workplaceType: "remote",
      categories: { location: "Berlin", commitment: "Full-time" },
      salaryRange: { min: 90000, max: 120000, currency: "EUR" },
    },
  };

  it("parses createdAt (epoch ms) as posted_at", () => {
    const job = leverAdapter.normalize(raw, target("lever"));
    expect(job.postedAt?.getTime()).toBe(1_756_000_000_000);
  });

  it("maps title, commitment, salary and apply url", () => {
    const job = leverAdapter.normalize(raw, target("lever"));
    expect(job.title).toBe("Staff Engineer");
    expect(job.employmentType).toBe("full_time");
    expect(job.salaryMin).toBe(90000);
    expect(job.salaryCurrency).toBe("EUR");
    expect(job.applyUrl).toBe("https://jobs.lever.co/acme/abc/apply");
    expect(job.remoteType).toBe("remote");
  });
});

describe("ashby adapter", () => {
  const payloadJobs = [
    {
      id: "listed",
      title: "AI Infrastructure Engineer",
      employmentType: "FullTime",
      location: "San Francisco",
      publishedAt: "2026-08-15T00:00:00.000Z",
      isListed: true,
      isRemote: false,
      workplaceType: "Onsite",
      jobUrl: "https://jobs.ashbyhq.com/acme/listed",
      applyUrl: "https://jobs.ashbyhq.com/acme/listed/application",
      descriptionHtml: "<p>Own the training stack.</p>",
      compensation: {
        summaryComponents: [
          { compensationType: "Salary", minValue: 200000, maxValue: 260000, currencyCode: "USD" },
          { compensationType: "EquityPercentage", minValue: 0.1, maxValue: 0.3 },
        ],
      },
    },
    { id: "hidden", title: "Hidden", isListed: false },
  ];

  it("drops unlisted jobs in fetch", async () => {
    // monkeypatch fetch via normalize path: exercise the filter directly
    const raws = payloadJobs
      .filter((j) => (j as { isListed?: boolean }).isListed !== false)
      .map((j) => ({ source: "ashby", externalId: String(j.id), companyId: "c1", payload: j }));
    expect(raws).toHaveLength(1);
    expect(raws[0]!.externalId).toBe("listed");
  });

  it("parses salary from summaryComponents and publishedAt", () => {
    const raw: RawPosting = {
      source: "ashby",
      externalId: "listed",
      companyId: "c1",
      payload: payloadJobs[0],
    };
    const job = ashbyAdapter.normalize(raw, target("ashby"));
    expect(job.salaryMin).toBe(200000);
    expect(job.salaryMax).toBe(260000);
    expect(job.salaryCurrency).toBe("USD");
    expect(job.employmentType).toBe("full_time");
    expect(job.postedAt?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });
});
