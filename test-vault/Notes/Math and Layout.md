# Math and Layout

A scratch note for eyeballing the three things unit tests cannot reach: card
width, the initial fold, and formula rendering.

## Formulas

- 学习率 $\lambda$ 与动量 $\alpha_t$
- Display: $$\sum_{i=1}^{n} x_i$$
- **加粗里的公式 $x$** — the bold wrapper must not swallow the math
- Underscores survive: $a_b$ and $\theta_{i,j}$
- Stars survive: $x*y*z$
- Broken on purpose: $\frac{1}$ — only this card should go red, the rest of the
  map must still paint

## Not formulas

- Costs $5 and $10 per seat
- Range $5-$10
- Escaped: \$5 flat

## Card width

- 这是一个比较长的中文标题，用来确认卡片会横向铺开而不是被压成一列竖排的单字
- A fairly long English title that should also run horizontally and only wrap
  once it reaches the maximum card width
- Short
- https://example.com/a/very/long/unbroken/path/that/has/nowhere/to/wrap/at/all
- [ ] 带复选框的长标题，用来确认 checkbox 和文字仍然对齐

## Folding

- Level one
	- Level two
		- Level three
			- Level four
	- Another level two
- Second branch
	- Child A
	- Child B
		- Grandchild
