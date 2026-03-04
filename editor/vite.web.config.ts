import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Web-only vite config (no Electron). Used for Docker / browser mode. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist-web",
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
  },
});
