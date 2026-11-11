# Saved flags re-scored on current labels

Raw flags from `eval-20261111-161630.json`, `eval-20261111-163137.json`, `eval-20261111-164052.json`, `eval-20261111-164721.json`, scored against the current `ground_truth/` labels (no new model calls).

| config | threshold | precision | recall | micro F1 | macro F1 | word recall | failed |
|---|---|---|---|---|---|---|---|
| v4 chunk25 tools | 0.3 | 0.605 | 0.807 | 0.692 | 0.720 | 0.929 | 0 |
| v4 chunk25 tools | 0.5 | 0.605 | 0.807 | 0.692 | 0.720 | 0.929 | 0 |
| v4 chunk25 tools | 0.7 | 0.630 | 0.807 | 0.708 | 0.789 | 0.929 | 0 |
| v4 chunk25 tools | 0.8 | 0.631 | 0.719 | 0.672 | 0.706 | 0.925 | 0 |
| v4 chunk10 tools | 0.3 | 0.634 | 0.789 | 0.703 | 0.723 | 0.924 | 0 |
| v4 chunk10 tools | 0.5 | 0.634 | 0.789 | 0.703 | 0.723 | 0.924 | 0 |
| v4 chunk10 tools | 0.7 | 0.634 | 0.789 | 0.703 | 0.723 | 0.924 | 0 |
| v4 chunk10 tools | 0.8 | 0.635 | 0.702 | 0.667 | 0.699 | 0.932 | 0 |
| v4 chunk50 tools | 0.3 | 0.575 | 0.737 | 0.646 | 0.702 | 0.923 | 0 |
| v4 chunk50 tools | 0.5 | 0.575 | 0.737 | 0.646 | 0.702 | 0.923 | 0 |
| v4 chunk50 tools | 0.7 | 0.583 | 0.737 | 0.651 | 0.703 | 0.923 | 0 |
| v4 chunk50 tools | 0.8 | 0.603 | 0.614 | 0.609 | 0.664 | 0.869 | 0 |
| v4 chunk25 no tools | 0.3 | 0.611 | 0.772 | 0.682 | 0.667 | 0.922 | 0 |
| v4 chunk25 no tools | 0.5 | 0.611 | 0.772 | 0.682 | 0.667 | 0.922 | 0 |
| v4 chunk25 no tools | 0.7 | 0.620 | 0.772 | 0.688 | 0.734 | 0.922 | 0 |
| v4 chunk25 no tools | 0.8 | 0.656 | 0.737 | 0.694 | 0.736 | 0.926 | 0 |
