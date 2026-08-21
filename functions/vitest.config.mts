import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // lib is the tsc build output of src (needed for the Firebase Functions
    // emulator). Without this exclude, vitest's default glob also picks up
    // the compiled lib/*.test.js files, which collide with the src/*.test.ts
    // sources and fail to load (they're CommonJS output and vitest refuses
    // to `require()` itself from a CJS module).
    exclude: [...configDefaults.exclude, "lib/**"],
  },
});
