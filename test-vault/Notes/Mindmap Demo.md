---
tags: [demo, mindmap]
status: draft
---

# Mindmap Mode

This paragraph belongs to the root node. It stays exactly where it is in the
file — the map shows it as a `≡` badge instead of a card.

## Goals

- Toggle a note into a mind map in the **same tab**
	- No new files, ever
	- Round-trips back to markdown untouched
- Edit structure directly on the canvas
	- [x] rename in place
	- [ ] drag to reparent
	- [ ] fold deep branches

## Architecture

The mutation engine only ever splices line ranges, so untouched lines stay
byte-identical.

```js
// These lines must NOT become nodes:
// # not a heading
// - not a list item
function parse(md) {
  return md.split("\n");
}
```

### Parser

- Skips frontmatter
- Immune to fenced code
- Tracks heading and list stacks

### Renderer

| Layer | Tech |
| --- | --- |
| nodes | absolutely positioned HTML |
| edges | SVG cubic bezier |

## Risks

1. Corrupting notes
2. Layout performance on huge files
