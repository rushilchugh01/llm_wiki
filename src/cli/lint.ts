import { listWikiPages, type WikiPage } from "./pages"

export interface CliLintResult {
  type: "broken-link" | "orphan" | "no-outlinks"
  severity: "warning" | "info"
  page: string
  detail: string
}

export async function lintProject(projectPath: string): Promise<CliLintResult[]> {
  const pages = await listWikiPages(projectPath)
  const contentPages = pages.filter((p) => !["index.md", "log.md", "overview.md"].includes(p.relativePath))
  const slugMap = buildSlugMap(contentPages)
  const inbound = buildInboundCounts(contentPages, slugMap)
  return contentPages.flatMap((page) => lintPage(page, slugMap, inbound))
}

export function extractWikilinks(content: string): string[] {
  const links: string[] = []
  for (const match of content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    links.push(match[1].trim())
  }
  return links
}

export function lintPage(
  page: WikiPage,
  slugMap: Map<string, string>,
  inbound: Map<string, number>,
): CliLintResult[] {
  const links = extractWikilinks(page.body)
  const results: CliLintResult[] = []
  if ((inbound.get(page.slug.toLowerCase()) ?? 0) === 0) {
    results.push(info(page, "orphan", "No other pages link to this page."))
  }
  if (links.length === 0) {
    results.push(info(page, "no-outlinks", "This page has no [[wikilink]] references."))
  }
  for (const link of links) {
    if (!hasTarget(slugMap, link)) {
      results.push({
        type: "broken-link",
        severity: "warning",
        page: page.relativePath,
        detail: `Broken link: [[${link}]] target page not found.`,
      })
    }
  }
  return results
}

export function buildSlugMap(pages: WikiPage[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const page of pages) {
    map.set(page.slug.toLowerCase(), page.relativePath)
    map.set(page.relativePath.replace(/\.md$/, "").toLowerCase(), page.relativePath)
  }
  return map
}

export function buildInboundCounts(
  pages: WikiPage[],
  slugMap: Map<string, string>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const page of pages) {
    for (const link of extractWikilinks(page.body)) {
      const target = slugForCount(slugMap.get(link.toLowerCase()) ?? link)
      counts.set(target, (counts.get(target) ?? 0) + 1)
    }
  }
  return counts
}

function hasTarget(slugMap: Map<string, string>, link: string): boolean {
  const lower = link.toLowerCase().split("#")[0]
  const base = lower.split("/").pop()?.replace(/\.md$/, "") ?? lower
  return slugMap.has(lower) || slugMap.has(base)
}

function slugForCount(value: string): string {
  return (value.split("#")[0].split("/").pop() ?? value).replace(/\.md$/, "").toLowerCase()
}

function info(page: WikiPage, type: "orphan" | "no-outlinks", detail: string): CliLintResult {
  return { type, severity: "info", page: page.relativePath, detail }
}
