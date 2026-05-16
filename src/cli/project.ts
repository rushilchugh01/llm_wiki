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

export async function createProject(parentDir: string, name: string): Promise<CreatedProject> {
  assertCli(name.trim().length > 0, "Project name is required.")
  const root = path.resolve(parentDir, name)
  assertCli(!(await exists(root)), `Directory already exists: ${root}`)
  for (const dir of PROJECT_DIRS) await fs.mkdir(path.join(root, dir), { recursive: true })
  await writeInitialFiles(root)
  await writeDefaultConfig(root)
  return { name, path: root.replace(/\\/g, "/") }
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
