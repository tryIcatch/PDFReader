import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve("src/app/main.ts"),
      },
      rollupOptions: {
        external: ["better-sqlite3"],
      },
    },
    resolve: {
      alias: {
        "@app": resolve("src/app"),
        "@backend": resolve("src/backend"),
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve("src/app/preload.ts"),
      },
    },
    resolve: {
      alias: {
        "@app": resolve("src/app"),
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
        },
      },
    },
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
  },
});
