const BASE = "https://simplefunctions.dev"
export async function sfFetch<T = any>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, BASE)
  if (params) for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export interface Edge {
  ticker: string; venue: string; title: string; status: string
  marketPrice: number; thesisPrice: number; edge: number; executableEdge: number
  direction: string; confidence: number; liquidityScore: string; spread: number
  reasoning: string; edgeAgeHours: number | null; marketAbsorption: number | null
}

export interface FilterOptions {
  minEdge?: number; minConfidence?: number; maxAge?: number
  liquidity?: string[]; direction?: string; venues?: string[]
}

export async function getEdges(): Promise<Edge[]> {
  const data = await sfFetch<any>('/api/edges')
  return data.edges || []
}

export function filterEdges(edges: Edge[], opts: FilterOptions = {}): Edge[] {
  return edges.filter(e => {
    if (opts.minEdge && e.executableEdge < opts.minEdge) return false
    if (opts.minConfidence && e.confidence < opts.minConfidence) return false
    if (opts.maxAge && e.edgeAgeHours != null && e.edgeAgeHours > opts.maxAge) return false
    if (opts.liquidity && !opts.liquidity.includes(e.liquidityScore)) return false
    if (opts.direction && e.direction !== opts.direction) return false
    if (opts.venues && !opts.venues.includes(e.venue)) return false
    return true
  })
}

export function rankByExpectedValue(edges: Edge[]): Edge[] {
  return [...edges].sort((a, b) => {
    const evA = a.executableEdge * a.confidence * (1 - (a.marketAbsorption || 0))
    const evB = b.executableEdge * b.confidence * (1 - (b.marketAbsorption || 0))
    return evB - evA
  })
}

export function rankByUrgency(edges: Edge[]): Edge[] {
  return [...edges].sort((a, b) => {
    const uA = a.executableEdge * (1 / Math.max(1, a.edgeAgeHours || 1)) * (1 - (a.marketAbsorption || 0))
    const uB = b.executableEdge * (1 / Math.max(1, b.edgeAgeHours || 1)) * (1 - (b.marketAbsorption || 0))
    return uB - uA
  })
}

export async function getEdgesSummary(): Promise<string> {
  const edges = await getEdges()
  if (edges.length === 0) return 'No actionable edges detected.'
  const top = edges[0]
  return `${edges.length} actionable edges. Top: ${top.title} (${top.executableEdge}c edge, ${top.liquidityScore} liq, ${top.edgeAgeHours ? Math.round(top.edgeAgeHours) + 'h old' : 'new'})`
}
