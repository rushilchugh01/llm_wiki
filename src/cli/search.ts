import { listWikiPages, type WikiPage } from "./pages"

export interface SearchHit {
  path: string
  slug: string
  title: string
  type: string
  score: number
  snippet: string
  matches: {
    title: boolean
    headings: number
    terms: string[]
  }
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "how", "in", "is", "it", "of", "on", "or", "that", "the", "to",
  "what", "with",
])

export function tokenize(query: string): string[] {
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u)
  return [...new Set(tokens.filter((t) => t.length > 1 && !STOP_WORDS.has(t)))]
}

export function scorePage(page: WikiPage, query: string, terms: string[]): SearchHit | null {
  const phrase = query.trim().toLowerCase()
  const title = `${page.title} ${page.slug}`.toLowerCase()
  const headings = page.body.match(/^#{1,6}\s+.+$/gm) ?? []
  const body = page.body.toLowerCase()
  const matchedTerms = terms.filter((term) => title.includes(term) || body.includes(term))
  const titleMatch = phrase.length > 0 && title.includes(phrase)
  const headingMatches = headings.filter((h) => h.toLowerCase().includes(phrase)).length
  const phraseCount = countOccurrences(body, phrase)
  const score = computeScore(titleMatch, headingMatches, phraseCount, matchedTerms.length)
  if (score === 0) return null
  return {
    path: page.path,
    slug: page.slug,
    title: page.title,
    type: page.type,
    score,
    snippet: buildSnippet(page.body, phrase || matchedTerms[0] || query),
    matches: { title: titleMatch, headings: headingMatches, terms: matchedTerms },
  }
}

export async function searchPages(
  projectPath: string,
  query: string,
  limit: number,
  types: string[] = [],
): Promise<SearchHit[]> {
  const terms = tokenize(query)
  const pages = await listWikiPages(projectPath)
  const allowed = new Set(types.filter(Boolean))
  return pages
    .filter((page) => allowed.size === 0 || allowed.has(page.type))
    .map((page) => scorePage(page, query, terms))
    .filter((hit): hit is SearchHit => hit !== null)
    .sort(compareHits)
    .slice(0, limit)
}

export function buildSearchJson(query: string, results: SearchHit[]): Record<string, unknown> {
  return { query, results }
}

function computeScore(
  titleMatch: boolean,
  headingMatches: number,
  phraseCount: number,
  termCount: number,
): number {
  return (titleMatch ? 100 : 0) + headingMatches * 25 + Math.min(phraseCount, 20) * 5 + termCount
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = 0
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count++
    index += needle.length
  }
  return count
}

function buildSnippet(content: string, needle: string): string {
  const flat = content.replace(/\s+/g, " ").trim()
  const index = flat.toLowerCase().indexOf(needle.toLowerCase())
  if (index < 0) return flat.slice(0, 180)
  const start = Math.max(0, index - 80)
  const end = Math.min(flat.length, index + needle.length + 100)
  return `${start > 0 ? "..." : ""}${flat.slice(start, end)}${end < flat.length ? "..." : ""}`
}

function compareHits(a: SearchHit, b: SearchHit): number {
  if (b.score !== a.score) return b.score - a.score
  return a.path.localeCompare(b.path)
}
