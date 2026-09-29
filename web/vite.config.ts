import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { functionsMixins } from "vite-plugin-functions-mixins";

export default defineConfig({
  // The functions/mixins plugin must see the raw Svelte sources before they
  // are compiled, so it runs first. m3-svelte must not be pre-bundled by the
  // dependency optimizer, otherwise its styles bypass the plugin in dev.
  plugins: [functionsMixins({ deps: ["m3-svelte"] }), svelte()],
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString()),
  },
  optimizeDeps: {
    exclude: ["m3-svelte"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
