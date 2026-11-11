# Feedback applied to the flagging agent

## Evidence reviewed

Human notes in `evals/data/ground_truth/*.json`, predictions and judge reasons
from `eval-20261111-145119.json`, and provider failures from subsequent reruns.
No model training or reinforcement learning was performed. These changes alter
agent instructions, evidence coverage, and the evaluation answer key.

## Corrections to the answer key

- `aud:OG1aKGX`, line 2: removed the slur flag. The saved note already rejected
  it, and the user explicitly confirmed that correction in chat.
- `aud:V0dr43P`, line 8: removed profanity on “pit”, as the human note requested.
- `aud:7945Qk9`, line 46: added sexual content on “titties”, explicitly identified
  in the human note. Lines 57 and 71 mentioned in that note were already labeled.
- `aud:5Ba63XY`, line 7: added sexual content on “Sex”, “excess”, and “flesh”,
  following the human note about the passage at 0:55. Existing labels remain.

Neither prompt is evaluated against the superseded labels in the paired run.
Human notes remain unchanged for provenance.

## Agent changes

- Added version v4; published v1–v3 instructions are unchanged.
- Scan each line completely and collect every offending occurrence. The judge
  specifically identified a missing “ass” next to an already selected “balls”.
- Check each rule independently instead of substituting one category for another.
  Judge feedback identified slur/profanity and profanity/blasphemy mismatches.
- Do not infer obscenities from ordinary words or repair unintelligible lyrics
  into offensive ones. The judge rejected a profanity flag on literal “hole”.
- Require contextual evidence for drug/sexual senses of ambiguous words; use
  tools for specific uncertainty rather than repeated obvious-word lookups.
- Check custom rules across repeated refrains; feedback identified a missed
  repetition of the same custom-rule content.
- Cap lexicon evidence per line instead of per batch, preventing a dense early
  line from hiding evidence for later lines. This shared fix applies to both
  versions in the paired comparison, so that comparison isolates prompt choice.

## Unresolved policy/label questions

These remain unchanged rather than being silently converted into agent policy:

- The sexual rule says explicit acts/body parts; notes request stricter treatment
  of “sexy” and “Let go of your inhibitions”. A broader optional listener rule
  would express that preference more clearly.
- `aud:PgwGXNX` says nothing to mute but its transcript contains “asshole”.
  Listen to the source to distinguish an ASR error from an incomplete label.
- `aud:5Ba63XY` labels “head” as profanity. The judge enforces the label but that
  does not independently establish the category is correct.
- A bare “guns” flag under graphic violence may be broader than the written
  definition requiring detailed brutality.
- Drug-reference timestamps in a note do not intersect the snapshotted timed
  segments exactly. They need listening review rather than guessed word labels.

## Validation

`uv run python evals/improve.py` compares v3 and v4 on all 15 corrected cases,
serially, with both deterministic metrics and judge feedback. It saves each
configuration before proceeding. Results are development-set evidence: these
tracks and notes informed the changes. A new independently labeled set is
required for a generalization claim. Provider failures and judge errors remain
visible and must be considered before adopting the candidate.
