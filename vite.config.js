import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "https://restro-scan-backend-production.up.railway.app",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
