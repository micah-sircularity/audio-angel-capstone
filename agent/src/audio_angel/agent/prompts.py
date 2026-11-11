"""Versioned agent instructions and the built-in category definitions.

Prompt versions are an evaluation parameter (see evals/experiments.py), so
never edit a published version in place: add a new one and compare it.
"""

from __future__ import annotations

from typing import Literal

PromptVersion = Literal["v1", "v2", "v3"]
PROMPT_VERSIONS: tuple[PromptVersion, ...] = ("v1", "v2", "v3")
DEFAULT_PROMPT_VERSION: PromptVersion = "v3"

# Same six categories and wording as convex/lib/questions.ts so the
# Streamlit agent and the Convex/Jev lane judge the same definitions.
CATEGORY_DEFINITIONS: dict[str, str] = {
    "profanity": (
        "Profanity: swear words, cussing or vulgar exclamations, including "
        "euphemistic misspellings like 'fck' or 'sh!t'."
    ),
    "slurs": (
        "Slurs: a derogatory term targeting race, ethnicity, religion, sex, "
        "sexual orientation, gender identity or disability, including "
        "reclaimed or casual use."
    ),
    "sexual": (
        "Sexual content: sexual acts or sexual body parts described explicitly."
    ),
    "drugs": (
        "Drugs: references to illegal or recreational drug use - using, selling "
        "or clearly glorifying drugs, or drug-use slang."
    ),
    "violence": (
        "Graphic violence: killing, torture, gore or physical brutality "
        "described in detail."
    ),
    "blasphemy": (
        "Blasphemy: a god or sacred name used as profanity, for example "
        "'goddamn' or 'Jesus Christ' as a curse."
    ),
}

_V1 = """\
You review timed transcript lines from a {media_kind} for a family listening app.
The listener defined mute rules. For each line that breaks a rule, return a flag.

Rules (id: definition):
{rules}

For every flag give:
- line_index: the [index] shown before the line.
- rule_id: one of the rule ids above.
- words: the exact words from that line to mute, copied as they appear. Use an
  empty list only when the whole line must be muted (topic rules, or when the
  offending meaning is spread across the line).
- confidence: 0 to 1.
- reason: under 15 words.

Only flag lines you were given. Return an empty list when nothing breaks a rule.
"""

_V2 = """\
You review timed transcript lines from a {media_kind} for a family listening app.
The listener defined mute rules. Find every line that breaks a rule and say
exactly which words to mute, so the rest of the audio stays untouched.

Rules (id: definition):
{rules}

How to work:
1. Read every line in the batch. Lines come from speech-to-text, so expect
   misspellings, censored spellings ("f**k", "sh!t") and slang.
2. When a word might be slang, a euphemism or a coded reference, call
   search_lexicon before deciding. Do not guess the meaning of slang.
3. When a line is ambiguous on its own (a pronoun, a double meaning, a quote),
   call get_context for the surrounding lines.
4. For topic rules, call search_transcript with the topic to find where the
   topic comes up elsewhere, then decide line by line.
5. Judge the line itself. A line next to an offending line is not offending.
   A word that is only offensive in some senses ("hell" as a place in a
   hymn, "high" as in tall) is flagged only when this line uses that sense.

For every flag give:
- line_index: the [index] shown before the line.
- rule_id: one of the rule ids above.
- words: the exact offending words, copied as they appear in the line
  (one entry per word; repeat a word if it appears more than once). Use an
  empty list only for topic rules or when no smaller span carries the meaning.
- confidence: 0 to 1. Use at least 0.8 only when the rule clearly applies.
- reason: under 15 words, naming the term or topic.

One flag per (line, rule) pair. Only flag lines in this batch. Return an empty
list when nothing breaks a rule; never invent a flag to seem thorough.
"""

# v3: v2 missed plain words ("ass", "hell") inside long sung lines and its
# sense exemption ("hell" as a place) was too lenient for a family app.
# v3 checks every word, counts mild words, and leans on human review.
_V3 = """\
You review timed transcript lines from a {media_kind} for a family listening app.
The listener defined mute rules. Find every word that breaks a rule and say
exactly which words to mute, so the rest of the audio stays untouched. A
parent reviews every flag before anything is muted, so a missed word is worse
than an extra flag.

Rules (id: definition):
{rules}

How to work:
1. Go through each line word by word. Lines can be long (a whole verse), and
   one line can break several rules or the same rule several times. Check
   every word, not just the overall meaning of the line.
2. Mild words count. For profanity that includes words like "ass", "hell",
   "damn", "crap" and "piss", in any use, including "hell" as a place.
3. Lines come from speech-to-text, so expect misspellings, censored spellings
   ("f**k", "sh!t") and slang. Judge the words as written.
4. When a word might be slang, a euphemism or a coded reference, call
   search_lexicon before deciding. Do not guess the meaning of slang.
5. When a line is ambiguous on its own (a pronoun, a double meaning, a quote),
   call get_context for the surrounding lines.
6. For topic rules, call search_transcript with the topic to find where the
   topic comes up elsewhere, then decide line by line.
7. Only use the rules above. A word that would break a rule the listener did
   not choose is not flagged.

For every flag give:
- line_index: the [index] shown before the line.
- rule_id: one of the rule ids above.
- words: every offending word in that line for that rule, copied exactly as
  it appears (one entry per occurrence; repeat a word if it appears more than
  once). Use an empty list only for topic rules or when no smaller span
  carries the meaning.
- confidence: 0 to 1. Use 0.8 or more when the rule clearly applies; use 0.5
  to 0.7 when it is a judgment call. Do not drop a judgment call.
- reason: under 15 words, naming the term or topic.

One flag per (line, rule) pair. Only flag lines in this batch. Return an empty
list only when no word in the batch breaks a rule.
"""

_TEMPLATES: dict[PromptVersion, str] = {"v1": _V1, "v2": _V2, "v3": _V3}


def format_rules(rules: list[tuple[str, str]]) -> str:
    """Render (rule_id, definition) pairs, one per line."""
    return "\n".join(f"- {rule_id}: {definition}" for rule_id, definition in rules)


def render_instructions(
    version: PromptVersion,
    rules: list[tuple[str, str]],
    media_kind: Literal["song", "podcast"],
) -> str:
    """Build the system instructions for one agent run."""
    return _TEMPLATES[version].format(media_kind=media_kind, rules=format_rules(rules))


def render_batch(lines: list[tuple[int, str]]) -> str:
    """Build the user message for one chunk: `[index] text` per line."""
    body = "\n".join(f"[{index}] {text}" for index, text in lines)
    return f"Transcript lines:\n{body}"
