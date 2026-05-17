import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { dispatch, formatResult, parseArgs, projectNameFromPath, runCli } from "../commands"

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-cli-"))
}

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const before = process.cwd()
  process.chdir(cwd)
  try {
    return await fn()
  } finally {
    process.chdir(before)
  }
}

function page(title: string, body: string): string {
  return `---\ntype: concept\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`
}

describe("CLI command integration", () => {
  it("parses args and formats output", () => {
    const parsed = parseArgs(["search", "/p", "hello", "--json", "--limit", "2"])
    expect(parsed.flags.limit).toBe("2")
    expect(parseArgs(["--debug", "ingest", "/p", "/s"]).flags.debug).toBe(true)
    expect(formatResult({ ok: true }, true)).toContain('"ok"')
  })

  it("runs create, search, view, lint, and dry-run ingest", async () => {
    const parent = await tempDir()
    const stdout: string[] = []
    const stderr: string[] = []
    const io = { stdout: (s: string) => stdout.push(s), stderr: (s: string) => stderr.push(s) }

    await expect(runCli(["create", parent, "--name", "Demo", "--json"], io)).resolves.toBe(0)
    const project = path.join(parent, "Demo")
    await write(path.join(project, "wiki/concepts/attention.md"), page("Attention", "See [[missing]]."))

    await expect(runCli(["search", project, "attention", "--json"], io)).resolves.toBe(0)
    await expect(runCli(["view", project, "attention"], io)).resolves.toBe(0)
    await expect(runCli(["lint", project, "--json"], io)).resolves.toBe(0)
    await expect(runCli(["ingest", project, project, "--dry-run", "--json"], io)).resolves.toBe(0)
    expect(stdout.join("\n")).toContain("Attention")
    expect(stderr).toEqual([])
  })

  it("supports flag-first create and ingest APIs", async () => {
    const parent = await tempDir()
    const project = path.join(parent, "Demo")
    const source = path.join(parent, "source")
    const stdout: string[] = []
    const stderr: string[] = []
    const io = { stdout: (s: string) => stdout.push(s), stderr: (s: string) => stderr.push(s) }

    await write(path.join(source, "note.md"), "hello")
    await expect(runCli(["create", "--dest", project, "--json"], io)).resolves.toBe(0)
    await expect(runCli([
      "ingest",
      "--source",
      source,
      "--dest",
      project,
      "--dry-run",
      "--json",
    ], io)).resolves.toBe(0)

    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({ name: "Demo", path: project })
    expect(JSON.parse(stdout[1] ?? "{}")).toMatchObject({ dryRun: true })
    expect(stderr).toEqual([])
  })

  it("auto-creates the destination project for flag-first ingest", async () => {
    const parent = await tempDir()
    const project = path.join(parent, "AutoDemo")
    const source = path.join(parent, "source")
    const stdout: string[] = []
    const stderr: string[] = []
    const io = { stdout: (s: string) => stdout.push(s), stderr: (s: string) => stderr.push(s) }

    await write(path.join(source, "note.md"), "hello")
    await expect(runCli([
      "ingest",
      "--source",
      source,
      "--dest",
      project,
      "--dry-run",
      "--json",
    ], io)).resolves.toBe(0)

    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({ dryRun: true })
    await expect(fs.readFile(path.join(project, "schema.md"), "utf8")).resolves.toContain("Wiki Schema")
    await expect(fs.readFile(path.join(project, ".llm-wiki", "config.json"), "utf8")).resolves.toContain("custom")
    expect(stderr).toEqual([])
  })

  it("defaults empty flag-first ingest source and destination to the current directory", async () => {
    const cwd = await tempDir()
    const stdout: string[] = []
    const stderr: string[] = []
    const io = { stdout: (s: string) => stdout.push(s), stderr: (s: string) => stderr.push(s) }

    await write(path.join(cwd, "note.md"), "hello")
    await withCwd(cwd, async () => {
      await expect(runCli(["ingest", "--dry-run", "--json"], io)).resolves.toBe(0)
    })

    const report = JSON.parse(stdout[0] ?? "{}") as { files: string[]; dryRun: boolean }
    expect(report).toMatchObject({ dryRun: true })
    expect(report.files).toEqual([path.join(cwd, "note.md")])
    await expect(fs.readFile(path.join(cwd, "schema.md"), "utf8")).resolves.toContain("Wiki Schema")
    expect(stderr).toEqual([])
  })

  it("treats value-less --source and --dest as the current directory", async () => {
    const cwd = await tempDir()
    const stdout: string[] = []
    const io = { stdout: (s: string) => stdout.push(s), stderr: () => {} }

    await write(path.join(cwd, "note.md"), "hello")
    await withCwd(cwd, async () => {
      await expect(runCli(["ingest", "--source", "--dest", "--dry-run", "--json"], io)).resolves.toBe(0)
    })

    expect((JSON.parse(stdout[0] ?? "{}") as { files: string[] }).files).toEqual([
      path.join(cwd, "note.md"),
    ])
  })

  it("does not crawl a destination project created inside the source tree", async () => {
    const parent = await tempDir()
    const project = path.join(parent, "Wiki")
    const stdout: string[] = []
    const io = { stdout: (s: string) => stdout.push(s), stderr: () => {} }

    await write(path.join(parent, "note.md"), "hello")
    await expect(runCli([
      "ingest",
      "--source",
      parent,
      "--dest",
      project,
      "--dry-run",
      "--json",
    ], io)).resolves.toBe(0)

    expect((JSON.parse(stdout[0] ?? "{}") as { files: string[] }).files).toEqual([
      path.join(parent, "note.md"),
    ])
  })

  it("defaults a missing source to the current directory when --dest is supplied", async () => {
    const cwd = await tempDir()
    const project = path.join(cwd, "Wiki")
    const stdout: string[] = []
    const io = { stdout: (s: string) => stdout.push(s), stderr: () => {} }

    await write(path.join(cwd, "note.md"), "hello")
    await withCwd(cwd, async () => {
      await expect(runCli(["ingest", "--dest", project, "--dry-run", "--json"], io)).resolves.toBe(0)
    })

    expect((JSON.parse(stdout[0] ?? "{}") as { files: string[] }).files).toEqual([
      path.join(cwd, "note.md"),
    ])
  })

  it("defaults a missing destination to the current directory when --source is supplied", async () => {
    const cwd = await tempDir()
    const source = path.join(cwd, "source")
    const stdout: string[] = []
    const io = { stdout: (s: string) => stdout.push(s), stderr: () => {} }

    await write(path.join(source, "note.md"), "hello")
    await withCwd(cwd, async () => {
      await expect(runCli(["ingest", "--source", source, "--dry-run", "--json"], io)).resolves.toBe(0)
    })

    expect((JSON.parse(stdout[0] ?? "{}") as { files: string[] }).files).toEqual([
      path.join(source, "note.md"),
    ])
    await expect(fs.readFile(path.join(cwd, "schema.md"), "utf8")).resolves.toContain("Wiki Schema")
  })

  it("does not auto-create over conflicting generated project files", async () => {
    const parent = await tempDir()
    const project = path.join(parent, "not-project")
    const source = path.join(parent, "source")
    const stderr: string[] = []
    const io = { stdout: () => {}, stderr: (s: string) => stderr.push(s) }

    await write(path.join(source, "note.md"), "hello")
    await write(path.join(project, "schema.md"), "keep me")

    await expect(runCli([
      "ingest",
      "--source",
      source,
      "--dest",
      project,
      "--dry-run",
    ], io)).resolves.toBe(1)
    expect(stderr.join("\n")).toContain("Project destination already contains generated file path")
  })

  it("emits debug JSONL for ingest without changing stdout", async () => {
    const parent = await tempDir()
    const stdout: string[] = []
    const stderr: string[] = []
    const io = { stdout: (s: string) => stdout.push(s), stderr: (s: string) => stderr.push(s) }

    await expect(runCli(["create", parent, "--name", "Demo"], io)).resolves.toBe(0)
    const project = path.join(parent, "Demo")
    await write(path.join(parent, "note.md"), "hello")
    await expect(runCli(["--debug", "ingest", project, parent, "--dry-run", "--json"], io))
      .resolves.toBe(0)

    const events = stderr.map((line) => JSON.parse(line) as { event: string })
    expect(events.map((e) => e.event)).toContain("scan_start")
    expect(events.map((e) => e.event)).toContain("scan_file")
    expect(events.map((e) => e.event)).toContain("ingest_done")
    expect(JSON.parse(stdout[stdout.length - 1] ?? "{}").dryRun).toBe(true)
  })

  it("honors recursiveByDefault and allows explicit recursive ingest", async () => {
    const parent = await tempDir()
    const stdout: string[] = []
    const io = { stdout: (s: string) => stdout.push(s), stderr: () => {} }
    await expect(runCli(["create", parent, "--name", "Demo"], io)).resolves.toBe(0)
    const project = path.join(parent, "Demo")
    await write(path.join(project, ".llm-wiki", "config.json"), JSON.stringify({
      ingest: { recursiveByDefault: false },
    }))
    await write(path.join(parent, "source", "top.md"), "top")
    await write(path.join(parent, "source", "nested", "child.md"), "child")

    await expect(runCli(["ingest", project, path.join(parent, "source"), "--dry-run", "--json"], io))
      .resolves.toBe(0)
    expect(JSON.parse(stdout[stdout.length - 1] ?? "{}").files).toHaveLength(1)

    await expect(runCli(["ingest", project, path.join(parent, "source"), "--dry-run", "--recursive", "--json"], io))
      .resolves.toBe(0)
    expect(JSON.parse(stdout[stdout.length - 1] ?? "{}").files).toHaveLength(2)
  })

  it("enforces ingest size limits during dry-run", async () => {
    const parent = await tempDir()
    const stderr: string[] = []
    const io = { stdout: () => {}, stderr: (s: string) => stderr.push(s) }
    await expect(runCli(["create", parent, "--name", "Demo"], io)).resolves.toBe(0)
    const project = path.join(parent, "Demo")
    await write(path.join(parent, "source", "a.md"), "AAAA")
    await write(path.join(parent, "source", "b.md"), "BBBB")

    await expect(runCli([
      "ingest",
      project,
      path.join(parent, "source"),
      "--dry-run",
      "--recursive",
      "--max-files",
      "1",
    ], io)).resolves.toBe(1)
    expect(stderr.join("\n")).toContain("--max-files")
  })

  it("dispatches help and rejects unknown commands", async () => {
    await expect(dispatch(parseArgs(["help"]))).resolves.toContain("llm-wiki create")
    await expect(dispatch(parseArgs(["nope"]))).rejects.toThrow("Unknown command")
  })

  it("returns non-zero from runCli on failures", async () => {
    const stderr: string[] = []
    const code = await runCli(["view"], { stdout: () => {}, stderr: (s) => stderr.push(s) })
    expect(code).toBe(1)
    expect(stderr[0]).toContain("Usage")
  })

  it("rejects invalid search limits", async () => {
    const parent = await tempDir()
    const stderr: string[] = []
    const io = { stdout: () => {}, stderr: (s: string) => stderr.push(s) }
    await expect(runCli(["create", parent, "--name", "Demo"], io)).resolves.toBe(0)
    const project = path.join(parent, "Demo")

    await expect(runCli(["search", project, "anything", "--limit", "abc"], io)).resolves.toBe(1)
    await expect(runCli(["search", project, "anything", "--limit", "0"], io)).resolves.toBe(1)
    await expect(runCli(["search", project, "anything", "--limit", "-1"], io)).resolves.toBe(1)
    expect(stderr.join("\n")).toContain("--limit must be a positive integer")
  })

  it("derives project names from paths", () => {
    expect(projectNameFromPath("/tmp/Demo")).toBe("Demo")
  })
})
