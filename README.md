# prediction-market-edge-detector
Detect mispricings in prediction markets. Filter, rank, and monitor edges from 30,000+ markets.

[![npm](https://img.shields.io/npm/v/prediction-market-edge-detector)](https://www.npmjs.com/package/prediction-market-edge-detector)

```ts
import { getEdges, filterEdges, rankByExpectedValue } from 'prediction-market-edge-detector'

const edges = await getEdges()
const good = filterEdges(edges, { minEdge: 10, liquidity: ['high', 'medium'] })
const ranked = rankByExpectedValue(good)
```

## License
MIT — [SimpleFunctions](https://simplefunctions.dev)
