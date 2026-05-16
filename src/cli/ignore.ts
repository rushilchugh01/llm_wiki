import fs from "node:fs/promises"
import path from "node:path"

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

export async function collectFiles(sourcePath: string, options: WalkOptions): Promise<string[]> {
  const root = path.resolve(sourcePath)
  const gitignore = await loadGitignore(root)
  const out: string[] = []
  await collect(root, root, options, gitignore, out)
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
): Promise<void> {
  const stat = await fs.stat(current)
  if (stat.isFile() && isTextFile(current, options.include)) {
    if (shouldSkip(path.basename(current), path.relative(root, current), gitignore, options)) return
    out.push(current)
    return
  }
  if (!stat.isDirectory()) return
  const entries = await fs.readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(current, entry.name)
    const rel = path.relative(root, full).replace(/\\/g, "/")
    if (shouldSkip(entry.name, rel, gitignore, options)) continue
    if (entry.isDirectory() && !options.recursive) continue
    await collect(full, root, options, gitignore, out)
  }
}

function matchesPattern(relativePath: string, entryName: string, pattern: string): boolean {
  const cleaned = pattern.replace(/^\//, "").replace(/\/$/, "")
  if (!cleaned) return false
  if (cleaned.includes("*")) return wildcardMatch(relativePath, cleaned)
  return relativePath === cleaned || relativePath.startsWith(`${cleaned}/`) || entryName === cleaned
}

function wildcardMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`).test(value)
}
