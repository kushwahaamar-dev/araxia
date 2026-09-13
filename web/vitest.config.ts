import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    // never touch the real ~/.araxia roster from tests
    env: { ARAXIA_ROSTER: path.join(tmpdir(), `araxia-roster-${process.pid}.json`) },
  },
});
