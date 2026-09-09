import { describe, expect, it } from "vitest";
import { oracleAdapter } from "../src/adapters/oracle.js";
import type { CrawlTarget, RawPosting } from "../src/types.js";

const target: CrawlTarget = {
  companyId: "c1",
  companyName: "Presight",
  provider: "oracle",
  boardToken: null,
  workdayTenant: "iaambv.fa.ocs.oraclecloud.com",
  workdaySite: "CX_1|Presight-Careers",
};

describe("oracle adapter", () => {
  const raw: RawPosting = {
    source: "oracle",
    externalId: "2986",
    companyId: "c1",
    payload: {
      Id: "2986",
      Title: "Engineer - Full Stack",
      PostedDate: "2026-05-13",
      PrimaryLocation: "Dubai, United Arab Emirates",
      WorkplaceType: "Remote",
      JobSchedule: "Full time",
      ShortDescriptionStr: "<p>Build the platform.</p>",
    },
  };

  it("maps title, location, date, employment and remote", () => {
    const job = oracleAdapter.normalize(raw, target);
    expect(job.title).toBe("Engineer - Full Stack");
    expect(job.locationRaw).toBe("Dubai, United Arab Emirates");
    expect(job.postedAt?.toISOString().slice(0, 10)).toBe("2026-05-13");
    expect(job.remoteType).toBe("remote");
    expect(job.employmentType).toBe("full_time");
    expect(job.descriptionMd).toContain("Build the platform.");
  });

  it("builds the candidate-experience apply URL from host + site name", () => {
    const job = oracleAdapter.normalize(raw, target);
    expect(job.applyUrl).toBe(
      "https://iaambv.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Presight-Careers/job/2986",
    );
  });
});
