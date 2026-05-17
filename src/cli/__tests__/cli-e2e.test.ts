import fs from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

interface FakeLlmServer {
  url: string
  requests: Array<{ authorization?: string; body: unknown }>
  close: () => Promise<void>
}

const CLI_PATH = path.join(process.cwd(), ".llm-wiki-cli-build", "llm-wiki.mjs")
const createdDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-cli-e2e-"))
  createdDirs.push(dir)
  return dir
}

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T
}

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => { stdout += chunk })
    child.stderr.on("data", (chunk: string) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

async function runCommand(
  command: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => { stdout += chunk })
    child.stderr.on("data", (chunk: string) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

async function startFakeLlmServer(): Promise<FakeLlmServer> {
  const requests: FakeLlmServer["requests"] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      requests.push({
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
      })
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.end([
        sse({
          choices: [{
            delta: {
              content: [
                "---FILE: wiki/sources/source-note.md---",
                "---",
                "type: source",
                "title: Source Note",
                "tags: []",
                "related: []",
                "---",
                "# Source Note",
                "",
                "E2E summary from fake LLM.",
                "---END FILE---",
              ].join("\n"),
            },
          }],
        }),
        "data: [DONE]\n\n",
      ].join(""))
    })
  })
  const url = await new Promise<string>((resolve, reject) => {
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Fake LLM server did not bind to a TCP port."))
        return
      }
      resolve(`http://127.0.0.1:${address.port}/v1`)
    })
  })
  return {
    url,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve())
    }),
  }
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

beforeAll(async () => {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const build = await runCommand(npm, ["run", "build:cli"])
  expect(build.stderr).toBe("")
  expect(build.code).toBe(0)
  await fs.access(CLI_PATH)
})

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("llm-wiki CLI E2E", () => {
  it("ingests with --source and --dest through the built CLI bundle", async () => {
    const server = await startFakeLlmServer()
    try {
      const root = await tempDir()
      const source = path.join(root, "source")
      const dest = path.join(root, "wiki-project")
      await write(path.join(source, "source-note.md"), "This is an E2E CLI source note.")

      const result = await runCli([
        "ingest",
        "--source",
        source,
        "--dest",
        dest,
        "--json",
        "--provider",
        "custom",
        "--base-url",
        server.url,
        "--api-key",
        "test-key",
        "--model",
        "fake-e2e-model",
      ], {})

      expect(result.stderr).toBe("")
      expect(result.code).toBe(0)
      const report = JSON.parse(result.stdout) as { files: string[]; written: string[]; dryRun: boolean }
      expect(report.dryRun).toBe(false)
      expect(report.files).toEqual([path.join(source, "source-note.md")])
      expect(report.written).toEqual([path.join(dest, "wiki", "sources", "source-note.md")])
      await expect(fs.readFile(path.join(dest, "schema.md"), "utf8")).resolves.toContain("Wiki Schema")
      await expect(fs.readFile(path.join(dest, "raw", "sources", "source-note.md"), "utf8"))
        .resolves.toBe("This is an E2E CLI source note.")
      await expect(fs.readFile(path.join(dest, "wiki", "sources", "source-note.md"), "utf8"))
        .resolves.toContain("E2E summary from fake LLM.")
      expect(server.requests).toHaveLength(1)
      expect(server.requests[0]?.authorization).toBe("Bearer test-key")
    } finally {
      await server.close()
    }
  })

  it("does not recursively ingest the destination when --dest is inside --source", async () => {
    const root = await tempDir()
    const dest = path.join(root, "wiki-project")
    await write(path.join(root, "source-note.md"), "This source should be the only match.")

    const result = await runCli([
      "ingest",
      "--source",
      root,
      "--dest",
      dest,
      "--dry-run",
      "--json",
    ], {})

    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout) as { files: string[]; dryRun: boolean }
    expect(report).toMatchObject({ dryRun: true })
    expect(report.files).toEqual([path.join(root, "source-note.md")])
    await expect(readJson(path.join(dest, ".llm-wiki", "config.json"))).resolves.toMatchObject({
      llm: { provider: "custom" },
    })
  })
})
