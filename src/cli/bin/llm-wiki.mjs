#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js")
const build = spawnSync(process.execPath, [
  viteBin,
  "build",
  "--config",
  "src/cli/vite.config.ts",
  "--logLevel",
  "error",
], { cwd: root, stdio: "inherit" })

if (build.status !== 0) {
  process.exitCode = build.status ?? 1
} else {
  const { main } = await import("../../../.llm-wiki-cli-build/llm-wiki.mjs")
  process.exitCode = await main(process.argv.slice(2))
}
