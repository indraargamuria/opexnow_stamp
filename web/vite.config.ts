import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/templates": "http://127.0.0.1:8787",
      "/stamp": "http://127.0.0.1:8787",
      "/jobs": "http://127.0.0.1:8787",
      "/tenants": "http://127.0.0.1:8787",
      "/auth": "http://127.0.0.1:8787",
      "/console": "http://127.0.0.1:8787",
      "/download": "http://127.0.0.1:8787",
    },
  },
});
