#!/usr/bin/env node
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const CLI_NAME = "llm-wiki"
const BUILD_FILE = path.join(".llm-wiki-cli-build", "llm-wiki.mjs")

export async function writePathShims(binDir, bundlePath) {
  const absoluteBinDir = path.resolve(binDir)
  const absoluteBundle = path.resolve(bundlePath)
  await fs.mkdir(absoluteBinDir, { recursive: true })
  await Promise.all([
    writePosixShim(absoluteBinDir, absoluteBundle),
    writeCmdShim(absoluteBinDir, absoluteBundle),
    writePowerShellShim(absoluteBinDir, absoluteBundle),
  ])
}

export function pathBinDirs(root, env = process.env) {
  const localBin = path.join(root, "node_modules", ".bin")
  const dirs = [localBin]
  const userBin = env.LLM_WIKI_CLI_BIN_DIR ?? firstUserPathDir(env.PATH ?? "", root)
  if (userBin && !samePath(userBin, dirs[0])) dirs.push(userBin)
  return dirs
}

export async function buildCli(root, env = process.env) {
  const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js")
  const build = spawnSync(process.execPath, [
    viteBin,
    "build",
    "--config",
    "src/cli/vite.config.ts",
    "--logLevel",
    "error",
  ], { cwd: root, stdio: "inherit", env })

  if (build.status !== 0) return build.status ?? 1
  const bundlePath = path.join(root, BUILD_FILE)
  const [localBin, ...userBins] = pathBinDirs(root, env)
  await writePathShims(localBin, bundlePath)
  for (const binDir of userBins) {
    try {
      await writePathShims(binDir, bundlePath)
    } catch (err) {
      if (!isUnwritablePath(err)) throw err
    }
  }
  return 0
}

async function writePosixShim(binDir, bundlePath) {
  const rel = shellPath(relativeFrom(binDir, bundlePath, path.posix.sep))
  const body = [
    "#!/usr/bin/env sh",
    "basedir=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    `exec node "$basedir/${rel}" "$@"`,
    "",
  ].join("\n")
  const filePath = path.join(binDir, CLI_NAME)
  await fs.writeFile(filePath, body, { mode: 0o755 })
  await fs.chmod(filePath, 0o755)
}

async function writeCmdShim(binDir, bundlePath) {
  const rel = relativeFrom(binDir, bundlePath, path.win32.sep)
  const body = [
    "@ECHO off",
    "SETLOCAL",
    "SET \"basedir=%~dp0\"",
    `node "%basedir%\\${rel}" %*`,
    "",
  ].join("\r\n")
  await fs.writeFile(path.join(binDir, `${CLI_NAME}.cmd`), body)
}

async function writePowerShellShim(binDir, bundlePath) {
  const rel = relativeFrom(binDir, bundlePath, path.win32.sep)
  const body = [
    "$basedir = Split-Path $MyInvocation.MyCommand.Definition -Parent",
    `& node (Join-Path $basedir "${rel}") @args`,
    "exit $LASTEXITCODE",
    "",
  ].join("\r\n")
  await fs.writeFile(path.join(binDir, `${CLI_NAME}.ps1`), body)
}

function firstUserPathDir(rawPath, root) {
  const home = os.homedir()
  const resolvedRoot = path.resolve(root)
  return rawPath
    .split(path.delimiter)
    .filter(Boolean)
    .find((dir) => {
      const resolved = path.resolve(dir)
      return (
        resolved.startsWith(home) &&
        !resolved.startsWith(resolvedRoot) &&
        !resolved.endsWith(path.join("node_modules", ".bin")) &&
        !resolved.endsWith(path.join("node-gyp-bin"))
      )
    })
}

function relativeFrom(fromDir, toFile, separator) {
  const rel = path.relative(fromDir, toFile).split(path.sep).join(separator)
  return rel.startsWith("..") || rel.startsWith(".") ? rel : `.${separator}${rel}`
}

function shellPath(value) {
  return value.split(path.win32.sep).join(path.posix.sep)
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right)
}

function isUnwritablePath(err) {
  return err instanceof Error && "code" in err && ["EACCES", "EPERM", "EROFS"].includes(err.code)
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--write-shims-only") {
    await writePathShims(process.argv[3], process.argv[4])
  } else if (process.argv[2] === "--print-bin-dirs") {
    console.log(JSON.stringify(pathBinDirs(process.argv[3] ?? repoRoot())))
  } else {
    process.exitCode = await buildCli(repoRoot())
  }
}
