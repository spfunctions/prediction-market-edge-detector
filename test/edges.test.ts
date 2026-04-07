import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  getEdges,
  getEdgesResponse,
  getEdgesSummary,
  filterEdges,
  rankByExpectedValue,
  rankByUrgency,
  rankByLiquidityAdjustedEV,
  groupByVenue,
  groupByDirection,
  sfFetch,
  type Edge,
} from '../src/index.js'

// ── Fixtures ──────────────────────────────────────────────

const HIGH: Edge = {
  ticker: 'KX-HIGH',
  venue: 'kalshi',
  title: 'High-value edge',
  status: 'open',
  marketPrice: 30,
  thesisPrice: 50,
  edge: 20,
  executableEdge: 18,
  direction: 'yes',
  confidence: 0.9,
  liquidityScore: 'high',
  spread: 1,
  reasoning: 'strong thesis',
  edgeAgeHours: 2,
  marketAbsorption: 0.1,
}

const MEDIUM: Edge = {
  ticker: 'KX-MED',
  venue: 'kalshi',
  title: 'Medium edge',
  status: 'open',
  marketPrice: 40,
  thesisPrice: 50,
  edge: 10,
  executableEdge: 9,
  direction: 'no',
  confidence: 0.6,
  liquidityScore: 'medium',
  spread: 2,
  reasoning: '',
  edgeAgeHours: 24,
  marketAbsorption: 0.3,
}

const STALE: Edge = {
  ticker: 'PM-STALE',
  venue: 'polymarket',
  title: 'Stale low-liq edge',
  status: 'open',
  marketPrice: 50,
  thesisPrice: 55,
  edge: 5,
  executableEdge: 3,
  direction: 'yes',
  confidence: 0.4,
  liquidityScore: 'low',
  spread: 5,
  reasoning: '',
  edgeAgeHours: 200,
  marketAbsorption: 0.85,
}

const ALL_EDGES = [HIGH, MEDIUM, STALE]

// ── Helpers ───────────────────────────────────────────────

function mockJsonOnce(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

afterEach(() => vi.restoreAllMocks())

// ── Fetch ─────────────────────────────────────────────────

describe('getEdges / getEdgesResponse', () => {
  it('hits /api/edges and returns the array', async () => {
    const spy = mockJsonOnce({ priceUnit: 'cents', edges: ALL_EDGES, totalEdges: 3, thesesScanned: 12 })
    const edges = await getEdges()
    expect(String(spy.mock.calls[0][0])).toBe('https://simplefunctions.dev/api/edges')
    expect(edges).toHaveLength(3)
  })

  it('returns [] when response has no edges field', async () => {
    mockJsonOnce({ priceUnit: 'cents' })
    expect(await getEdges()).toEqual([])
  })

  it('getEdgesResponse fills defaults for missing counts', async () => {
    mockJsonOnce({ edges: [HIGH] })
    const r = await getEdgesResponse()
    expect(r.edges).toHaveLength(1)
    expect(r.totalEdges).toBe(1)
    expect(r.thesesScanned).toBe(0)
    expect(r.priceUnit).toBe('cents')
  })

  it('throws on non-2xx with status code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } }),
    )
    await expect(getEdges()).rejects.toThrow(/500/)
  })
})

// ── Filter ────────────────────────────────────────────────

