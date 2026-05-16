#!/usr/bin/env node
import { fileURLToPath } from "node:url"
import path from "node:path"
import { runCli } from "./commands"

export async function main(argv = process.argv.slice(2)): Promise<number> {
  return runCli(argv, {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
  })
}

function isDirectRun(): boolean {
  const script = process.argv[1]
  return Boolean(script) && path.resolve(script) === fileURLToPath(import.meta.url)
}

if (isDirectRun()) {
  process.exitCode = await main()
}
