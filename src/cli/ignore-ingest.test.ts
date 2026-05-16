import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "./config"
import { createProject } from "./project"
import { collectFiles, isTextFile, loadGitignore, shouldSkip } from "./ignore"
import {
  assertUsableLlm,
  buildIngestMessages,
  ingestFile,
  ingestPath,
  parseFileBlocks,
  writeFileBlocks,
  type ChatFn,
} from "./ingest"

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-ingest-"))
}

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

const fakeChat: ChatFn = async () => [
  "---FILE: wiki/sources/note.md---",
  "---",
  "type: source",
  "title: Note",
  "---",
  "# Note",
  "---END FILE---",
].join("\n")

describe("CLI ignore and ingest", () => {
  it("loads gitignore patterns and skips built-in ignored paths", async () => {
    const dir = await tempDir()
    await write(path.join(dir, ".gitignore"), "ignored/\n*.log\n")
    expect(await loadGitignore(dir)).toEqual(["ignored/", "*.log"])
    expect(shouldSkip("node_modules", "node_modules", [], { recursive: true })).toBe(true)
    expect(shouldSkip("wiki", "wiki", [], { recursive: true })).toBe(true)
    expect(shouldSkip("package-lock.json", "package-lock.json", [], { recursive: true })).toBe(true)
    expect(shouldSkip("x.log", "x.log", ["*.log"], { recursive: true })).toBe(true)
  })

  it("detects text files and collects recursively by default", async () => {
    const dir = await tempDir()
    await write(path.join(dir, "a.md"), "A")
    await write(path.join(dir, "node_modules", "b.md"), "B")
    await write(path.join(dir, "wiki", "generated.md"), "W")
    await write(path.join(dir, "sub", "c.txt"), "C")
    expect(isTextFile("a.md")).toBe(true)
    await expect(collectFiles(dir, { recursive: true })).resolves.toHaveLength(2)
    await expect(collectFiles(dir, { recursive: false })).resolves.toHaveLength(1)
  })

  it("parses and writes FILE blocks safely", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    const blocks = parseFileBlocks(await fakeChat(DEFAULT_CONFIG.llm, []))
    expect(blocks).toHaveLength(1)
    await expect(writeFileBlocks(project, blocks)).resolves.toHaveLength(1)
    await expect(writeFileBlocks(project, [{ path: "../bad.md", content: "" }])).rejects.toThrow("wiki/")
  })

  it("builds ingest messages and ingests one file with injected chat", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    const source = path.join(parent, "note.md")
    await write(source, "hello")
    expect(buildIngestMessages(source, "hello")[0].content).toContain("hello")
    const written = await ingestFile(project, source, DEFAULT_CONFIG.llm, fakeChat)
    expect(written[0]).toContain("wiki/sources/note.md")
  })

  it("supports dry-run and threshold checks for folder ingest", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    await write(path.join(parent, "a.md"), "A")
    const cfg = { ...DEFAULT_CONFIG, ingest: { recursiveByDefault: true, maxFilesWithoutYes: 0 } }
    const dry = await ingestPath(project, parent, cfg, { dryRun: true, yes: false, recursive: true })
    expect(dry.files.length).toBeGreaterThan(0)
    await expect(ingestPath(project, parent, cfg, {
      dryRun: false,
      yes: false,
      recursive: true,
    }, fakeChat)).rejects.toThrow("Re-run with --yes")
  })

  it("validates usable LLM configuration", () => {
    expect(() => assertUsableLlm({ ...DEFAULT_CONFIG.llm, model: "" })).toThrow("model")
    expect(() => assertUsableLlm({
      ...DEFAULT_CONFIG.llm,
      provider: "openai",
      model: "gpt",
      apiKey: "",
    })).toThrow("API key")
  })

  it("can mock chat functions without real LLM calls", async () => {
    const chat = vi.fn(fakeChat)
    await chat(DEFAULT_CONFIG.llm, [])
    expect(chat).toHaveBeenCalledOnce()
  })
})
