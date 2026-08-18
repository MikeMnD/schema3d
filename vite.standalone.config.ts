import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import glsl from "vite-plugin-glsl";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Trims the HTML for single-file distribution:
 * - drops references to files we don't ship (favicons, webmanifest) and
 *   embeds the favicon as a data URI instead, so the tab icon works from
 *   file://
 * - drops the PostHog analytics bootstrap and SEO structured data — both
 *   pointless (and the former undesirable) in an offline, private copy
 */
function standaloneHtml(): Plugin {
  return {
    name: "standalone-html",
    transformIndexHtml(html) {
      const favicon = readFileSync(
        path.resolve(__dirname, "client", "public", "favicon-32.png")
      ).toString("base64");

      return html
        .replace(
          /[ \t]*<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*>\r?\n?/g,
          ""
        )
        .replace(/[ \t]*<script>[\s\S]*?posthog[\s\S]*?<\/script>\r?\n?/, "")
        .replace(
          /[ \t]*<script type="application\/ld\+json">[\s\S]*?<\/script>\r?\n?/g,
          ""
        )
        .replace(
          "</title>",
          `</title>\n    <link rel="icon" type="image/png" href="data:image/png;base64,${favicon}" />`
        );
    },
  };
}

/**
 * Standalone build: produces ONE self-contained index.html with every
 * script, style, font and the bundled schema inlined. The file runs from
 * file:// with a double-click — no server, no Node, no install — which
 * makes it distributable as a plain zip (or as the bare .html file).
 *
 * Build with: npm run build:standalone   (output: dist/standalone)
 */
export default defineConfig(() => ({
  plugins: [react(), glsl(), viteSingleFile(), standaloneHtml()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  root: path.resolve(__dirname, "client"),
  // Don't copy client/public into the output — the goal is a single file,
  // and everything the app needs is inlined anyway
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, "dist/standalone"),
    emptyOutDir: true,
    // Inline every asset (fonts, images) as data URIs — nothing external
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
  },
  assetsInclude: ["**/*.gltf", "**/*.glb", "**/*.mp3", "**/*.ogg", "**/*.wav"],
}));
