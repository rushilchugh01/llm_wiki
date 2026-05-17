#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const CLI_NAME = "llm-wiki"
const BINARY_BUILD_DIR = ".llm-wiki-cli-binary-build"
const DIST_DIR = "dist-cli"

export async function packageCliBinary(root, env = process.env) {
  const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js")
  run(process.execPath, [
    viteBin,
    "build",
    "--config",
    "src/cli/vite.binary.config.ts",
    "--logLevel",
    "error",
  ], { cwd: root, env })

  await fs.mkdir(path.join(root, DIST_DIR), { recursive: true })
  const entry = path.join(root, BINARY_BUILD_DIR, "llm-wiki.cjs")
  const target = env.LLM_WIKI_PKG_TARGET ?? defaultPkgTarget()
  const ext = target.includes("win") ? ".exe" : ""
  const arch = target.endsWith("arm64") ? "arm64" : "x64"
  const platform = target.includes("macos")
    ? "macos"
    : target.includes("win")
      ? "windows"
      : "linux"
  const output = path.join(root, DIST_DIR, `${CLI_NAME}-${platform}-${arch}${ext}`)
  const pkgBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "pkg.cmd" : "pkg")
  run(pkgBin, [
    entry,
    "--target",
    target,
    "--output",
    output,
    "--no-bytecode",
    "--public-packages",
    "*",
    "--public",
  ], { cwd: root, env })
  await writeChecksums(root)
  return output
}

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function defaultPkgTarget() {
  const node = "node22"
  const arch = process.arch === "arm64" ? "arm64" : "x64"
  if (process.platform === "darwin") return `${node}-macos-${arch}`
  if (process.platform === "win32") return `${node}-win-${arch}`
  return `${node}-linux-${arch}`
}

async function writeChecksums(root) {
  const dir = path.join(root, DIST_DIR)
  const files = (await fs.readdir(dir)).filter((name) => name.startsWith(CLI_NAME))
  const lines = []
  for (const file of files.sort()) {
    const full = path.join(dir, file)
    const hash = await sha256(full)
    lines.push(`${hash}  ${file}`)
  }
  await fs.writeFile(path.join(dir, "SHA256SUMS"), `${lines.join("\n")}\n`)
}

async function sha256(filePath) {
  const { createHash } = await import("node:crypto")
  const hash = createHash("sha256")
  hash.update(await fs.readFile(filePath))
  return hash.digest("hex")
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await packageCliBinary(repoRoot())
}
