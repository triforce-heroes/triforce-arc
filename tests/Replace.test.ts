import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { extract } from "#/Extract";
import { rebuild } from "#/Rebuild";
import type { ArchiveEntry } from "#/types/Archive";

const trailer = Buffer.from("Opaque archive trailer");

async function readSource(): Promise<Buffer> {
  const source = await readFile("tests/fixtures/dummy.arc");

  source.fill(0xa1, 0x10, 0x20);
  source.fill(0xb2, 0xa6, 0xc0);
  source.fill(0xc3, 0xc5, 0xe0);
  source.fill(0xd4, 0xe4, 0x01_00);

  return Buffer.concat([source, trailer]);
}

function replaceEntries(
  entries: ArchiveEntry[],
  replacements: ReadonlyMap<string, Buffer>,
): ArchiveEntry[] {
  return entries.map((entry) => {
    if (entry.type === "directory") {
      return entry;
    }

    return { ...entry, data: replacements.get(entry.path) ?? entry.data };
  });
}

describe(rebuild, () => {
  it("preserves every source byte without replacements", async () => {
    expect.assertions(2);

    const source = await readSource();
    const original = Buffer.from(source);
    const rebuilt = rebuild(source, new Map());

    expect(rebuilt).toStrictEqual(original);
    expect(source).toStrictEqual(original);
  });

  it("preserves every source byte when replacement contents are unchanged", async () => {
    expect.assertions(2);

    const source = await readSource();
    const original = Buffer.from(source);
    const replacements = new Map([["messages/hello.bin", Buffer.from("Hello")]]);
    const rebuilt = rebuild(source, replacements);

    expect(rebuilt).toStrictEqual(original);
    expect(source).toStrictEqual(original);
  });

  interface InvalidReplacement {
    path: string;
  }

  const invalidReplacements: InvalidReplacement[] = [
    { path: "missing.bin" },
    { path: "messages/missing.bin" },
    { path: "messages" },
    { path: "empty" },
    { path: "../root.bin" },
    { path: "messages\\hello.bin" },
    { path: "" },
  ];

  it.each(invalidReplacements)("rejects replacement path $path", async ({ path }) => {
    expect.assertions(2);

    const source = await readSource();
    const original = Buffer.from(source);
    const replacements = new Map([[path, Buffer.from("Replacement")]]);

    expect(() => rebuild(source, replacements)).toThrow(/U8|path|file|directory/v);
    expect(source).toStrictEqual(original);
  });

  it("rejects an invalid source archive even without replacements", () => {
    expect(() => rebuild(Buffer.alloc(32), new Map())).toThrow(/U8/v);
  });

  it("changes only the original payload bytes for a replacement of the same size", async () => {
    expect.assertions(5);

    const source = await readSource();
    const original = Buffer.from(source);
    const replacements = new Map([["messages/hello.bin", Buffer.from("World")]]);
    const rebuilt = rebuild(source, replacements);

    expect(rebuilt.subarray(0, 0xc0)).toStrictEqual(original.subarray(0, 0xc0));
    expect(rebuilt.subarray(0xc0, 0xc5)).toStrictEqual(Buffer.from("World"));
    expect(rebuilt.subarray(0xc5)).toStrictEqual(original.subarray(0xc5));
    expect(extract(rebuilt)).toStrictEqual(replaceEntries(extract(source), replacements));
    expect(source).toStrictEqual(original);
  });

  interface ReplacementContents {
    name: string;
    data: Buffer;
  }

  const replacementContents: ReplacementContents[] = [
    { name: "growth beyond the next file", data: Buffer.alloc(97, 0x42) },
    { name: "shorter contents", data: Buffer.from([0x42]) },
    { name: "empty contents", data: Buffer.alloc(0) },
  ];

  it.each(replacementContents)("supports $name and preserves opaque data", async ({ data }) => {
    expect.assertions(10);

    const source = await readSource();
    const original = Buffer.from(source);
    const replacements = new Map([["messages/hello.bin", data]]);
    const originalReplacement = Buffer.from(data);
    const rebuilt = rebuild(source, replacements);

    expect(extract(rebuilt)).toStrictEqual(replaceEntries(extract(source), replacements));
    expect(rebuilt.subarray(0, 0x3c)).toStrictEqual(original.subarray(0, 0x3c));
    expect(rebuilt.subarray(0xa6, 0xc0)).toStrictEqual(original.subarray(0xa6, 0xc0));
    expect(rebuilt.indexOf(original.subarray(0xc5, 0xe0))).toBeGreaterThanOrEqual(0);
    expect(rebuilt.indexOf(original.subarray(0xe4, 0x01_00))).toBeGreaterThanOrEqual(0);
    expect(rebuilt.subarray(-trailer.length)).toStrictEqual(trailer);
    expect(rebuilt.readUInt32BE(0x3c) % 0x20).toBe(0);
    expect(rebuilt.readUInt32BE(0x54) % 0x20).toBe(0);
    expect(source).toStrictEqual(original);
    expect(data).toStrictEqual(originalReplacement);
  });

  it("replaces multiple files including an originally empty file", async () => {
    expect.assertions(4);

    const source = await readSource();
    const original = Buffer.from(source);
    const replacements = new Map([
      ["root.bin", Buffer.alloc(65, 0x72)],
      ["messages/nested/raw.bin", Buffer.alloc(0)],
      ["messages/hello.bin", Buffer.alloc(95, 0x68)],
    ]);
    const rebuilt = rebuild(source, replacements);

    expect(extract(rebuilt)).toStrictEqual(replaceEntries(extract(source), replacements));
    expect(rebuilt.readUInt32BE(0x6c) % 0x20).toBe(0);
    expect(rebuilt.subarray(-trailer.length)).toStrictEqual(trailer);
    expect(source).toStrictEqual(original);
  });

  it("replaces files in a source buffer with a nonzero byte offset", async () => {
    expect.assertions(2);

    const original = await readSource();
    const wrapped = Buffer.concat([Buffer.alloc(17, 0xee), original, Buffer.alloc(7, 0xff)]);
    const source = wrapped.subarray(17, 17 + original.length);
    const replacements = new Map([["messages/hello.bin", Buffer.alloc(97, 0x42)]]);
    const rebuilt = rebuild(source, replacements);

    expect(extract(rebuilt)).toStrictEqual(replaceEntries(extract(original), replacements));
    expect(source).toStrictEqual(original);
  });

  it("replaces an empty file whose offset points inside another file", async () => {
    expect.assertions(4);

    const source = await readSource();

    source.writeUInt32BE(0xc1, 0x6c);

    const original = Buffer.from(source);
    const replacements = new Map([["root.bin", Buffer.alloc(33, 0x42)]]);
    const rebuilt = rebuild(source, replacements);

    expect(extract(rebuilt)).toStrictEqual(replaceEntries(extract(original), replacements));
    expect(rebuilt.readUInt32BE(0x6c) % 0x20).toBe(0);
    expect(rebuilt.subarray(-trailer.length)).toStrictEqual(trailer);
    expect(source).toStrictEqual(original);
  });
});
