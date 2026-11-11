import { describe, expect, it } from "vitest";
import {
  CATEGORY_KEYS,
  categoryQuestions,
  normalizeTopic,
  questionForKey,
  topicQuestion,
  topicQuestionKey,
} from "./questions";

describe("categoryQuestions", () => {
  it("returns one noul question per category", () => {
    const questions = categoryQuestions();
    expect(Object.keys(questions).sort()).toEqual([...CATEGORY_KEYS].sort());
    for (const key of CATEGORY_KEYS) {
      expect(questions[key].type).toBe("noul");
      expect(questions[key].instructions).toContain("line");
      expect(questions[key].criteria.true).toContain("judge only the line");
      expect(questions[key].criteria.false).toContain("safe");
    }
  });

  it("uses the settled wording", () => {
    const questions = categoryQuestions();
    expect(questions.profanity.instructions).toBe(
      "Does the line contain profanity — swear words, cussing or vulgar exclamations, including euphemistic misspellings like 'fck' or 'sh!t'?",
    );
    expect(questions.blasphemy.instructions).toContain("goddamn");
    expect(questions.drugs.instructions).toContain("drug-use slang");
  });
});

describe("topic questions", () => {
  it("normalizes whitespace and caps at 80 chars", () => {
    expect(normalizeTopic("  hello\t\n  world  ")).toBe("hello world");
    expect(normalizeTopic("x".repeat(100))).toHaveLength(80);
    expect(topicQuestionKey("  the  80s ")).toBe("topic:the 80s");
    expect(topicQuestionKey("x".repeat(100))).toBe(
      `topic:${"x".repeat(80)}`,
    );
  });

  it("builds a noul question quoting the normalized topic", () => {
    const question = topicQuestion("  my   topic ");
    expect(question.type).toBe("noul");
    expect(question.instructions).toBe(
      'Does the line mention, discuss or joke about the topic "my topic"?',
    );
  });

  it("questionForKey resolves categories, topics and rejects others", () => {
    expect(questionForKey("slurs")?.instructions).toContain("slur");
    expect(questionForKey("topic:bees")?.instructions).toContain('"bees"');
    expect(questionForKey("bogus")).toBeNull();
    expect(questionForKey("topic:")).toBeNull();
  });
});
