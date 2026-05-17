import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_CONFIG,
  applyBaseUrl,
  applyEnv,
  applyOverrides,
  configPath,
  loadConfig,
  mergeConfig,
  readConfigFile,
  writeDefaultConfig,
  type CliLlmConfig,
} from "../config"

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-config-"))
}

describe("CLI config", () => {
  it("resolves the project config path", () => {
    expect(configPath(path.join("tmp", "proj"))).toBe(
      path.join("tmp", "proj", ".llm-wiki", "config.json"),
    )
  })

  it("merges nested config sections", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { search: { defaultLimit: 3 } })
    expect(merged.search.defaultLimit).toBe(3)
    expect(merged.ingest.recursiveByDefault).toBe(true)
  })

  it("applies environment overrides", () => {
    const cfg = applyEnv(DEFAULT_CONFIG, {
      LLM_WIKI_PROVIDER: "ollama",
      LLM_WIKI_MODEL: "llama3",
      LLM_WIKI_BASE_URL: "http://localhost:11434",
    })
    expect(cfg.llm.provider).toBe("ollama")
    expect(cfg.llm.model).toBe("llama3")
    expect(cfg.llm.ollamaUrl).toBe("http://localhost:11434")
  })

  it("rejects invalid provider and reasoning overrides", () => {
    expect(() => applyEnv(DEFAULT_CONFIG, { LLM_WIKI_PROVIDER: "oops" })).toThrow("LLM_WIKI_PROVIDER")
    expect(() => applyEnv(DEFAULT_CONFIG, { LLM_WIKI_REASONING: "banana" })).toThrow("LLM_WIKI_REASONING")
    expect(() => applyOverrides(DEFAULT_CONFIG, { provider: "oops" })).toThrow("--provider")
    expect(() => applyOverrides(DEFAULT_CONFIG, { reasoning: "banana" })).toThrow("--reasoning")
  })

  it("applies explicit overrides after config values", () => {
    const cfg = applyOverrides(DEFAULT_CONFIG, { provider: "custom", baseUrl: "http://x" })
    expect(cfg.llm.customEndpoint).toBe("http://x")
  })

  it("applies base URLs to ollama and non-ollama providers", () => {
    const llm: CliLlmConfig = { ...DEFAULT_CONFIG.llm, provider: "ollama" }
    applyBaseUrl(llm, "http://ollama")
    expect(llm.ollamaUrl).toBe("http://ollama")
    llm.provider = "custom"
    applyBaseUrl(llm, "http://custom")
    expect(llm.customEndpoint).toBe("http://custom")
  })

  it("reads missing config files as empty patches", async () => {
    await expect(readConfigFile("/tmp/nope/config.json")).resolves.toEqual({})
  })

  it("writes and loads default config", async () => {
    const dir = await tempDir()
    await writeDefaultConfig(dir)
    const loaded = await loadConfig(dir, {}, {})
    expect(loaded.ingest.recursiveByDefault).toBe(DEFAULT_CONFIG.ingest.recursiveByDefault)
  })
})
