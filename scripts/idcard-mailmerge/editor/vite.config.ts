import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEditorMiddleware } from "./src/server/middleware";
import { buildEditorServerConfig } from "./src/server/serverConfig";

const editorRoot = path.dirname(fileURLToPath(import.meta.url));
// scripts/idcard-mailmerge — the Python package root. layout.json, data/,
// assets/, and fixtures/ all live here, one level up from editor/.
const editorServerConfig = buildEditorServerConfig(editorRoot);

export default defineConfig({
  root: editorRoot,
  plugins: [
    react(),
    {
      name: "idcard-editor-file-api",
      configureServer(server) {
        // Dev-only file I/O backend (spec: "Dependencies" — a Vite
        // middleware plugin via server.middlewares.use, not a standalone
        // server, not the File System Access API).
        server.middlewares.use(createEditorMiddleware(editorServerConfig));
      },
    },
  ],
});
