/**
 * Deterministic outreach links (design §10/§16). Applying isn't enough — you reach
 * the decision-maker directly. We DON'T scrape LinkedIn (ban risk, design §3);
 * instead we build targeted people-search links that open in the user's own logged-in
 * LinkedIn, plus a Google fallback. Zero cost, zero risk. The research agent (A2)
 * layers actual names on top when it runs.
 */

export interface OutreachLink {
  label: string;
  url: string;
}

function li(keywords: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

export function outreachLinks(company: string, title: string): OutreachLink[] {
  const c = company.trim();
  // derive a coarse discipline from the title to target the right manager
  const t = title.toLowerCase();
  const discipline = /data|ml|ai|machine learning/.test(t)
    ? "AI"
    : /front|full.?stack|web/.test(t)
      ? "Frontend"
      : /platform|infra|backend|devops/.test(t)
        ? "Platform"
        : "Engineering";

  return [
    { label: "Hiring manager", url: li(`${c} ${discipline} engineering manager`) },
    { label: "Eng leadership", url: li(`${c} Head of Engineering VP Engineering CTO`) },
    { label: "Recruiter", url: li(`${c} technical recruiter talent acquisition`) },
    { label: "Team members", url: li(`${c} ${title}`) },
    {
      label: "Google (LinkedIn profiles)",
      url: `https://www.google.com/search?q=${encodeURIComponent(
        `"${c}" (hiring manager OR "engineering manager" OR CTO) site:linkedin.com/in`,
      )}`,
    },
  ];
}
