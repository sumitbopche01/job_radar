import { describe, expect, it } from "vitest";
import { detectLanguageRequirement } from "../src/filters/language.js";

describe("detectLanguageRequirement", () => {
  it("flags a hard native/fluent requirement", () => {
    // real Celonis phrasing that prompted this filter
    expect(detectLanguageRequirement("Native-level German proficiency is required.")).toBe("german");
    expect(detectLanguageRequirement("You must be fluent in French (written and spoken).")).toBe("french");
    expect(detectLanguageRequirement("Fluent Dutch and English required.")).toBe("dutch");
    expect(detectLanguageRequirement("Mother tongue Spanish, professional English.")).toBe("spanish");
    expect(detectLanguageRequirement("Japanese language skills are mandatory.")).toBe("japanese");
  });

  it("keeps roles where the language is optional or just mentioned", () => {
    expect(detectLanguageRequirement("German is a plus but not required.")).toBeNull();
    expect(detectLanguageRequirement("Join our Berlin office and German-speaking team.")).toBeNull();
    expect(detectLanguageRequirement("Nice to have: conversational Spanish.")).toBeNull();
  });

  it("never disqualifies English or an empty description", () => {
    expect(detectLanguageRequirement("Fluent English is required.")).toBeNull();
    expect(detectLanguageRequirement("Native English speaker preferred.")).toBeNull();
    expect(detectLanguageRequirement("")).toBeNull();
    expect(detectLanguageRequirement(null)).toBeNull();
  });
});
