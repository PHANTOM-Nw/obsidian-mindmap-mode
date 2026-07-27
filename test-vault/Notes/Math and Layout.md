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

## Blocks worth expanding

These are body cards, not nodes. The card shows a clipped, inline-only preview;
the ⤢ button in its corner is the only place they render properly.

A display formula on its own lines, which the card cannot centre:

$$
\begin{aligned}
\nabla_\theta J(\theta) &= \mathbb{E}_{\tau \sim \pi_\theta}
	\left[ \sum_{t=0}^{T} \nabla_\theta \log \pi_\theta(a_t \mid s_t) \, R(\tau) \right] \\
	&\approx \frac{1}{N} \sum_{i=1}^{N} \sum_{t=0}^{T}
	\nabla_\theta \log \pi_\theta(a_t^i \mid s_t^i) \, \hat{A}_t^i
\end{aligned}
$$

A table, which the card draws as flat monospace text:

| Symbol | Meaning | Typical value |
| --- | --- | --- |
| $\lambda$ | learning rate | $3 \times 10^{-4}$ |
| $\gamma$ | discount | $0.99$ |
| $\epsilon$ | clip range | $0.2$ |

A fenced block, where the card renders no math and no highlighting at all —
note that `$x$` below must stay literal in both the card and the dialog:

```python
def advantage(rewards, values, gamma=0.99, lam=0.95):
    """GAE-lambda. The $x$ here is not a formula."""
    out, running = [], 0.0
    for t in reversed(range(len(rewards))):
        delta = rewards[t] + gamma * values[t + 1] - values[t]
        running = delta + gamma * lam * running
        out.append(running)
    return out[::-1]
```

> [!note] A callout
> Callouts are body content too, and only the dialog knows what one looks like.

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
