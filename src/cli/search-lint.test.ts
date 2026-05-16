import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { createProject } from "./project"
import { buildSearchJson, scorePage, searchPages, tokenize } from "./search"
import { buildInboundCounts, buildSlugMap, extractWikilinks, lintPage, lintProject } from "./lint"
import { readWikiPage } from "./pages"

async function fixtureProject(): Promise<string> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-search-"))
  const { path: project } = await createProject(parent, "Demo")
  await write(project, "concepts/attention.md", page("concept", "Attention", "Links to [[transformer]]."))
  await write(project, "entities/transformer.md", page("entity", "Transformer", "Uses attention."))
  await write(project, "entities/broken.md", page("entity", "Broken", "Points at [[missing]]."))
  return project
}

function page(type: string, title: string, body: string): string {
  return `---\ntype: ${type}\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`
}

async function write(project: string, rel: string, content: string): Promise<void> {
  const file = path.join(project, "wiki", rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

describe("CLI search and lint", () => {
  it("tokenizes useful query terms", () => {
    expect(tokenize("what is attention?")).toEqual(["attention"])
  })

  it("scores matching pages and builds search JSON", async () => {
    const project = await fixtureProject()
    const pageData = await readWikiPage(path.join(project, "wiki"), path.join(project, "wiki/concepts/attention.md"))
    const hit = scorePage(pageData, "attention", ["attention"])
    expect(hit?.title).toBe("Attention")
    expect(buildSearchJson("attention", hit ? [hit] : []).query).toBe("attention")
  })

  it("searches pages by title, type, and body", async () => {
    const project = await fixtureProject()
    const hits = await searchPages(project, "attention", 5, ["concept"])
    expect(hits.map((h) => h.slug)).toEqual(["attention"])
  })

  it("extracts wikilinks and lints broken links", async () => {
    expect(extractWikilinks("See [[attention|Attention]] and [[missing]].")).toEqual(["attention", "missing"])
    const project = await fixtureProject()
    const results = await lintProject(project)
    expect(results.some((r) => r.type === "broken-link" && r.page === "entities/broken.md")).toBe(true)
  })

  it("builds slug maps, inbound counts, and page-level lint results", async () => {
    const project = await fixtureProject()
    const root = path.join(project, "wiki")
    const pages = await Promise.all([
      readWikiPage(root, path.join(root, "concepts/attention.md")),
      readWikiPage(root, path.join(root, "entities/transformer.md")),
    ])
    const slugMap = buildSlugMap(pages)
    const inbound = buildInboundCounts(pages, slugMap)
    expect(inbound.get("transformer")).toBe(1)
    expect(lintPage(pages[1], slugMap, inbound).some((r) => r.type === "orphan")).toBe(false)
  })
})
