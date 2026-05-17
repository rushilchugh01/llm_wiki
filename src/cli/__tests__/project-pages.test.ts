import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { createProject, exists, validateProject } from "../project"
import { listWikiPages, normalizeRef, pageToJson, readWikiPage, resolvePage } from "../pages"

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-project-"))
}

async function addPage(project: string, rel: string, content: string): Promise<string> {
  const file = path.join(project, "wiki", rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
  return file
}

describe("CLI project and pages", () => {
  it("creates a desktop-compatible project skeleton", async () => {
    const parent = await tempDir()
    const created = await createProject(parent, "Demo")
    await expect(validateProject(created.path)).resolves.toBeUndefined()
    await expect(exists(path.join(created.path, ".llm-wiki", "config.json"))).resolves.toBe(true)
  })

  it("rejects non-project directories", async () => {
    const dir = await tempDir()
    await expect(validateProject(dir)).rejects.toThrow("Not an LLM Wiki project")
  })

  it("reads, lists, resolves, and serializes wiki pages", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    const file = await addPage(project, "concepts/attention.md", [
      "---",
      "type: concept",
      "title: Attention",
      "---",
      "",
      "# Attention",
      "Body",
    ].join("\n"))

    const page = await readWikiPage(path.join(project, "wiki"), file)
    expect(page.title).toBe("Attention")
    expect((await listWikiPages(project)).some((p) => p.slug === "attention")).toBe(true)
    await expect(resolvePage(project, "attention")).resolves.toMatchObject({ slug: "attention" })
    await expect(resolvePage(project, "wiki/concepts/attention.md")).resolves.toMatchObject({ slug: "attention" })
    expect(pageToJson(page).relativePath).toBe("concepts/attention.md")
  })

  it("rejects page references outside wiki", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    const outside = path.join(parent, "outside.md")
    await fs.writeFile(outside, "# Outside\n")

    await expect(resolvePage(project, outside)).rejects.toThrow("inside wiki")
    await expect(resolvePage(project, "../../outside")).rejects.toThrow("Page not found")
  })

  it("normalizes page references", () => {
    expect(normalizeRef("wiki/concepts/Foo.md")).toBe("concepts/foo")
  })
})
