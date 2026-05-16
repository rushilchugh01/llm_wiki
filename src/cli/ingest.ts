import fs from "node:fs/promises"
import path from "node:path"
import { streamChat, type ChatMessage } from "../lib/llm-client"
import type { CliConfig, CliLlmConfig } from "./config"
import { assertCli } from "./errors"
import { collectFiles } from "./ignore"

export interface IngestOptions {
  dryRun: boolean
  yes: boolean
  recursive: boolean
  include?: string[]
  exclude?: string[]
}

export interface IngestReport {
  files: string[]
  written: string[]
  dryRun: boolean
}

export type ChatFn = (
  config: CliLlmConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
) => Promise<string>

export async function ingestPath(
  projectPath: string,
  sourcePath: string,
  config: CliConfig,
  options: IngestOptions,
  chat: ChatFn = callStreamChat,
): Promise<IngestReport> {
  const files = await collectFiles(sourcePath, options)
  if (options.dryRun) return { files, written: [], dryRun: true }
  assertCli(files.length > 0, "No ingestable text files found.")
  assertCli(
    options.yes || files.length <= config.ingest.maxFilesWithoutYes,
    `Matched ${files.length} files. Re-run with --yes to ingest them.`,
  )
  assertUsableLlm(config.llm)
  const written: string[] = []
  for (const file of files) written.push(...await ingestFile(projectPath, file, config.llm, chat))
  return { files, written, dryRun: false }
}

export async function ingestFile(
  projectPath: string,
  sourceFile: string,
  llm: CliLlmConfig,
  chat: ChatFn,
): Promise<string[]> {
  const content = await fs.readFile(sourceFile, "utf8")
  await copySource(projectPath, sourceFile)
  const response = await chat(llm, buildIngestMessages(sourceFile, content))
  return writeFileBlocks(projectPath, parseFileBlocks(response))
}

export function parseFileBlocks(response: string): Array<{ path: string; content: string }> {
  const blocks: Array<{ path: string; content: string }> = []
  const regex = /^---\s*FILE:\s*(.+?)\s*---\s*$([\s\S]*?)^---\s*END\s+FILE\s*---\s*$/gim
  for (const match of response.matchAll(regex)) {
    blocks.push({ path: match[1].trim(), content: match[2].trimStart() })
  }
  return blocks
}

export function buildIngestMessages(sourceFile: string, content: string): ChatMessage[] {
  const fileName = path.basename(sourceFile)
  const prompt = [
    `Ingest source file: ${fileName}`,
    "",
    "Create or update LLM Wiki markdown pages.",
    "Output only FILE blocks like:",
    "---FILE: wiki/sources/example.md---",
    "---",
    "type: source",
    "title: Example",
    "tags: []",
    "related: []",
    "---",
    "# Example",
    "---END FILE---",
    "",
    "Source content:",
    "```",
    content,
    "```",
  ].join("\n")
  return [{ role: "user", content: prompt }]
}

export async function writeFileBlocks(
  projectPath: string,
  blocks: Array<{ path: string; content: string }>,
): Promise<string[]> {
  const written: string[] = []
  for (const block of blocks) {
    const target = safeProjectPath(projectPath, block.path)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, block.content)
    written.push(target)
  }
  return written
}

export async function callStreamChat(
  config: CliLlmConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  let out = ""
  let error: Error | null = null
  await streamChat(config, messages, {
    onToken: (token) => { out += token },
    onDone: () => {},
    onError: (err) => { error = err },
  }, signal)
  if (error) throw error
  return out
}

export function assertUsableLlm(llm: CliLlmConfig): void {
  assertCli(llm.model.trim().length > 0, "LLM model is required in config or env.")
  if (!["ollama", "custom"].includes(llm.provider)) {
    assertCli(llm.apiKey.trim().length > 0, `API key is required for ${llm.provider}.`)
  }
  if (llm.provider === "custom") {
    assertCli(llm.customEndpoint.trim().length > 0, "Custom provider requires baseUrl.")
  }
}

function safeProjectPath(projectPath: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/")
  assertCli(!path.isAbsolute(normalized), `Refusing absolute output path: ${relativePath}`)
  assertCli(normalized.startsWith("wiki/"), `Output path must live under wiki/: ${relativePath}`)
  const target = path.resolve(projectPath, normalized)
  assertCli(target.startsWith(path.resolve(projectPath)), `Output path escapes project: ${relativePath}`)
  return target
}

async function copySource(projectPath: string, sourceFile: string): Promise<void> {
  const target = path.join(projectPath, "raw", "sources", path.basename(sourceFile))
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(sourceFile, target)
}
