import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "../config"
import { createDebugReporter } from "../debug"
import { createProject } from "../project"
import {
  collectFiles,
  isBroadSourceDirectory,
  isTextFile,
  loadGitignore,
  shouldSkip,
} from "../ignore"
import {
  assertCompleteFileBlocks,
  assertUsableLlm,
  buildIngestMessages,
  ingestFile,
  ingestPath,
  parseFileBlocks,
  writeFileBlocks,
  type ChatFn,
} from "../ingest"

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-ingest-"))
}

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

async function trySymlink(target: string, link: string): Promise<boolean> {
  try {
    await fs.symlink(target, link, "dir")
    return true
  } catch (error) {
    if (
      process.platform === "win32"
      && typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "EPERM"
    ) {
      return false
    }
    throw error
  }
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

  it("uses include as a relative-path filter", async () => {
    const dir = await tempDir()
    await write(path.join(dir, "reports", "a.md"), "A")
    await write(path.join(dir, "notes", "b.md"), "B")

    await expect(collectFiles(dir, { recursive: true, include: ["reports"] })).resolves.toEqual([
      path.join(dir, "reports", "a.md"),
    ])
  })

  it("blocks broad source directories but allows narrower subfolders", async () => {
    const home = path.join(os.tmpdir(), "llm-wiki-home")
    expect(isBroadSourceDirectory(home, true, home)).toBe(true)
    expect(isBroadSourceDirectory(path.join(home, "Documents"), true, home)).toBe(true)
    expect(isBroadSourceDirectory(path.join(home, "Downloads"), true, home)).toBe(true)
    expect(isBroadSourceDirectory(path.parse(home).root, true, home)).toBe(true)
    expect(isBroadSourceDirectory(path.join(home, "Documents", "case-notes"), true, home)).toBe(false)
    expect(isBroadSourceDirectory(path.join(home, "Downloads", "one-file.md"), false, home)).toBe(false)
  })

  it("rejects direct collection from broad source directories", async () => {
    await expect(collectFiles(os.homedir(), { recursive: true })).rejects.toThrow(
      "Refusing to ingest broad source directory",
    )
  })

  it("rejects root symlink sources before walking", async () => {
    const dir = await tempDir()
    const link = path.join(dir, "home-link")
    if (!(await trySymlink(os.homedir(), link))) {
      return
    }

    await expect(collectFiles(link, { recursive: true })).rejects.toThrow(
      "Refusing to ingest symbolic link source",
    )
  })

  it("reports scan debug events", async () => {
    const dir = await tempDir()
    const logs: string[] = []
    await write(path.join(dir, "a.md"), "A")
    await write(path.join(dir, "node_modules", "b.md"), "B")
    const debug = createDebugReporter(true, (line) => logs.push(line))

    await collectFiles(dir, { recursive: true }, debug)

    const events = logs.map((line) => JSON.parse(line) as { event: string; reason?: string })
    expect(events.map((e) => e.event)).toContain("scan_file")
    expect(events.some((e) => e.event === "scan_skip" && e.reason === "ignored")).toBe(true)
  })

  it("skips symlinks while walking", async () => {
    const dir = await tempDir()
    const logs: string[] = []
    await write(path.join(dir, "real-source", "a.md"), "A")
    if (!(await trySymlink(path.join(dir, "real-source"), path.join(dir, "linked-source")))) {
      return
    }
    const debug = createDebugReporter(true, (line) => logs.push(line))

    await expect(collectFiles(dir, { recursive: true }, debug)).resolves.toEqual([
      path.join(dir, "real-source", "a.md"),
    ])

    const events = logs.map((line) => JSON.parse(line) as { event: string; reason?: string })
    expect(events.some((e) => e.event === "scan_skip" && e.reason === "symlink")).toBe(true)
  })

  it("parses and writes FILE blocks safely", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    const blocks = parseFileBlocks(await fakeChat(DEFAULT_CONFIG.llm, []))
    expect(blocks).toHaveLength(1)
    await expect(writeFileBlocks(project, blocks)).resolves.toHaveLength(1)
    await expect(writeFileBlocks(project, [{ path: "../bad.md", content: "" }])).rejects.toThrow("wiki/")
    await expect(writeFileBlocks(project, [{ path: "wiki/../../evil/x.md", content: "" }]))
      .rejects.toThrow("traversal")
  })

  it("builds ingest messages and ingests one file with injected chat", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    const source = path.join(parent, "note.md")
    const logs: string[] = []
    const debug = createDebugReporter(true, (line) => logs.push(line))
    await write(source, "hello")
    expect(buildIngestMessages(source, "hello")[0].content).toContain("hello")
    const written = await ingestFile(project, source, DEFAULT_CONFIG.llm, fakeChat, debug)
    expect(written[0]).toContain(path.join("wiki", "sources", "note.md"))
    expect(logs.join("\n")).toContain("llm_start")
    expect(logs.join("\n")).toContain('"event":"write"')
  })

  it("rejects model replies that omit FILE blocks", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    const source = path.join(parent, "note.md")
    await write(source, "hello")

    await expect(
      ingestFile(
        project,
        source,
        DEFAULT_CONFIG.llm,
        async () => "This reply has no file blocks.",
      ),
    ).rejects.toThrow("did not contain any FILE blocks")
  })

  it("rejects incomplete model FILE blocks", () => {
    const response = [
      "---FILE: wiki/sources/ok.md---",
      "# OK",
      "---END FILE---",
      "---FILE: wiki/sources/missing-end.md---",
      "# Missing end",
    ].join("\n")
    expect(() => assertCompleteFileBlocks(response, parseFileBlocks(response).length, "note.md"))
      .toThrow("incomplete FILE block")
  })

  it("refuses to write through project symlink directories", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    const outside = path.join(parent, "outside")
    await fs.rm(path.join(project, "wiki"), { recursive: true, force: true })
    await fs.mkdir(outside)
    if (!(await trySymlink(outside, path.join(project, "wiki")))) {
      return
    }

    await expect(writeFileBlocks(project, [{ path: "wiki/sources/x.md", content: "x" }]))
      .rejects.toThrow("symbolic link")
  })

  it("ingests folders without a confirmation flag", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    await write(path.join(parent, "a.md"), "A")
    const cfg = {
      ...DEFAULT_CONFIG,
      llm: { ...DEFAULT_CONFIG.llm, model: "test-model", customEndpoint: "http://localhost/v1" },
    }
    const dry = await ingestPath(project, parent, cfg, { dryRun: true, recursive: true })
    expect(dry.files.length).toBeGreaterThan(0)
    const written = await ingestPath(project, parent, cfg, {
      dryRun: false,
      recursive: true,
    }, fakeChat)
    expect(written.files.length).toBeGreaterThan(1)
    expect(written.written.length).toBe(written.files.length)
  })

  it("enforces explicit ingest size limits", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    const source = path.join(parent, "source")
    await write(path.join(source, "a.md"), "AAAA")
    await write(path.join(source, "b.md"), "BBBB")
    const cfg = {
      ...DEFAULT_CONFIG,
      llm: { ...DEFAULT_CONFIG.llm, model: "test-model", customEndpoint: "http://localhost/v1" },
    }

    await expect(ingestPath(project, source, cfg, {
      dryRun: false,
      recursive: true,
      maxFiles: 1,
    }, fakeChat)).rejects.toThrow("--max-files")
    await expect(ingestPath(project, source, cfg, {
      dryRun: false,
      recursive: true,
      maxBytes: 4,
    }, fakeChat)).rejects.toThrow("--max-bytes")
    await expect(ingestPath(project, source, cfg, {
      dryRun: false,
      recursive: true,
      maxFileBytes: 3,
    }, fakeChat)).rejects.toThrow("--max-file-bytes")
  })

  it("preserves relative source paths when copying raw sources", async () => {
    const parent = await tempDir()
    const { path: project } = await createProject(parent, "Demo")
    const source = path.join(parent, "source")
    await write(path.join(source, "a", "note.md"), "A")
    await write(path.join(source, "b", "note.md"), "B")
    const cfg = {
      ...DEFAULT_CONFIG,
      llm: { ...DEFAULT_CONFIG.llm, model: "test-model", customEndpoint: "http://localhost/v1" },
    }

    await ingestPath(project, source, cfg, { dryRun: false, recursive: true }, fakeChat)

    await expect(fs.readFile(path.join(project, "raw", "sources", "a", "note.md"), "utf8"))
      .resolves.toBe("A")
    await expect(fs.readFile(path.join(project, "raw", "sources", "b", "note.md"), "utf8"))
      .resolves.toBe("B")
  })

  it("validates usable LLM configuration", () => {
    expect(() => assertUsableLlm({ ...DEFAULT_CONFIG.llm, model: "" })).toThrow("model")
    expect(() => assertUsableLlm({
      ...DEFAULT_CONFIG.llm,
      provider: "openai",
      model: "gpt",
      apiKey: "",
    })).toThrow("API key")
    expect(() => assertUsableLlm({
      ...DEFAULT_CONFIG.llm,
      provider: "codex-cli",
      model: "gpt-5.4-mini",
      apiKey: "",
    })).not.toThrow()
  })

  it("can mock chat functions without real LLM calls", async () => {
    const chat = vi.fn(fakeChat)
    await chat(DEFAULT_CONFIG.llm, [])
    expect(chat).toHaveBeenCalledOnce()
  })
})
