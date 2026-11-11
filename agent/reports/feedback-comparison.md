# Feedback improvement comparison

Both prompts use identical corrected human labels and per-line lexicon evidence.
This small development set informed v4; these are not held-out accuracy estimates.
Judge ratings are secondary opinions; inspect their explanations and human-label conflicts.

| prompt | precision | recall | micro F1 | macro F1 | word recall | judge pass | judge score | failed | judge errors |
|---|---|---|---|---|---|---|---|---|---|
| v3 | 0.465 | 0.839 | 0.599 | 0.590 | 0.972 | 0.600 | 0.790 | 0 | 0 |
| v4 | 0.592 | 0.804 | 0.682 | 0.654 | 0.921 | 0.600 | 0.753 | 0 | 0 |