describe('filterEdges', () => {
  it('minEdge', () => {
    expect(filterEdges(ALL_EDGES, { minEdge: 10 })).toEqual([HIGH])
  })

  it('minConfidence', () => {
    expect(filterEdges(ALL_EDGES, { minConfidence: 0.7 })).toEqual([HIGH])
  })

  it('maxAge', () => {
    expect(filterEdges(ALL_EDGES, { maxAge: 12 })).toEqual([HIGH])
  })

  it('liquidity bucket allow-list', () => {
    expect(filterEdges(ALL_EDGES, { liquidity: ['high', 'medium'] })).toEqual([HIGH, MEDIUM])
  })

  it('direction', () => {
    expect(filterEdges(ALL_EDGES, { direction: 'no' })).toEqual([MEDIUM])
  })

  it('venues', () => {
    expect(filterEdges(ALL_EDGES, { venues: ['polymarket'] })).toEqual([STALE])
  })

  it('maxAbsorption', () => {
    expect(filterEdges(ALL_EDGES, { maxAbsorption: 0.5 })).toEqual([HIGH, MEDIUM])
  })

  it('compose multiple filters', () => {
    expect(
      filterEdges(ALL_EDGES, { minEdge: 5, minConfidence: 0.5, liquidity: ['high', 'medium'] }),
    ).toEqual([HIGH, MEDIUM])
  })

  it('does not mutate the input array', () => {
    const before = [...ALL_EDGES]
    filterEdges(ALL_EDGES, { minEdge: 100 })
    expect(ALL_EDGES).toEqual(before)
  })
})

// ── Rank ──────────────────────────────────────────────────

describe('rankByExpectedValue', () => {
  it('puts the highest EV first', () => {
    const ranked = rankByExpectedValue(ALL_EDGES)
    expect(ranked[0]).toBe(HIGH)
    expect(ranked.at(-1)).toBe(STALE)
  })

  it('does not mutate the input array', () => {
    const original = [...ALL_EDGES]
    rankByExpectedValue(ALL_EDGES)
    expect(ALL_EDGES).toEqual(original)
  })
})

describe('rankByUrgency', () => {
  it('penalizes age', () => {
    const ranked = rankByUrgency(ALL_EDGES)
    expect(ranked[0]).toBe(HIGH) // 2h old
    expect(ranked.at(-1)).toBe(STALE) // 200h old
  })
})

describe('rankByLiquidityAdjustedEV', () => {
  it('penalizes low-liquidity edges harder than plain EV', () => {
    const ranked = rankByLiquidityAdjustedEV(ALL_EDGES)
    expect(ranked[0]).toBe(HIGH)
    expect(ranked.at(-1)).toBe(STALE)
  })

  it('treats unknown liquidity as 0.5x', () => {
    const weird: Edge = { ...HIGH, ticker: 'KX-WEIRD', liquidityScore: 'unknown' as never }
    const ranked = rankByLiquidityAdjustedEV([HIGH, weird])
    expect(ranked[0]).toBe(HIGH)
  })
})

// ── Grouping ──────────────────────────────────────────────

describe('groupByVenue', () => {
  it('buckets by venue field', () => {
    const grouped = groupByVenue(ALL_EDGES)
    expect(Object.keys(grouped).sort()).toEqual(['kalshi', 'polymarket'])
    expect(grouped.kalshi).toHaveLength(2)
    expect(grouped.polymarket).toHaveLength(1)
  })
})

describe('groupByDirection', () => {
  it('buckets by direction field', () => {
    const grouped = groupByDirection(ALL_EDGES)
    expect(grouped.yes).toHaveLength(2)
    expect(grouped.no).toHaveLength(1)
  })
})

// ── Summary ───────────────────────────────────────────────

describe('getEdgesSummary', () => {
  it('returns "no edges" message when empty', async () => {
    mockJsonOnce({ edges: [] })
    expect(await getEdgesSummary()).toMatch(/No actionable/)
  })

  it('summarizes the top edge by EV', async () => {
    mockJsonOnce({ edges: ALL_EDGES })
    const summary = await getEdgesSummary()
    expect(summary).toContain('3 actionable edges')
    expect(summary).toContain('High-value edge')
    expect(summary).toContain('high liq')
  })
})

// ── sfFetch ───────────────────────────────────────────────

describe('sfFetch', () => {
  it('serializes params into the query string', async () => {
    const spy = mockJsonOnce({})
    await sfFetch('/api/foo', { a: '1', b: '2' })
    const url = String(spy.mock.calls[0][0])
    expect(url).toContain('/api/foo')
    expect(url).toContain('a=1')
    expect(url).toContain('b=2')
  })
})
