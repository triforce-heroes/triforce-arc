import type { SnapshotSerializer } from "vitest";

export default {
  test(val) {
    return Buffer.isBuffer(val);
  },
  serialize(val: Buffer) {
    const bytes = val.toString("hex").toUpperCase().match(/.{2}/gv) ?? [];

    return `Buffer [${bytes.join(" ")}]`;
  },
} satisfies SnapshotSerializer;
