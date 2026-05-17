import fs from "node:fs/promises"
import path from "node:path"
import { assertCli, CliError } from "./errors"

export const CLI_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "ollama",
  "custom",
  "minimax",
  "claude-code",
  "codex-cli",
] as const

export const CLI_REASONING_MODES = ["auto", "off", "low", "medium", "high", "max"] as const

export type CliProvider = typeof CLI_PROVIDERS[number]
export type CliReasoning = typeof CLI_REASONING_MODES[number]

export interface CliLlmConfig {
  provider: CliProvider
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  maxContextSize: number
  apiMode?: "chat_completions" | "anthropic_messages"
  reasoning?: { mode: CliReasoning }
}

export interface CliConfig {
  llm: CliLlmConfig
  ingest: {
    recursiveByDefault: boolean
    maxFiles: number
    maxBytes: number
    maxFileBytes: number
  }
  search: {
    defaultLimit: number
  }
}

export interface ConfigOverrides {
  provider?: string
  apiKey?: string
  model?: string
  baseUrl?: string
  reasoning?: string
}

export const DEFAULT_CONFIG: CliConfig = {
  llm: {
    provider: "custom",
    apiKey: "",
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    maxContextSize: 204800,
    apiMode: "chat_completions",
    reasoning: { mode: "auto" },
  },
  ingest: {
    recursiveByDefault: true,
    maxFiles: 500,
    maxBytes: 25 * 1024 * 1024,
    maxFileBytes: 2 * 1024 * 1024,
  },
  search: {
    defaultLimit: 10,
  },
}

export function configPath(projectPath: string): string {
  return path.join(projectPath, ".llm-wiki", "config.json")
}

export function mergeConfig(base: CliConfig, patch: Partial<CliConfig>): CliConfig {
  return {
    llm: { ...base.llm, ...(patch.llm ?? {}) },
    ingest: { ...base.ingest, ...(patch.ingest ?? {}) },
    search: { ...base.search, ...(patch.search ?? {}) },
  }
}

export function applyEnv(config: CliConfig, env: NodeJS.ProcessEnv): CliConfig {
  return applyOverrides(config, {
    provider: env.LLM_WIKI_PROVIDER ? parseProvider(env.LLM_WIKI_PROVIDER, "LLM_WIKI_PROVIDER") : undefined,
    apiKey: env.LLM_WIKI_API_KEY,
    model: env.LLM_WIKI_MODEL,
    baseUrl: env.LLM_WIKI_BASE_URL,
    reasoning: env.LLM_WIKI_REASONING ? parseReasoning(env.LLM_WIKI_REASONING, "LLM_WIKI_REASONING") : undefined,
  })
}

export function applyOverrides(config: CliConfig, overrides: ConfigOverrides): CliConfig {
  const llm = { ...config.llm }
  if (overrides.provider) llm.provider = parseProvider(overrides.provider, "--provider")
  if (overrides.apiKey !== undefined) llm.apiKey = overrides.apiKey
  if (overrides.model !== undefined) llm.model = overrides.model
  if (overrides.reasoning) llm.reasoning = { mode: parseReasoning(overrides.reasoning, "--reasoning") }
  if (overrides.baseUrl !== undefined) applyBaseUrl(llm, overrides.baseUrl)
  return { ...config, llm }
}

export function applyBaseUrl(llm: CliLlmConfig, baseUrl: string): void {
  if (llm.provider === "ollama") {
    llm.ollamaUrl = baseUrl
  } else {
    llm.customEndpoint = baseUrl
  }
}

export async function loadConfig(
  projectPath: string,
  env: NodeJS.ProcessEnv = process.env,
  overrides: ConfigOverrides = {},
): Promise<CliConfig> {
  const fromDisk = await readConfigFile(configPath(projectPath))
  return applyOverrides(applyEnv(mergeConfig(DEFAULT_CONFIG, fromDisk), env), overrides)
}

export async function readConfigFile(filePath: string): Promise<Partial<CliConfig>> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<CliConfig>
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {}
    if (err instanceof SyntaxError) throw new CliError(`Invalid JSON config file: ${filePath}`)
    throw err
  }
}

export async function writeDefaultConfig(projectPath: string): Promise<void> {
  const filePath = configPath(projectPath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`)
}

function parseProvider(value: string, source: string): CliProvider {
  assertCli(CLI_PROVIDERS.includes(value as CliProvider), `${source} must be one of: ${CLI_PROVIDERS.join(", ")}`)
  return value as CliProvider
}

function parseReasoning(value: string, source: string): CliReasoning {
  assertCli(
    CLI_REASONING_MODES.includes(value as CliReasoning),
    `${source} must be one of: ${CLI_REASONING_MODES.join(", ")}`,
  )
  return value as CliReasoning
}
