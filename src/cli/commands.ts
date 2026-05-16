import path from "node:path"
import { loadConfig, type ConfigOverrides } from "./config"
import { createProject, validateProject } from "./project"
import { ingestPath, type IngestOptions } from "./ingest"
import { buildSearchJson, searchPages } from "./search"
import { pageToJson, resolvePage } from "./pages"
import { lintProject } from "./lint"
import { CliError, assertCli } from "./errors"

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
  try {
    const args = parseArgs(argv)
    const result = await dispatch(args)
    if (result !== undefined) io.stdout(formatResult(result, Boolean(args.flags.json)))
    return 0
  } catch (err) {
    const code = err instanceof CliError ? err.exitCode : 1
    io.stderr(err instanceof Error ? err.message : String(err))
    return code
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv
  const flags: Record<string, string | boolean> = {}
  const positionals: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const item = rest[i]
    if (!item.startsWith("--")) {
      positionals.push(item)
      continue
    }
    const key = item.slice(2)
    const next = rest[i + 1]
    if (next && !next.startsWith("--")) {
      flags[key] = next
      i++
    } else {
      flags[key] = true
    }
  }
  return { command, positionals, flags }
}

export async function dispatch(args: ParsedArgs): Promise<unknown> {
  if (args.command === "help") return helpText()
  if (args.command === "create") return createCommand(args)
  if (args.command === "ingest") return ingestCommand(args)
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

async function ingestCommand(args: ParsedArgs): Promise<unknown> {
  const [project, source] = args.positionals
  assertCli(project && source, "Usage: llm-wiki ingest <project> <path>")
  await validateProject(project)
  const config = await loadConfig(project, process.env, configOverrides(args))
  const options: IngestOptions = {
    dryRun: Boolean(args.flags["dry-run"]),
    yes: Boolean(args.flags.yes),
    recursive: !args.flags["no-recursive"],
    include: listFlag(args, "include"),
    exclude: listFlag(args, "exclude"),
  }
  return ingestPath(project, source, config, options)
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
    "llm-wiki ingest <project> <path> [--dry-run] [--yes] [--no-recursive]",
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
  return value ? Number.parseInt(value, 10) : fallback
}

function listFlag(args: ParsedArgs, name: string): string[] {
  const value = stringFlag(args, name)
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : []
}

function configOverrides(args: ParsedArgs): ConfigOverrides {
  return {
    provider: stringFlag(args, "provider") as ConfigOverrides["provider"],
    apiKey: stringFlag(args, "api-key"),
    model: stringFlag(args, "model"),
    baseUrl: stringFlag(args, "base-url"),
    reasoning: stringFlag(args, "reasoning") as ConfigOverrides["reasoning"],
  }
}

export function projectNameFromPath(projectPath: string): string {
  return path.basename(path.resolve(projectPath))
}
