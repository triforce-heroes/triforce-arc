import { defineConfig } from "vitest/config";

// oxlint-disable-next-line import/no-anonymous-default-export
export default defineConfig({
  test: {
    fsModuleCache: true,
    snapshotSerializers: ["tests/BufferSerializer.ts"],
  },
});
