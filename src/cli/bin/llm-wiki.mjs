#!/usr/bin/env node
import path from "node:path"
import { pathToFileURL } from "node:url"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const bundlePath = path.join(root, ".llm-wiki-cli-build", "llm-wiki.mjs")

try {
  const { main } = await import(pathToFileURL(bundlePath).href)
  process.exitCode = await main(process.argv.slice(2))
} catch (err) {
  if (err instanceof Error && missingBundle(err)) {
    console.error("llm-wiki CLI bundle is missing. Run `npm run build:cli` first.")
    process.exitCode = 1
  } else {
    throw err
  }
}

function missingBundle(err) {
  return "code" in err && err.code === "ERR_MODULE_NOT_FOUND"
}
