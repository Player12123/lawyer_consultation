import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(() => {
  return {
    // Local-only bridge: the browser stays on :3000, while sensitive API
    // requests are forwarded to the separately running local API on :8788.
    // Production uses the HTTPS reverse proxy described in the deployment doc.
    server: {
      host: true,
      allowedHosts: ["cacti-improper-amazingly.ngrok-free.dev"],
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8788",
          changeOrigin: false,
        },
      },
    },
    plugins: [vinext()],
  };
});
