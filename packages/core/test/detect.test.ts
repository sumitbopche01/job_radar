import { describe, expect, it } from "vitest";
import { extractCandidates, extractLinks, guessTokens } from "../src/discovery/detect.js";

describe("extractCandidates", () => {
  it("pulls a greenhouse token from board + api URLs", () => {
    const html = `<a href="https://job-boards.greenhouse.io/vercel">Careers</a>
      <script>fetch("https://boards-api.greenhouse.io/v1/boards/vercel/jobs")</script>`;
    const c = extractCandidates(html);
    expect(c).toContainEqual({ provider: "greenhouse", token: "vercel" });
    // the "v1"/"boards" path segments must not be captured as tokens
    expect(c.find((x) => x.token === "v1")).toBeUndefined();
    expect(c.find((x) => x.token === "boards")).toBeUndefined();
  });

  it("pulls lever and ashby tokens", () => {
    const html = `jobs.lever.co/voleon api.ashbyhq.com/posting-api/job-board/mistral jobs.ashbyhq.com/ramp`;
    const c = extractCandidates(html);
    expect(c).toContainEqual({ provider: "lever", token: "voleon" });
    expect(c).toContainEqual({ provider: "ashby", token: "mistral" });
    expect(c).toContainEqual({ provider: "ashby", token: "ramp" });
  });

  it("dedupes repeated tokens", () => {
    const html = `greenhouse.io/stripe boards.greenhouse.io/stripe boards-api.greenhouse.io/v1/boards/stripe/jobs`;
    const c = extractCandidates(html).filter((x) => x.token === "stripe");
    expect(c).toHaveLength(1);
  });

  it("pulls recruitee / workable / smartrecruiters tokens", () => {
    const html = `
      <iframe src="https://personio.recruitee.com/api/offers/"></iframe>
      <script src="https://apply.workable.com/api/v1/widget/accounts/hostaway"></script>
      <a href="https://jobs.smartrecruiters.com/Ubisoft/12345">Apply</a>`;
    const c = extractCandidates(html);
    expect(c).toContainEqual({ provider: "recruitee", token: "personio" });
    expect(c).toContainEqual({ provider: "workable", token: "hostaway" });
    expect(c).toContainEqual({ provider: "smartrecruiters", token: "Ubisoft" });
    // path segments must not be captured as tokens
    expect(c.find((x) => x.token === "apply" || x.token === "accounts")).toBeUndefined();
  });

  it("ignores non-ATS html", () => {
    expect(extractCandidates("<p>We are hiring! email jobs@acme.com</p>")).toHaveLength(0);
  });
});

describe("guessTokens", () => {
  it("derives the second-level domain as a candidate", () => {
    expect(guessTokens("typeform.com")).toContain("typeform");
    expect(guessTokens("https://www.pipedrive.com/careers")).toContain("pipedrive");
  });

  it("adds an alnum-collapsed variant and a company-name variant", () => {
    const g = guessTokens("back-market.com", "Back Market");
    expect(g).toContain("back-market");
    expect(g).toContain("backmarket");
  });

  it("drops reserved words", () => {
    expect(guessTokens("www.com")).not.toContain("www");
  });
});

describe("extractLinks", () => {
  it("resolves relative careers links and keeps ATS links", () => {
    const html = `<a href="/careers">Jobs</a><a href="https://boards.greenhouse.io/acme">GH</a><a href="/pricing">x</a>`;
    const links = extractLinks(html, "acme.com");
    expect(links).toContain("https://acme.com/careers");
    expect(links).toContain("https://boards.greenhouse.io/acme");
    expect(links.some((l) => l.includes("/pricing"))).toBe(false);
  });
});
