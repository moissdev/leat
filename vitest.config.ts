import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Configuración de Vitest: entorno Node (el motor y la lógica de escaneo son puros).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
