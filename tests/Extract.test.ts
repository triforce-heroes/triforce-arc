import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { extract } from "#/Extract";
import type { ArchiveEntry } from "#/types/Archive";

describe(extract, () => {
  const expectedEntries: ArchiveEntry[] = [
    { type: "directory", path: "messages" },
    { type: "file", path: "messages/hello.bin", data: Buffer.from("Hello") },
    { type: "directory", path: "messages/nested" },
    { type: "file", path: "messages/nested/raw.bin", data: Buffer.from([0, 255, 128, 1]) },
    { type: "directory", path: "empty" },
    { type: "file", path: "root.bin", data: Buffer.alloc(0) },
  ];

  it("extracts directories and opaque files in archive order", async () => {
    expect.assertions(1);

    const data = await readFile("tests/fixtures/dummy.arc");

    expect(extract(data)).toStrictEqual(expectedEntries);
  });

  it("preserves the source bytes", async () => {
    expect.assertions(1);

    const data = await readFile("tests/fixtures/dummy.arc");
    const original = Buffer.from(data);

    extract(data);

    expect(data).toStrictEqual(original);
  });

  interface InvalidArchive {
    name: string;
    change(this: void, data: Buffer): Buffer;
  }

  const invalidArchives: InvalidArchive[] = [
    { name: "truncated header", change: (data) => data.subarray(0, 31) },
    {
      name: "incorrect magic",
      change(data) {
        data.writeUInt32BE(0, 0);
        return data;
      },
    },
    {
      name: "root overlapping the fixed header",
      change(data) {
        data.writeUInt32BE(16, 4);
        return data;
      },
    },
    {
      name: "header beyond the archive",
      change(data) {
        data.writeUInt32BE(data.length, 8);
        return data;
      },
    },
    {
      name: "data overlapping the node table",
      change(data) {
        data.writeUInt32BE(32, 12);
        return data;
      },
    },
    {
      name: "data beyond the archive",
      change(data) {
        data.writeUInt32BE(data.length + 1, 12);
        return data;
      },
    },
    {
      name: "file root",
      change(data) {
        data.writeUInt32BE(0, 32);
        return data;
      },
    },
    {
      name: "nonzero root parent",
      change(data) {
        data.writeUInt32BE(1, 36);
        return data;
      },
    },
    {
      name: "empty node table",
      change(data) {
        data.writeUInt32BE(0, 40);
        return data;
      },
    },
    {
      name: "node table beyond the header",
      change(data) {
        data.writeUInt32BE(255, 40);
        return data;
      },
    },
    {
      name: "invalid node type",
      change(data) {
        data.writeUInt32BE(0x02_00_00_0a, 56);
        return data;
      },
    },
    {
      name: "name outside the string table",
      change(data) {
        data.writeUInt32BE(0x00_ff_ff_ff, 56);
        return data;
      },
    },
    {
      name: "unterminated name",
      change(data) {
        data.fill(65, 0x74 + 41, 0xa6);
        return data;
      },
    },
    {
      name: "invalid UTF-8 name",
      change(data) {
        data.writeUInt8(255, 0x74 + 10);
        return data;
      },
    },
    {
      name: "path traversal in a name",
      change(data) {
        data.write("..\0", 0x74 + 10);
        return data;
      },
    },
    {
      name: "slash in a name",
      change(data) {
        data.write("bad/name\0", 0x74 + 10);
        return data;
      },
    },
    {
      name: "duplicate sibling paths",
      change(data) {
        data.writeUInt32BE(35, 104);
        return data;
      },
    },
    {
      name: "directory with a different parent",
      change(data) {
        data.writeUInt32BE(0, 72);
        return data;
      },
    },
    {
      name: "directory ending before itself",
      change(data) {
        data.writeUInt32BE(3, 76);
        return data;
      },
    },
    {
      name: "directory extending beyond its parent",
      change(data) {
        data.writeUInt32BE(6, 76);
        return data;
      },
    },
    {
      name: "file before the data section",
      change(data) {
        data.writeUInt32BE(0x80, 60);
        return data;
      },
    },
    {
      name: "file beyond the archive",
      change(data) {
        data.writeUInt32BE(data.length, 64);
        return data;
      },
    },
    {
      name: "overlapping file data",
      change(data) {
        data.writeUInt32BE(0xc0, 84);
        return data;
      },
    },
  ];

  it.each(invalidArchives)("rejects $name", async ({ change }) => {
    expect.assertions(1);

    const original = await readFile("tests/fixtures/dummy.arc");
    const data = change(original);

    expect(() => extract(data)).toThrow(/U8|UTF-8|encoded/v);
  });
});
