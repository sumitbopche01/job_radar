import { describe, expect, it } from "vitest";
import { parseHnComment } from "../src/ingest/hn.js";
import { parseAlertEmail } from "../src/ingest/email.js";

describe("parseHnComment", () => {
  it("parses a pipe-delimited posting", () => {
    const c = {
      id: 42,
      created_at_i: 1_756_000_000,
      text: `Acme AI | Senior Backend Engineer | Remote (India) | Full-time | <a href="https://acme.ai/jobs">https://acme.ai/jobs</a> We build cool stuff.`,
    };
    const p = parseHnComment(c)!;
    expect(p.company).toBe("Acme AI");
    expect(p.title).toBe("Senior Backend Engineer");
    expect(p.location).toBe("Remote (India)");
    expect(p.remoteType).toBe("remote");
    expect(p.applyUrl).toBe("https://acme.ai/jobs");
    expect(p.externalId).toBe("hn-42");
    expect(p.postedAt?.getTime()).toBe(1_756_000_000 * 1000);
  });

  it("falls back to the HN permalink when no URL is present", () => {
    const p = parseHnComment({ id: 7, text: "Beta Co | Platform Engineer | Bengaluru" })!;
    expect(p.applyUrl).toBe("https://news.ycombinator.com/item?id=7");
  });

  it("returns null for a non-structured comment", () => {
    expect(parseHnComment({ id: 1, text: "Great thread, thanks for posting!" })).toBeNull();
    expect(parseHnComment({ id: 2, text: null })).toBeNull();
  });
});

describe("parseAlertEmail", () => {
  const html = `<html><body>
    <a href="https://www.linkedin.com/comm/jobs/view/111/?trk=eml">Backend Engineer</a><br/>Razorpay · Bengaluru, India
    <a href="https://www.linkedin.com/comm/jobs/view/222/?trk=eml">AI Engineer</a><br/>Sarvam AI · Remote (India)
    <a href="https://www.linkedin.com/comm/jobs/view/111/?trk=eml">Backend Engineer</a><br/>dup
  </body></html>`;

  it("detects the provider and extracts each distinct job", () => {
    const ps = parseAlertEmail(html);
    expect(ps).toHaveLength(2); // the duplicate jobId 111 is deduped
    expect(ps[0]).toMatchObject({ title: "Backend Engineer", company: "Razorpay", externalId: "linkedin-111" });
    expect(ps[0]!.applyUrl).toContain("linkedin.com/comm/jobs/view/111");
    expect(ps[1]).toMatchObject({ title: "AI Engineer", company: "Sarvam AI", externalId: "linkedin-222" });
    expect(ps[1]!.remoteType).toBe("remote");
  });

  it("returns nothing for a non-alert email", () => {
    expect(parseAlertEmail("<p>Your account statement is ready.</p>")).toHaveLength(0);
  });
});
