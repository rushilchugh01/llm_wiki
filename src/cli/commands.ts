import path from "node:path"
import { loadConfig, type ConfigOverrides } from "./config"
import { createProject, validateProject } from "./project"
import { ingestPath, type IngestOptions } from "./ingest"
import { buildSearchJson, searchPages } from "./search"
import { pageToJson, resolvePage } from "./pages"
import { lintProject } from "./lint"
import { CliError, assertCli } from "./errors"
import { NOOP_DEBUG, createDebugReporter, type DebugReporter } from "./debug"

export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

export interface ParsedArgs {
  command: string
  positionals: string[]
  flags: Record<string, string | boolean>
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv)
  const debug = createDebugReporter(Boolean(args.flags.debug), io.stderr)
  try {
    const result = await dispatch(args, debug)
    if (result !== undefined) io.stdout(formatResult(result, Boolean(args.flags.json)))
    return 0
  } catch (err) {
    const code = err instanceof CliError ? err.exitCode : 1
    io.stderr(err instanceof Error ? err.message : String(err))
    return code
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  let command = "help"
  let hasCommand = false
  const flags: Record<string, string | boolean> = {}
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]
    if (!item.startsWith("--")) {
      if (hasCommand) {
        positionals.push(item)
      } else {
        command = item
        hasCommand = true
      }
      continue
    }
    const [key, inlineValue] = item.slice(2).split("=", 2)
    const next = argv[i + 1]
    if (inlineValue !== undefined) {
      flags[key] = inlineValue
    } else if (booleanFlag(key) || !next || next.startsWith("--")) {
      flags[key] = true
    } else {
      flags[key] = next
      i++
    }
  }
  return { command, positionals, flags }
}

export async function dispatch(args: ParsedArgs, debug = NOOP_DEBUG): Promise<unknown> {
  if (args.command === "help") return helpText()
  if (args.command === "create") return createCommand(args)
  if (args.command === "ingest") return ingestCommand(args, debug)
  if (args.command === "search") return searchCommand(args)
  if (args.command === "view") return viewCommand(args)
  if (args.command === "lint") return lintCommand(args)
  throw new CliError(`Unknown command: ${args.command}`)
}

export function formatResult(result: unknown, json: boolean): string {
  if (typeof result === "string") return result
  return json ? JSON.stringify(result, null, 2) : humanize(result)
}

function createCommand(args: ParsedArgs): Promise<unknown> {
  const parent = args.positionals[0]
  const name = stringFlag(args, "name")
  assertCli(parent, "Usage: llm-wiki create <parent-dir> --name <name>")
  assertCli(name, "Usage: llm-wiki create <parent-dir> --name <name>")
  return createProject(parent, name)
}

async function ingestCommand(args: ParsedArgs, debug: DebugReporter): Promise<unknown> {
  const [project, source] = args.positionals
  assertCli(project && source, "Usage: llm-wiki ingest <project> <path>")
  await validateProject(project)
  const config = await loadConfig(project, process.env, configOverrides(args))
  const options: IngestOptions = {
    dryRun: Boolean(args.flags["dry-run"]),
    recursive: recursiveFlag(args, config.ingest.recursiveByDefault),
    include: listFlag(args, "include"),
    exclude: listFlag(args, "exclude"),
    maxFiles: numberFlag(args, "max-files", config.ingest.maxFiles),
    maxBytes: numberFlag(args, "max-bytes", config.ingest.maxBytes),
    maxFileBytes: numberFlag(args, "max-file-bytes", config.ingest.maxFileBytes),
  }
  return ingestPath(project, source, config, options, undefined, debug)
}

async function searchCommand(args: ParsedArgs): Promise<unknown> {
  const [project, ...queryParts] = args.positionals
  const query = queryParts.join(" ")
  assertCli(project && query, "Usage: llm-wiki search <project> <query>")
  await validateProject(project)
  const config = await loadConfig(project)
  const limit = numberFlag(args, "limit", config.search.defaultLimit)
  const types = listFlag(args, "type")
  return buildSearchJson(query, await searchPages(project, query, limit, types))
}

async function viewCommand(args: ParsedArgs): Promise<unknown> {
  const [project, ref] = args.positionals
  assertCli(project && ref, "Usage: llm-wiki view <project> <page-or-slug>")
  await validateProject(project)
  const page = await resolvePage(project, ref)
  return args.flags.json ? pageToJson(page) : page.content
}

async function lintCommand(args: ParsedArgs): Promise<unknown> {
  const [project] = args.positionals
  assertCli(project, "Usage: llm-wiki lint <project>")
  await validateProject(project)
  return { results: await lintProject(project) }
}

function helpText(): string {
  return [
    "llm-wiki create <parent-dir> --name <name>",
    "llm-wiki ingest <project> <path> [--dry-run] [--recursive] [--no-recursive] [--debug]",
    "  [--max-files 500] [--max-bytes 26214400] [--max-file-bytes 2097152]",
    "  [--provider custom] [--base-url <url>] [--api-key <key>] [--model <model>] [--reasoning off]",
    "llm-wiki search <project> <query> [--limit 10] [--type entity,concept] [--json]",
    "llm-wiki view <project> <page-or-slug> [--json]",
    "llm-wiki lint <project> [--json]",
  ].join("\n")
}

function humanize(result: unknown): string {
  if (Array.isArray(result)) return result.map((item) => JSON.stringify(item)).join("\n")
  if (typeof result === "object" && result) return JSON.stringify(result, null, 2)
  return String(result)
}

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name]
  return typeof value === "string" ? value : undefined
}

function numberFlag(args: ParsedArgs, name: string, fallback: number): number {
  const value = stringFlag(args, name)
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  assertCli(
    Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === value,
    `--${name} must be a positive integer.`,
  )
  return parsed
}

function listFlag(args: ParsedArgs, name: string): string[] {
  const value = stringFlag(args, name)
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : []
}

function booleanFlag(name: string): boolean {
  return ["debug", "dry-run", "json", "no-recursive", "recursive"].includes(name)
}

function recursiveFlag(args: ParsedArgs, fallback: boolean): boolean {
  if (args.flags["no-recursive"]) return false
  if (args.flags.recursive) return true
  return fallback
}

function configOverrides(args: ParsedArgs): ConfigOverrides {
  return {
    provider: stringFlag(args, "provider"),
    apiKey: stringFlag(args, "api-key"),
    model: stringFlag(args, "model"),
    baseUrl: stringFlag(args, "base-url"),
    reasoning: stringFlag(args, "reasoning"),
  }
}

export function projectNameFromPath(projectPath: string): string {
  return path.basename(path.resolve(projectPath))
}
