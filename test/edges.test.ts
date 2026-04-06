import { describe, it, expect } from 'vitest'
import { getEdges, filterEdges, rankByExpectedValue } from '../src/index.js'
describe('edge-detector', () => {
  it('fetches edges', async () => {
    const edges = await getEdges()
    expect(Array.isArray(edges)).toBe(true)
  }, 15000)
  it('filters edges', () => {
    const edges = [
      { executableEdge: 20, confidence: 0.8, liquidityScore: 'high', direction: 'yes', venue: 'kalshi', edgeAgeHours: 5, marketAbsorption: 0.1 },
      { executableEdge: 5, confidence: 0.3, liquidityScore: 'low', direction: 'no', venue: 'polymarket', edgeAgeHours: 100, marketAbsorption: 0.8 },
    ] as any
    const filtered = filterEdges(edges, { minEdge: 10 })
    expect(filtered).toHaveLength(1)
  })
})
