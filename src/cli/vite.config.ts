import path from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "../") },
  },
  build: {
    ssr: "src/cli/main.ts",
    outDir: ".llm-wiki-cli-build",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "llm-wiki.mjs",
        chunkFileNames: "chunks/[name].mjs",
      },
    },
  },
})
