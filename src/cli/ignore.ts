import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { NOOP_DEBUG, type DebugReporter } from "./debug"
import { assertCli } from "./errors"

export interface WalkOptions {
  recursive: boolean
  include?: string[]
  exclude?: string[]
}

const BUILTIN_IGNORES = new Set([
  ".git",
  ".llm-wiki",
  ".obsidian",
  "raw",
  "wiki",
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  ".nuxt",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Cargo.lock",
])

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
])

const BROAD_HOME_DIRS = new Set([
  "desktop",
  "documents",
  "downloads",
  "dropbox",
  "google drive",
  "icloud drive",
  "my drive",
  "onedrive",
])

export async function collectFiles(
  sourcePath: string,
  options: WalkOptions,
  debug: DebugReporter = NOOP_DEBUG,
): Promise<string[]> {
  const root = path.resolve(sourcePath)
  const rootStat = await fs.lstat(root)
  assertCli(!rootStat.isSymbolicLink(), `Refusing to ingest symbolic link source: ${root}`)
  assertCli(samePath(await fs.realpath(root), root), `Refusing to ingest source through symbolic link path: ${root}`)
  assertCli(
    !isBroadSourceDirectory(root, rootStat.isDirectory()),
    `Refusing to ingest broad source directory: ${root}. Choose a narrower subfolder.`,
  )
  const gitignore = await loadGitignore(root)
  const out: string[] = []
  debug.event("scan_start", { path: root, recursive: options.recursive })
  await collect(root, root, options, gitignore, out, debug)
  debug.event("scan_done", { path: root, fileCount: out.length })
  return out.sort()
}

export function shouldSkip(
  entryName: string,
  relativePath: string,
  gitignore: string[],
  options: WalkOptions,
): boolean {
  if (BUILTIN_IGNORES.has(entryName)) return true
  if (options.exclude?.some((pattern) => relativePath.includes(pattern))) return true
  if (gitignore.some((pattern) => matchesPattern(relativePath, entryName, pattern))) return true
  return false
}

export function isTextFile(filePath: string, includes: string[] = []): boolean {
  if (includes.some((pattern) => filePath.includes(pattern))) return true
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export function isBroadSourceDirectory(
  sourcePath: string,
  isDirectory = true,
  homeDir = os.homedir(),
): boolean {
  if (!isDirectory) return false
  const root = path.resolve(sourcePath)
  if (root === path.parse(root).root) return true
  if (samePath(root, homeDir)) return true
  if (isHomeDumpDir(root, homeDir)) return true
  return isMountedDriveRoot(root)
}

export async function loadGitignore(root: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(root, ".gitignore"), "utf8")
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(isActivePattern)
  } catch {
    return []
  }
}

function isActivePattern(line: string): boolean {
  return line.length > 0 && !line.startsWith("#") && !line.startsWith("!")
}

async function collect(
  current: string,
  root: string,
  options: WalkOptions,
  gitignore: string[],
  out: string[],
  debug: DebugReporter,
): Promise<void> {
  const stat = await fs.stat(current)
  if (stat.isFile()) {
    const rel = path.relative(root, current).replace(/\\/g, "/")
    if (!shouldIncludeFile(current, rel, options.include)) return
    if (shouldSkip(path.basename(current), rel, gitignore, options)) {
      debug.event("scan_skip", { path: current, reason: "ignored" })
      return
    }
    debug.event("scan_file", { path: current })
    out.push(current)
    return
  }
  if (!stat.isDirectory()) return
  const entries = await fs.readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(current, entry.name)
    const rel = path.relative(root, full).replace(/\\/g, "/")
    if (entry.isSymbolicLink()) {
      debug.event("scan_skip", { path: full, reason: "symlink" })
      continue
    }
    if (shouldSkip(entry.name, rel, gitignore, options)) {
      debug.event("scan_skip", { path: full, reason: "ignored" })
      continue
    }
    if (entry.isDirectory() && !options.recursive) {
      debug.event("scan_skip", { path: full, reason: "not-recursive" })
      continue
    }
    await collect(full, root, options, gitignore, out, debug)
  }
}

function matchesPattern(relativePath: string, entryName: string, pattern: string): boolean {
  const cleaned = pattern.replace(/^\//, "").replace(/\/$/, "")
  if (!cleaned) return false
  if (cleaned.includes("*")) return wildcardMatch(relativePath, cleaned)
  return relativePath === cleaned || relativePath.startsWith(`${cleaned}/`) || entryName === cleaned
}

function shouldIncludeFile(filePath: string, relativePath: string, includes: string[] = []): boolean {
  if (!isTextFile(filePath)) return false
  return includes.length === 0 || includes.some((pattern) => relativePath.includes(pattern))
}

function wildcardMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`).test(value)
}

function isHomeDumpDir(sourcePath: string, homeDir: string): boolean {
  const parent = path.dirname(sourcePath)
  const name = path.basename(sourcePath).toLowerCase()
  return samePath(parent, homeDir) && BROAD_HOME_DIRS.has(name)
}

function isMountedDriveRoot(sourcePath: string): boolean {
  const parent = path.dirname(sourcePath)
  const parentName = path.basename(parent).toLowerCase()
  const grandparent = path.dirname(parent)
  if (["/mnt", "/media", "/volumes"].some((dir) => samePath(parent, dir))) return true
  return parentName === os.userInfo().username.toLowerCase() && samePath(grandparent, "/run/media")
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}
