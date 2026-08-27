// A pattern-based rule (strip_prefix, strip_suffix, dedupe_repeat) only
// gets auto-applied once the SAME pattern has been confirmed this many
// times, across different specific raw values — not from a single Pick.
// One example could be a fluke; three independent confirmations of the
// same structural noise shape is real evidence. Exact-pair memorization
// (type: 'exact') is NOT subject to this — remembering one literal
// string and reusing it for that exact same string again carries no
// generalization risk, so it applies immediately.
export const MIN_PATTERN_EVIDENCE = 3;