import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Configuración de Vitest: entorno Node (el motor y la lógica de escaneo son puros).
 *
 * - `npm test`: pruebas unitarias, sin red ni base de datos.
 * - `npm run test:db` (`--mode db`): pruebas de integración contra el Supabase de
 *   desarrollo (tests/db). Requieren las variables de .env.local.
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      // `server-only` lanza un error fuera de React Server Components; en pruebas se neutraliza.
      "server-only": fromRoot("./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: mode === "db" ? ["tests/db/**/*.test.ts"] : ["tests/**/*.test.ts"],
    exclude: mode === "db" ? [] : ["tests/db/**"],
  },
}));
