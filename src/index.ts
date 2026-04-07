/**
 * prediction-market-edge-detector
 *
 * Fetch, filter, rank, and summarize actionable mispricings (edges) from
 * the SimpleFunctions API. Each edge is a market where the platform's
 * causal model disagrees with the live market price by enough to be
 * worth trading. Zero dependencies.
 */

const BASE = 'https://simplefunctions.dev'

export interface Edge {
  ticker: string
  venue: 'kalshi' | 'polymarket' | string
  title: string
  status: string
  /** Current market price in cents (0-100). */
  marketPrice: number
  /** Thesis-implied price in cents (0-100). */
  thesisPrice: number
  /** |thesisPrice - marketPrice| in cents. */
  edge: number
  /** Edge after spread/fee assumptions, in cents. */
  executableEdge: number
  /** 'yes' or 'no' — which side to take. */
  direction: 'yes' | 'no' | string
  /** 0-1 confidence in the thesis. */
  confidence: number
  /** Coarse liquidity bucket. */
  liquidityScore: 'high' | 'medium' | 'low' | string
  /** Mid-price spread in cents. */
  spread: number
  /** Human-readable thesis reasoning. */
  reasoning: string
  /** Hours since the edge was first detected. */
  edgeAgeHours: number | null
  /** 0-1 — fraction of the edge already absorbed by the market. */
  marketAbsorption: number | null
}

export interface EdgesResponse {
  priceUnit: string
  edges: Edge[]
  totalEdges: number
  thesesScanned: number
}

export interface FilterOptions {
  /** Minimum executableEdge in cents. */
  minEdge?: number
  /** Minimum confidence in [0, 1]. */
  minConfidence?: number
  /** Maximum edge age in hours. */
  maxAge?: number
  /** Allowed liquidity buckets. */
  liquidity?: Array<'high' | 'medium' | 'low' | string>
  /** Restrict to a single direction. */
  direction?: 'yes' | 'no'
  /** Allowed venues. */
  venues?: string[]
  /** Maximum marketAbsorption (0-1). */
  maxAbsorption?: number
}

// ── API helper ────────────────────────────────────────────

export async function sfFetch<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, BASE)
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`SimpleFunctions API error ${res.status} for ${path}`)
  return (await res.json()) as T
}

// ── Fetch ─────────────────────────────────────────────────

/** Fetch the live edges array. Returns [] if the response has no edges. */
export async function getEdges(): Promise<Edge[]> {
  const data = await sfFetch<EdgesResponse>('/api/edges')
  return Array.isArray(data?.edges) ? data.edges : []
}

/** Fetch the full edges response including totalEdges and thesesScanned counts. */
export async function getEdgesResponse(): Promise<EdgesResponse> {
  const data = await sfFetch<Partial<EdgesResponse>>('/api/edges')
  return {
    priceUnit: data?.priceUnit ?? 'cents',
    edges: Array.isArray(data?.edges) ? data.edges : [],
    totalEdges: typeof data?.totalEdges === 'number' ? data.totalEdges : (data?.edges?.length ?? 0),
    thesesScanned: typeof data?.thesesScanned === 'number' ? data.thesesScanned : 0,
  }
}

// ── Filter ────────────────────────────────────────────────

/** Apply zero or more filters to an edges array. Pure, does not mutate. */
export function filterEdges(edges: Edge[], opts: FilterOptions = {}): Edge[] {
  return edges.filter((e) => {
    if (opts.minEdge != null && e.executableEdge < opts.minEdge) return false
    if (opts.minConfidence != null && e.confidence < opts.minConfidence) return false
    if (opts.maxAge != null && e.edgeAgeHours != null && e.edgeAgeHours > opts.maxAge) return false
    if (opts.liquidity && !opts.liquidity.includes(e.liquidityScore)) return false
    if (opts.direction && e.direction !== opts.direction) return false
    if (opts.venues && !opts.venues.includes(e.venue)) return false
    if (
      opts.maxAbsorption != null &&
      e.marketAbsorption != null &&
      e.marketAbsorption > opts.maxAbsorption
    )
      return false
    return true
  })
}

// ── Rank ──────────────────────────────────────────────────

/**
 * Sort edges by expected value descending.
 * EV = executableEdge × confidence × (1 − marketAbsorption)
 */
export function rankByExpectedValue(edges: Edge[]): Edge[] {
  return [...edges].sort((a, b) => expectedValue(b) - expectedValue(a))
}

/**
 * Sort edges by urgency descending — favors high EV that are also fresh
 * (low edgeAgeHours). Useful for "act on this in the next hour" lists.
 */
export function rankByUrgency(edges: Edge[]): Edge[] {
  return [...edges].sort((a, b) => urgency(b) - urgency(a))
}

/**
 * Sort edges by liquidity-adjusted expected value. Maps the coarse
 * liquidityScore bucket to a multiplier (high=1.0, medium=0.7, low=0.4)
 * before computing EV — penalizes thin markets.
 */
export function rankByLiquidityAdjustedEV(edges: Edge[]): Edge[] {
  return [...edges].sort(
    (a, b) => expectedValue(b) * liquidityWeight(b) - expectedValue(a) * liquidityWeight(a),
  )
}

function expectedValue(e: Edge): number {
  return e.executableEdge * e.confidence * (1 - (e.marketAbsorption ?? 0))
}

function urgency(e: Edge): number {
  return (
    e.executableEdge *
    (1 / Math.max(1, e.edgeAgeHours ?? 1)) *
    (1 - (e.marketAbsorption ?? 0))
  )
}

function liquidityWeight(e: Edge): number {
  switch (e.liquidityScore) {
    case 'high':
      return 1.0
    case 'medium':
      return 0.7
    case 'low':
      return 0.4
    default:
      return 0.5
  }
}

// ── Summary helpers ──────────────────────────────────────

/** Compact one-line summary suitable for chat / Slack. */
export async function getEdgesSummary(): Promise<string> {
  const edges = await getEdges()
  if (edges.length === 0) return 'No actionable edges detected.'
  const top = rankByExpectedValue(edges)[0]
  const age = top.edgeAgeHours != null ? `${Math.round(top.edgeAgeHours)}h old` : 'new'
  return `${edges.length} actionable edges. Top: ${top.title} (${top.executableEdge}c edge, ${top.liquidityScore} liq, ${age})`
}

/** Group edges by venue, returning a record of arrays. */
export function groupByVenue(edges: Edge[]): Record<string, Edge[]> {
  const out: Record<string, Edge[]> = {}
  for (const e of edges) {
    ;(out[e.venue] ??= []).push(e)
  }
  return out
}

/** Group edges by direction (`yes` / `no`). */
export function groupByDirection(edges: Edge[]): Record<string, Edge[]> {
  const out: Record<string, Edge[]> = {}
  for (const e of edges) {
    ;(out[e.direction] ??= []).push(e)
  }
  return out
}
