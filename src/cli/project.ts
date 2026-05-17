import fs from "node:fs/promises"
import path from "node:path"
import { assertCli } from "./errors"
import { writeDefaultConfig } from "./config"

export interface CreatedProject {
  name: string
  path: string
}

const PROJECT_DIRS = [
  "raw/sources",
  "raw/assets",
  "wiki/entities",
  "wiki/concepts",
  "wiki/sources",
  "wiki/queries",
  "wiki/comparisons",
  "wiki/synthesis",
  ".obsidian",
]

const PROJECT_FILES = [
  "schema.md",
  "purpose.md",
  "wiki/index.md",
  "wiki/log.md",
  "wiki/overview.md",
  ".obsidian/app.json",
  ".obsidian/core-plugins.json",
  ".llm-wiki/config.json",
]

export const PROJECT_INGEST_IGNORE_PATHS = [
  "schema.md",
  "purpose.md",
  "raw",
  "wiki",
  ".llm-wiki",
  ".obsidian",
]

export async function createProject(parentDir: string, name: string): Promise<CreatedProject> {
  assertCli(name.trim().length > 0, "Project name is required.")
  return createProjectAt(path.resolve(parentDir, name), name)
}

export async function createProjectAt(projectDir: string, name = path.basename(path.resolve(projectDir))): Promise<CreatedProject> {
  assertCli(name.trim().length > 0, "Project name is required.")
  const root = path.resolve(projectDir)
  assertCli(!(await exists(root)), `Directory already exists: ${root}`)
  return initializeProjectAt(root, name)
}

export async function ensureProject(projectDir: string): Promise<void> {
  try {
    await validateProject(projectDir)
    return
  } catch {
    // Fall through and initialize only when the destination is clearly unused.
  }
  const root = path.resolve(projectDir)
  if (await exists(root)) {
    const stat = await fs.stat(root)
    assertCli(stat.isDirectory(), `Project destination is not a directory: ${root}`)
    await assertNoProjectFileConflicts(root)
  }
  await initializeProjectAt(root)
}

async function initializeProjectAt(root: string, name = path.basename(root)): Promise<CreatedProject> {
  for (const dir of PROJECT_DIRS) await fs.mkdir(path.join(root, dir), { recursive: true })
  await writeInitialFiles(root)
  await writeDefaultConfig(root)
  return { name, path: root.replace(/\\/g, "/") }
}

export function projectIngestIgnorePaths(projectPath: string): string[] {
  const root = path.resolve(projectPath)
  return PROJECT_INGEST_IGNORE_PATHS.map((rel) => path.join(root, rel))
}

export async function validateProject(projectPath: string): Promise<void> {
  const root = path.resolve(projectPath)
  assertCli(await exists(path.join(root, "schema.md")), `Not an LLM Wiki project: ${root}`)
  assertCli(await exists(path.join(root, "wiki", "index.md")), `Missing wiki/index.md: ${root}`)
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function assertNoProjectFileConflicts(root: string): Promise<void> {
  for (const rel of PROJECT_FILES) {
    const target = path.join(root, rel)
    assertCli(!(await exists(target)), `Project destination already contains generated file path: ${target}`)
  }
}

async function writeInitialFiles(root: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  await Promise.all([
    fs.writeFile(path.join(root, "schema.md"), schemaMarkdown()),
    fs.writeFile(path.join(root, "purpose.md"), purposeMarkdown()),
    fs.writeFile(path.join(root, "wiki", "index.md"), indexMarkdown()),
    fs.writeFile(path.join(root, "wiki", "log.md"), logMarkdown(today)),
    fs.writeFile(path.join(root, "wiki", "overview.md"), overviewMarkdown()),
    fs.writeFile(path.join(root, ".obsidian", "app.json"), obsidianAppJson()),
    fs.writeFile(path.join(root, ".obsidian", "core-plugins.json"), obsidianPluginsJson()),
  ])
}

function schemaMarkdown(): string {
  return `# Wiki Schema

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
| entity | wiki/entities/ | Named things |
| concept | wiki/concepts/ | Ideas and techniques |
| source | wiki/sources/ | Papers, articles, talks, blog posts |
| query | wiki/queries/ | Open questions under investigation |
| comparison | wiki/comparisons/ | Side-by-side analysis |
| synthesis | wiki/synthesis/ | Cross-cutting summaries |

All pages must include YAML frontmatter with type, title, tags, related, created, and updated.
Use [[page-slug]] links between wiki pages.
`
}

function purposeMarkdown(): string {
  return `# Project Purpose

## Goal

## Key Questions

1.
2.
3.
`
}

function indexMarkdown(): string {
  return `# Wiki Index

## Entities

## Concepts

## Sources

## Queries

## Comparisons

## Synthesis
`
}

function logMarkdown(today: string): string {
  return `# Research Log

## ${today}

- Project created
`
}

function overviewMarkdown(): string {
  return `---
type: overview
title: Project Overview
tags: []
related: []
---

# Overview
`
}

function obsidianAppJson(): string {
  return `${JSON.stringify({
    attachmentFolderPath: "raw/assets",
    userIgnoreFilters: [".cache", ".llm-wiki", ".superpowers"],
    useMarkdownLinks: false,
    newLinkFormat: "shortest",
  }, null, 2)}\n`
}

function obsidianPluginsJson(): string {
  return `${JSON.stringify({
    "file-explorer": true,
    "global-search": true,
    graph: true,
    backlink: true,
    "page-preview": true,
    "outgoing-link": true,
  }, null, 2)}\n`
}
