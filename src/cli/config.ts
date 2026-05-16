import fs from "node:fs/promises"
import path from "node:path"

export type CliProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "ollama"
  | "custom"
  | "minimax"

export type CliReasoning = "auto" | "off" | "low" | "medium" | "high" | "max"

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
    maxFilesWithoutYes: number
  }
  search: {
    defaultLimit: number
  }
}

export interface ConfigOverrides {
  provider?: CliProvider
  apiKey?: string
  model?: string
  baseUrl?: string
  reasoning?: CliReasoning
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
    maxFilesWithoutYes: 50,
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
    provider: env.LLM_WIKI_PROVIDER as CliProvider | undefined,
    apiKey: env.LLM_WIKI_API_KEY,
    model: env.LLM_WIKI_MODEL,
    baseUrl: env.LLM_WIKI_BASE_URL,
    reasoning: env.LLM_WIKI_REASONING as CliReasoning | undefined,
  })
}

export function applyOverrides(config: CliConfig, overrides: ConfigOverrides): CliConfig {
  const llm = { ...config.llm }
  if (overrides.provider) llm.provider = overrides.provider
  if (overrides.apiKey !== undefined) llm.apiKey = overrides.apiKey
  if (overrides.model !== undefined) llm.model = overrides.model
  if (overrides.reasoning) llm.reasoning = { mode: overrides.reasoning }
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
    throw err
  }
}

export async function writeDefaultConfig(projectPath: string): Promise<void> {
  const filePath = configPath(projectPath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`)
}
