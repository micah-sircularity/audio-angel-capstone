/**
 * Jev decision-model question definitions. Every flag category and every
 * user topic becomes one `noul` (probability) question per transcript
 * segment. Keep the wording in sync with the client-side planner in
 * packages/filters/src/audio-plan.ts.
 */

export const CATEGORY_KEYS = [
  "profanity",
  "slurs",
  "sexual",
  "drugs",
  "violence",
  "blasphemy",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_KEY_SET: ReadonlySet<string> = new Set(CATEGORY_KEYS);

/** A Decisions API question. `noul` answers are 0..1 probabilities. */
export type DecisionQuestion = {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
};

const CRITERIA = {
  true: "The line itself clearly meets the description; judge only the line, not the surrounding context.",
  false:
    "The line does not meet the description; treat it as safe even if nearby lines do.",
} as const;

const CATEGORY_INSTRUCTIONS: Record<CategoryKey, string> = {
  profanity:
    "Does the line contain profanity — swear words, cussing or vulgar exclamations, including euphemistic misspellings like 'fck' or 'sh!t'?",
  slurs:
    "Does the line contain a slur — a derogatory term targeting race, ethnicity, religion, sex, sexual orientation, gender identity or disability, including reclaimed or casual use?",
  sexual:
    "Does the line contain explicit sexual content — sexual acts or sexual body parts described explicitly?",
  drugs:
    "Does the line reference illegal or recreational drug use — using, selling or clearly glorifying drugs, or drug-use slang?",
  violence:
    "Does the line describe graphic violence — killing, torture, gore or physical brutality in detail?",
  blasphemy:
    "Does the line use blasphemy — a god or sacred name used as profanity, for example 'goddamn' or 'Jesus Christ' as a curse?",
};

/** One noul question per flag category, keyed by category name. */
export function categoryQuestions(): Record<CategoryKey, DecisionQuestion> {
  const entries = CATEGORY_KEYS.map((key) => [
    key,
    { type: "noul" as const, instructions: CATEGORY_INSTRUCTIONS[key], criteria: CRITERIA },
  ]);
  return Object.fromEntries(entries) as Record<CategoryKey, DecisionQuestion>;
}

/** Normalizes a user topic: trim, collapse whitespace, cap at 80 chars. */
export function normalizeTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, " ").slice(0, 80);
}

/** The question-key used for caching a topic's decisions. */
export function topicQuestionKey(topic: string): string {
  return `topic:${normalizeTopic(topic)}`;
}

/** A noul question for a free-form user topic. */
export function topicQuestion(topic: string): DecisionQuestion {
  const normalized = normalizeTopic(topic);
  return {
    type: "noul",
    instructions: `Does the line mention, discuss or joke about the topic "${normalized}"?`,
    criteria: CRITERIA,
  };
}

/** Resolves a questionKey back to its question object. */
export function questionForKey(questionKey: string): DecisionQuestion | null {
  if ((CATEGORY_KEY_SET as ReadonlySet<string>).has(questionKey)) {
    return categoryQuestions()[questionKey as CategoryKey];
  }
  if (questionKey.startsWith("topic:")) {
    const topic = normalizeTopic(questionKey.slice("topic:".length));
    return topic ? topicQuestion(topic) : null;
  }
  return null;
}
