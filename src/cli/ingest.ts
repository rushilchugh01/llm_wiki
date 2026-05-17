import fs from "node:fs/promises"
import path from "node:path"
import { streamChat, type ChatMessage } from "../lib/llm-client"
import type { CliConfig, CliLlmConfig } from "./config"
import { NOOP_DEBUG, type DebugReporter } from "./debug"
import { assertCli } from "./errors"
import { collectFiles } from "./ignore"

export interface IngestOptions {
  dryRun: boolean
  recursive: boolean
  include?: string[]
  exclude?: string[]
  ignorePaths?: string[]
  maxFiles?: number
  maxBytes?: number
  maxFileBytes?: number
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
  debug: DebugReporter = NOOP_DEBUG,
): Promise<IngestReport> {
  const files = await collectFiles(sourcePath, options, debug)
  await assertWithinIngestLimits(files, options)
  if (options.dryRun) {
    debug.event("ingest_done", { fileCount: files.length, writtenCount: 0, dryRun: true })
    return { files, written: [], dryRun: true }
  }
  assertCli(files.length > 0, "No ingestable text files found.")
  assertUsableLlm(config.llm)
  const written: string[] = []
  const sourceRoot = await sourceCopyRoot(sourcePath)
  for (const file of files) {
    written.push(...await ingestFile(projectPath, file, config.llm, chat, debug, sourceRoot))
  }
  debug.event("ingest_done", { fileCount: files.length, writtenCount: written.length, dryRun: false })
  return { files, written, dryRun: false }
}

export async function ingestFile(
  projectPath: string,
  sourceFile: string,
  llm: CliLlmConfig,
  chat: ChatFn,
  debug: DebugReporter = NOOP_DEBUG,
  sourceRoot?: string,
): Promise<string[]> {
  const content = await fs.readFile(sourceFile, "utf8")
  await copySource(projectPath, sourceFile, sourceRoot)
  debug.event("llm_start", { file: sourceFile, provider: llm.provider, model: llm.model })
  const response = await chat(llm, buildIngestMessages(sourceFile, content))
  debug.event("llm_done", { file: sourceFile, bytes: response.length })
  const blocks = parseFileBlocks(response)
  assertCompleteFileBlocks(response, blocks.length, sourceFile)
  return writeFileBlocks(projectPath, blocks, debug)
}

export function parseFileBlocks(response: string): Array<{ path: string; content: string }> {
  const blocks: Array<{ path: string; content: string }> = []
  const regex = /^---\s*FILE:\s*(.+?)\s*---\s*$([\s\S]*?)^---\s*END\s+FILE\s*---\s*$/gim
  for (const match of response.matchAll(regex)) {
    blocks.push({ path: match[1].trim(), content: match[2].trimStart() })
  }
  return blocks
}

export function assertCompleteFileBlocks(response: string, blockCount: number, sourceFile: string): void {
  assertCli(blockCount > 0, `LLM response for ${sourceFile} did not contain any FILE blocks.`)
  const fileMarkers = [...response.matchAll(/^---\s*FILE:\s*.+?\s*---\s*$/gim)].length
  const endMarkers = [...response.matchAll(/^---\s*END\s+FILE\s*---\s*$/gim)].length
  assertCli(
    fileMarkers === endMarkers && blockCount === fileMarkers,
    `LLM response for ${sourceFile} contained an incomplete FILE block.`,
  )
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
  debug: DebugReporter = NOOP_DEBUG,
): Promise<string[]> {
  const written: string[] = []
  for (const block of blocks) {
    debug.event("file_block", { path: block.path, bytes: block.content.length })
    const target = safeProjectPath(projectPath, block.path)
    await assertNoSymlinkInExistingPath(path.resolve(projectPath), target)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, block.content)
    debug.event("write", { path: target, bytes: block.content.length })
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
  if (!["ollama", "custom", "claude-code", "codex-cli"].includes(llm.provider)) {
    assertCli(llm.apiKey.trim().length > 0, `API key is required for ${llm.provider}.`)
  }
  if (llm.provider === "custom") {
    assertCli(llm.customEndpoint.trim().length > 0, "Custom provider requires baseUrl.")
  }
}

export async function assertWithinIngestLimits(files: string[], options: IngestOptions): Promise<void> {
  const maxFiles = options.maxFiles ?? Number.POSITIVE_INFINITY
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY
  const maxFileBytes = options.maxFileBytes ?? Number.POSITIVE_INFINITY
  assertCli(
    files.length <= maxFiles,
    `Matched ${files.length} files; limit is ${maxFiles}. Use --max-files to raise it.`,
  )
  let totalBytes = 0
  for (const file of files) {
    const size = (await fs.stat(file)).size
    assertCli(
      size <= maxFileBytes,
      `${file} is ${size} bytes; limit is ${maxFileBytes}. Use --max-file-bytes to raise it.`,
    )
    totalBytes += size
  }
  assertCli(
    totalBytes <= maxBytes,
    `Matched ${totalBytes} bytes; limit is ${maxBytes}. Use --max-bytes to raise it.`,
  )
}

function safeProjectPath(projectPath: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/")
  assertCli(
    !path.isAbsolute(normalized) && !path.win32.isAbsolute(normalized),
    `Refusing absolute output path: ${relativePath}`,
  )
  assertCli(normalized.startsWith("wiki/"), `Output path must live under wiki/: ${relativePath}`)
  assertCli(!normalized.split("/").includes(".."), `Output path must not contain traversal: ${relativePath}`)
  const target = path.resolve(projectPath, normalized)
  assertCli(isInsideDir(path.resolve(projectPath), target), `Output path escapes project: ${relativePath}`)
  return target
}

function isInsideDir(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

async function sourceCopyRoot(sourcePath: string): Promise<string> {
  const resolved = path.resolve(sourcePath)
  return (await fs.stat(resolved)).isDirectory() ? resolved : path.dirname(resolved)
}

async function copySource(projectPath: string, sourceFile: string, sourceRoot?: string): Promise<void> {
  const root = sourceRoot ?? path.dirname(path.resolve(sourceFile))
  const rel = path.relative(root, sourceFile) || path.basename(sourceFile)
  const target = path.resolve(projectPath, "raw", "sources", rel)
  const rawRoot = path.resolve(projectPath, "raw", "sources")
  assertCli(
    isInsideDir(rawRoot, target),
    `Source copy escapes project: ${sourceFile}`,
  )
  await assertNoSymlinkInExistingPath(path.resolve(projectPath), target)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(sourceFile, target)
}

async function assertNoSymlinkInExistingPath(root: string, target: string): Promise<void> {
  assertCli(isInsideDir(root, target), `Path escapes project: ${target}`)
  let current = root
  await assertNotSymlink(current)
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try {
      await assertNotSymlink(current)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return
      throw err
    }
  }
}

async function assertNotSymlink(filePath: string): Promise<void> {
  assertCli(
    !(await fs.lstat(filePath)).isSymbolicLink(),
    `Refusing to write through symbolic link: ${filePath}`,
  )
}
