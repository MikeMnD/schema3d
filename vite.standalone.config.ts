import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import glsl from "vite-plugin-glsl";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Standalone build: produces ONE self-contained index.html with every
 * script, style, font and the bundled schema inlined. The file runs from
 * file:// with a double-click — no server, no Node, no install — which
 * makes it distributable as a plain zip.
 *
 * Build with: npm run build:standalone   (output: dist/standalone)
 */
export default defineConfig(() => ({
  plugins: [react(), glsl(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/standalone"),
    emptyOutDir: true,
    // Inline every asset (fonts, images) as data URIs — nothing external
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
  },
  assetsInclude: ["**/*.gltf", "**/*.glb", "**/*.mp3", "**/*.ogg", "**/*.wav"],
}));
