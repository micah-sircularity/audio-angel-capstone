"""LLM-judge rubric for the flagging eval and the judge tests.

The judge sees the case inputs (transcript lines + rules), the agent's flags
and the hand-labeled expected flags. Deterministic precision/recall in
evals/metrics.py is the primary score; the judge catches what exact matching
cannot (right line, wrong-but-acceptable word span; defensible borderline
calls the labeler did not mark).
"""

JUDGE_RUBRIC = """\
You are grading a content filter for a family listening app.

You get: transcript lines with indices, the mute rules, the filter's output
flags, and the expected flags a human labeled for this track.

Grade the output against the expected flags:
- PASS when every expected flag has a matching output flag (same line_index
  and rule_id) AND every extra output flag is a defensible reading of the
  rule for that exact line.
- A matching flag still counts as correct when its muted words differ from
  the expected words only by covering the same offending term in another
  form (plural, censored spelling, split into two words).
- FAIL when any expected flag is missing, when an extra flag mutes a line
  that clearly does not break its rule, or when the muted words miss the
  offending term entirely (for example muting "you" instead of the swear word).

Judge strictly by the rules as written, not by your own content preferences.
In the reason, name the first missing or wrong flag by line index.
"""

JUDGE_SCORE_RUBRIC = """\
Score from 0 to 1 how well the filter's flags match the expected flags for
this track, using the same standards as the pass/fail rubric: 1.0 means all
expected flags found with correct word spans and no indefensible extras;
subtract for each missing flag more than for each defensible extra.
"""
