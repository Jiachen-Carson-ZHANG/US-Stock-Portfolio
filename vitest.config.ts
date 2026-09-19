import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // `server-only` throws on import outside a Server Component, which is the
      // point of it — but it also stops the tests from reaching server modules
      // at all. Next resolves it to an empty module under the react-server
      // condition; the same substitution applies here.
      "server-only": resolve(__dirname, "./src/tests/stubs/server-only.ts"),
    },
  },
});
