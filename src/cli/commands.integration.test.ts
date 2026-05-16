import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { dispatch, formatResult, parseArgs, projectNameFromPath, runCli } from "./commands"

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-cli-"))
}

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

function page(title: string, body: string): string {
  return `---\ntype: concept\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`
}

describe("CLI command integration", () => {
  it("parses args and formats output", () => {
    const parsed = parseArgs(["search", "/p", "hello", "--json", "--limit", "2"])
    expect(parsed.flags.limit).toBe("2")
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

  it("derives project names from paths", () => {
    expect(projectNameFromPath("/tmp/Demo")).toBe("Demo")
  })
})
