import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { vi, describe, expect, it } from "vitest"

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
}))

// @ts-expect-error build helper is intentionally plain ESM for direct Node execution.
const buildCliModulePromise = import("../../../../scripts/build-cli.mjs")

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-build-cli-"))
}

describe("CLI build script", () => {
  it("writes platform-specific shims that point at the built bundle", async () => {
    const { writePathShims } = await buildCliModulePromise
    const root = await tempDir()
    const binDir = path.join(root, "node_modules", ".bin")
    const bundlePath = path.join(root, ".llm-wiki-cli-build", "llm-wiki.mjs")
    await fs.mkdir(path.dirname(bundlePath), { recursive: true })
    await fs.writeFile(bundlePath, "export async function main() { return 0 }\n")

    await writePathShims(binDir, bundlePath)

    const posix = await fs.readFile(path.join(binDir, "llm-wiki"), "utf8")
    const cmd = await fs.readFile(path.join(binDir, "llm-wiki.cmd"), "utf8")
    const ps1 = await fs.readFile(path.join(binDir, "llm-wiki.ps1"), "utf8")
    const mode = (await fs.stat(path.join(binDir, "llm-wiki"))).mode

    expect(posix).toContain("#!/usr/bin/env sh")
    expect(posix).toContain(".llm-wiki-cli-build/llm-wiki.mjs")
    expect(posix).not.toContain("\\")
    expect(cmd).toContain("%basedir%\\..\\..\\.llm-wiki-cli-build\\llm-wiki.mjs")
    expect(cmd).toContain("%*")
    expect(ps1).toContain("Join-Path")
    expect(ps1).toContain("@args")
    if (process.platform !== "win32") {
      expect(mode & 0o111).not.toBe(0)
    }
  })

  it("includes local npm bin and explicit path bin directories", async () => {
    const { pathBinDirs } = await buildCliModulePromise
    const root = await tempDir()
    const userBin = path.join(root, "user-bin")

    expect(pathBinDirs(root, { LLM_WIKI_CLI_BIN_DIR: userBin })).toEqual([
      path.join(root, "node_modules", ".bin"),
      userBin,
    ])
  })

  it("skips repo-local bins when choosing the user PATH bin", async () => {
    const { pathBinDirs } = await buildCliModulePromise
    const root = await tempDir()
    const userBin = path.join(os.homedir(), ".local", "bin")
    const env = {
      PATH: [
        path.join(root, "node_modules", ".bin"),
        path.join(root, "vendor", ".bin"),
        path.join(os.homedir(), "node_modules", ".bin"),
        userBin,
      ].join(path.delimiter),
    }

    expect(pathBinDirs(root, env)).toEqual([
      path.join(root, "node_modules", ".bin"),
      userBin,
    ])
  })

  it("keeps building when the user bin directory is not writable", async () => {
    const { buildCli } = await buildCliModulePromise
    const root = await tempDir()
    const userBin = path.join(root, "user-bin")
    const bundlePath = path.join(root, ".llm-wiki-cli-build", "llm-wiki.mjs")
    const localBin = path.join(root, "node_modules", ".bin")

    await fs.mkdir(path.dirname(bundlePath), { recursive: true })
    await fs.writeFile(bundlePath, "export async function main() { return 0 }\n")
    await fs.mkdir(userBin, { recursive: true })
    await fs.chmod(userBin, 0o555)

    const status = await buildCli(root, {
      ...process.env,
      LLM_WIKI_CLI_BIN_DIR: userBin,
    })

    expect(status).toBe(0)
    expect(await fs.readFile(path.join(localBin, "llm-wiki"), "utf8")).toContain(".llm-wiki-cli-build/llm-wiki.mjs")
  })
})
