import fs from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import { parseFrontmatter } from "../lib/frontmatter"
import { assertCli } from "./errors"

export interface WikiPage {
  path: string
  relativePath: string
  slug: string
  title: string
  type: string
  frontmatter: Record<string, unknown>
  content: string
  body: string
}

const PAGE_DIRS = ["", "entities", "concepts", "sources", "queries", "comparisons", "synthesis"]

export async function listWikiPages(projectPath: string): Promise<WikiPage[]> {
  const root = path.resolve(projectPath, "wiki")
  const files = await walkMarkdown(root)
  const pages = await Promise.all(files.map((filePath) => readWikiPage(root, filePath)))
  return pages.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export async function readWikiPage(wikiRoot: string, filePath: string): Promise<WikiPage> {
  const content = await fs.readFile(filePath, "utf8")
  const parsed = parseFrontmatter(content)
  const relativePath = path.relative(wikiRoot, filePath).replace(/\\/g, "/")
  const slug = path.basename(filePath, ".md")
  const fm = (parsed.frontmatter ?? {}) as Record<string, unknown>
  return {
    path: filePath,
    relativePath,
    slug,
    title: stringField(fm.title) ?? firstHeading(parsed.body) ?? slug,
    type: stringField(fm.type) ?? inferType(relativePath),
    frontmatter: fm,
    content,
    body: parsed.body,
  }
}

export async function resolvePage(projectPath: string, ref: string): Promise<WikiPage> {
  const root = path.resolve(projectPath, "wiki")
  assertCli(!isAbsoluteRef(ref), `Page reference must stay inside wiki/: ${ref}`)
  const normalized = normalizeRef(ref)
  const direct = await resolveDirectPage(projectPath, normalized)
  if (direct) return readWikiPage(root, direct)
  const pages = await listWikiPages(projectPath)
  const lowered = normalized
  const found = pages.find((p) =>
    normalizeRef(p.slug) === lowered || normalizeRef(p.relativePath) === lowered
  )
  assertCli(found, `Page not found: ${ref}`)
  return found
}

export function normalizeRef(ref: string): string {
  return ref
    .replace(/\\/g, "/")
    .split("#")[0]
    .replace(/^wiki\//, "")
    .replace(/\.md$/, "")
    .toLowerCase()
}

export function pageToJson(page: WikiPage): Record<string, unknown> {
  return {
    path: page.path,
    relativePath: page.relativePath,
    slug: page.slug,
    title: page.title,
    type: page.type,
    frontmatter: page.frontmatter,
    content: page.content,
  }
}

async function walkMarkdown(root: string): Promise<string[]> {
  const out: string[] = []
  await walk(root, out)
  return out
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    if (entry.isFile() && entry.name.endsWith(".md")) out.push(full)
  }
}

async function resolveDirectPage(projectPath: string, ref: string): Promise<string | null> {
  const candidates = candidatePaths(projectPath, ref)
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) return candidate
    } catch {
      continue
    }
  }
  return null
}

function candidatePaths(projectPath: string, ref: string): string[] {
  const normalized = ref.replace(/\\/g, "/")
  const withExt = normalized.endsWith(".md") ? normalized : `${normalized}.md`
  const root = path.resolve(projectPath, "wiki")
  return PAGE_DIRS
    .map((dir) => path.resolve(root, dir, withExt))
    .filter((candidate) => isInsideDir(root, candidate))
}

function isAbsoluteRef(ref: string): boolean {
  return path.isAbsolute(ref) || path.win32.isAbsolute(ref)
}

function isInsideDir(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function inferType(relativePath: string): string {
  const dir = relativePath.split("/")[0]
  if (dir === "entities") return "entity"
  if (dir === "concepts") return "concept"
  if (dir === "sources") return "source"
  if (dir === "queries") return "query"
  if (dir === "comparisons") return "comparison"
  if (dir === "synthesis") return "synthesis"
  return "unknown"
}

function firstHeading(body: string): string | null {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
