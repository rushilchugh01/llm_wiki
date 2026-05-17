import path from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "../") },
  },
  build: {
    ssr: "src/cli/main.ts",
    outDir: ".llm-wiki-cli-binary-build",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: "cjs",
        entryFileNames: "llm-wiki.cjs",
        chunkFileNames: "chunks/[name].cjs",
      },
    },
  },
})
