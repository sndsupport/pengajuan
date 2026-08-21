import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // functions/lib is the tsc build output of functions/src (needed for the
    // Firebase Functions emulator). Without this exclude, vitest's default
    // glob also picks up the compiled functions/lib/*.test.js files, which
    // collide with the functions/src/*.test.ts sources and fail to load
    // (they're CommonJS output and vitest refuses to `require()` itself from
    // a CJS module).
    exclude: [...configDefaults.exclude, "functions/lib/**"],
  },
});
