/**
 * Where `$...$` starts and stops.
 *
 * Kept in its own module, free of any import, so the delimiter rules can be
 * unit-tested. Everything that touches MathJax lives in `math.ts`, which pulls
 * in `obsidian` and therefore cannot be reached from `node --test`.
 *
 * Each guard below is earning its keep:
 *
 *   (?<!\\)          an escaped `\$` never opens a formula
 *   (?!\s) (?<!\s)   Pandoc's rule: the body may not start or end on whitespace,
 *                    which is what stops "costs $5 and $10" -- the only closing
 *                    candidate has a space in front of it, and the body may not
 *                    contain a bare `$` to reach further, so the match fails
 *                    outright rather than swallowing the sentence
 *   (?!\d)           stops "$5-$10", where the whitespace rule alone would
 *                    happily read "5-" as math. Stricter than Obsidian's own
 *                    reader; the cost is `$x$2`, which does not happen in map
 *                    titles, and the benefit is that prices stay prices
 *   [^$\\\n] | \\.   lets `\$` and `\lambda` live inside the body while the
 *                    negated class keeps a token from running past a bare `$`
 *
 * Note the deliberate absence of a `(?<!\$)` guard on the opener. It would keep
 * inline math out of `$$...$$`, but it also breaks adjacent formulas `$x$$y$`:
 * the tokenizer rescans from `lastIndex`, so the lookbehind would see the
 * previous token's closing `$`. It is unnecessary anyway -- on `$$x$$` the
 * inline pattern cannot match at index 0 (a body may not open on `$`), so the
 * display pattern wins on position alone.
 */

export const MATH_DISPLAY = /(?<!\\)\$\$((?:[^$\\]|\\[\s\S])+?)\$\$/g;

export const MATH_INLINE = /(?<!\\)\$(?!\s)((?:[^$\\\n]|\\[\s\S])+?)(?<!\s)\$(?!\d)/g;
