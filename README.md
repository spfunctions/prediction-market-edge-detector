# prediction-market-edge-detector

[![npm](https://img.shields.io/npm/v/prediction-market-edge-detector)](https://www.npmjs.com/package/prediction-market-edge-detector)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Detect, filter, rank, and summarize **actionable mispricings** in prediction
markets. Each edge is a market where SimpleFunctions' causal model disagrees
with the live market price by enough cents to be worth trading. Zero
dependencies. Read-only, no auth.

```ts
import { getEdges, filterEdges, rankByExpectedValue } from 'prediction-market-edge-detector'

const edges = await getEdges()
const tradeable = filterEdges(edges, {
  minEdge: 10,                  // ≥ 10c executable edge
  minConfidence: 0.7,           // ≥ 70% confidence
  liquidity: ['high', 'medium'],
  maxAge: 24,                   // discovered in the last day
})
const top3 = rankByExpectedValue(tradeable).slice(0, 3)
```

---

## Why?

The raw `/api/edges` feed is a firehose — dozens of mispricings, half of them
already absorbed by the market, half of them in markets with no real liquidity.
This library is a small set of pure functions for the things you actually want
to do with that feed: drop the noise, sort what's left, and turn the top result
into a one-line Slack summary.

## Install

```bash
npm install prediction-market-edge-detector
```

Zero dependencies. ESM and CJS, full TypeScript types.

## API

### Fetch

#### `getEdges(): Promise<Edge[]>`

Fetch the live edges array from `/api/edges`. Returns `[]` if the response has
no `edges` field. Throws on non-2xx.

#### `getEdgesResponse(): Promise<EdgesResponse>`

Same fetch, but returns the full envelope including `totalEdges` and
`thesesScanned` counts.

```ts
interface EdgesResponse {
  priceUnit: string         // 'cents'
  edges: Edge[]
  totalEdges: number
  thesesScanned: number
}
```

#### `getEdgesSummary(): Promise<string>`

Compact one-line summary suitable for chat / Slack.

```
3 actionable edges. Top: Will Brent close > $90? (15c edge, high liq, 4h old)
```

### Filter

#### `filterEdges(edges, opts): Edge[]`

Pure. Apply zero or more of these filters in any combination:

```ts
interface FilterOptions {
  minEdge?: number          // executableEdge ≥ this (cents)
  minConfidence?: number    // confidence ≥ this (0-1)
  maxAge?: number           // edgeAgeHours ≤ this
  liquidity?: string[]      // allow-list of buckets
  direction?: 'yes' | 'no'
  venues?: string[]         // allow-list of venue strings
  maxAbsorption?: number    // marketAbsorption ≤ this (0-1)
}
```

### Rank

All ranking helpers are pure and **do not mutate** the input. They return a
new sorted array (descending).

#### `rankByExpectedValue(edges): Edge[]`

Sort by `executableEdge × confidence × (1 − marketAbsorption)`. The default
"what should I trade now" ranking.

#### `rankByUrgency(edges): Edge[]`

Same as EV but multiplied by `1 / max(1, edgeAgeHours)` — bumps fresh edges
to the top. Use for "act on this in the next hour" lists.

#### `rankByLiquidityAdjustedEV(edges): Edge[]`

EV multiplied by a liquidity weight (`high=1.0`, `medium=0.7`, `low=0.4`,
unknown=0.5) — penalizes thin markets. Use for production-size positions.

### Group

#### `groupByVenue(edges): Record<string, Edge[]>`

Bucket edges by `venue` field for side-by-side Kalshi vs Polymarket views.

#### `groupByDirection(edges): Record<string, Edge[]>`

Bucket edges by `direction` (`yes` / `no`).

### Edge type

```ts
interface Edge {
  ticker: string
  venue: 'kalshi' | 'polymarket' | string
  title: string
  status: string
  marketPrice: number       // cents (0-100)
  thesisPrice: number       // cents (0-100)
  edge: number              // |thesisPrice - marketPrice|
  executableEdge: number    // edge after spread/fee assumptions
  direction: 'yes' | 'no' | string
  confidence: number        // 0-1
  liquidityScore: 'high' | 'medium' | 'low' | string
  spread: number            // cents
  reasoning: string
  edgeAgeHours: number | null
  marketAbsorption: number | null
}
```

## Example: a daily Slack post

```ts
import {
  getEdges,
  filterEdges,
  rankByLiquidityAdjustedEV,
} from 'prediction-market-edge-detector'

const edges = await getEdges()
const top = rankByLiquidityAdjustedEV(
  filterEdges(edges, {
    minEdge: 8,
    minConfidence: 0.6,
    liquidity: ['high', 'medium'],
    maxAge: 12,
  }),
).slice(0, 5)

const msg = top
  .map(
    (e) =>
      `• *${e.title}* — ${e.executableEdge}c edge, ${e.direction}, ${e.liquidityScore} liq\n  ${e.reasoning}`,
  )
  .join('\n\n')

await postToSlack(`Today's top 5 edges:\n\n${msg}`)
```

## Sister packages

| Need | Package |
|------|---------|
| Single uncertainty number | [`prediction-market-uncertainty`](https://github.com/spfunctions/prediction-market-uncertainty) |
| Labeled regime state | [`prediction-market-regime`](https://github.com/spfunctions/prediction-market-regime) |
| Full world snapshot | [`agent-world-awareness`](https://github.com/spfunctions/agent-world-awareness), [`prediction-market-context`](https://github.com/spfunctions/prediction-market-context) |
| Decompose a thesis into a causal tree | [`causal-tree-decomposition`](https://github.com/spfunctions/causal-tree-decomposition) |
| Use inside an LLM agent | [`langchain-prediction-markets`](https://github.com/spfunctions/langchain-prediction-markets), [`vercel-ai-prediction-markets`](https://github.com/spfunctions/vercel-ai-prediction-markets), [`openai-agents-prediction-markets`](https://github.com/spfunctions/openai-agents-prediction-markets), [`crewai-prediction-markets`](https://github.com/spfunctions/crewai-prediction-markets) |
| MCP / Claude / Cursor | [`simplefunctions-cli`](https://github.com/spfunctions/simplefunctions-cli) |

## Testing

```bash
npm test
```

23 tests, all `fetch`-mocked — no network required. Covers fetch + envelope
defaults, every filter option in isolation and in composition, all three
ranking strategies, grouping helpers, summary edge cases, and the input
non-mutation invariants.

## License

MIT — built by [SimpleFunctions](https://simplefunctions.dev).
