import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { extract } from "#/Extract";
import { rebuildRaw } from "#/Rebuild";
import type { ArchiveEntry } from "#/types/Archive";

function replaceEntry(
  entry: ArchiveEntry,
  replacements: ReadonlyMap<string, Buffer>,
): ArchiveEntry {
  if (entry.type === "directory") {
    return entry;
  }

  const data = replacements.get(entry.path) ?? entry.data;

  return { type: "file", path: entry.path, data };
}

describe(rebuildRaw, () => {
  it("creates an empty archive without an original", () => {
    const data = rebuildRaw([]);

    expect(extract(data)).toStrictEqual([]);
    expect(data.readUInt32BE(0)).toBe(0x55_aa_38_2d);
    expect(data.readUInt32BE(4)).toBe(0x20);
    expect(data.readUInt32BE(12) % 0x20).toBe(0);
  });

  it("creates new opaque files and empty directories", () => {
    const entries: ArchiveEntry[] = [
      { type: "file", path: "new.msbt", data: Buffer.from([0, 1, 255, 128]) },
      { type: "directory", path: "empty" },
      { type: "file", path: "zero.bin", data: Buffer.alloc(0) },
    ];

    expect(extract(rebuildRaw(entries))).toStrictEqual(entries);
  });

  it("preserves UTF-8 paths and aligns every file payload", () => {
    const entries: ArchiveEntry[] = [
      { type: "file", path: "ação.bin", data: Buffer.from([1]) },
      { type: "file", path: "日本語.bin", data: Buffer.alloc(33, 2) },
      { type: "file", path: "last.bin", data: Buffer.from([3]) },
    ];
    const data = rebuildRaw(entries);

    expect(extract(data)).toStrictEqual(entries);
    expect(data.readUInt32BE(0x20 + 12 + 4) % 0x20).toBe(0);
    expect(data.readUInt32BE(0x20 + 24 + 4) % 0x20).toBe(0);
    expect(data.readUInt32BE(0x20 + 36 + 4) % 0x20).toBe(0);
  });

  it("preserves leading byte order mark characters in node names", () => {
    const entries: ArchiveEntry[] = [
      { type: "directory", path: "\uFEFFdirectory" },
      { type: "file", path: "\uFEFFfile.bin", data: Buffer.from("preserved") },
    ];

    expect(extract(rebuildRaw(entries))).toStrictEqual(entries);
  });

  it("creates implicit parents and preserves insertion order within each directory", () => {
    const entries: ArchiveEntry[] = [
      { type: "file", path: "messages/nested/last.bin", data: Buffer.from("last") },
      { type: "file", path: "first.bin", data: Buffer.from("first") },
      { type: "file", path: "messages/next.bin", data: Buffer.from("next") },
      { type: "directory", path: "messages" },
      { type: "directory", path: "messages/nested" },
      { type: "directory", path: "messages/empty" },
    ];
    const expected: ArchiveEntry[] = [
      { type: "directory", path: "messages" },
      { type: "directory", path: "messages/nested" },
      { type: "file", path: "messages/nested/last.bin", data: Buffer.from("last") },
      { type: "file", path: "messages/next.bin", data: Buffer.from("next") },
      { type: "directory", path: "messages/empty" },
      { type: "file", path: "first.bin", data: Buffer.from("first") },
    ];

    expect(extract(rebuildRaw(entries))).toStrictEqual(expected);
  });

  it("preserves every entry extracted from the independent fixture", async () => {
    expect.assertions(1);

    const data = await readFile("tests/fixtures/dummy.arc");
    const entries = extract(data);
    const rebuilt = rebuildRaw(entries);

    expect(extract(rebuilt)).toStrictEqual(entries);
  });

  it("rebuilds edited entries with larger, smaller, deleted and new files", async () => {
    expect.assertions(1);

    const data = await readFile("tests/fixtures/dummy.arc");
    const entries = extract(data);
    const replacements = new Map([
      ["messages/hello.bin", Buffer.from("Tradução maior: ação, coração e bênção.")],
      ["messages/nested/raw.bin", Buffer.from([42])],
    ]);
    const edited: ArchiveEntry[] = entries
      .filter((entry) => entry.path !== "root.bin")
      .map((entry) => replaceEntry(entry, replacements));

    edited.push({ type: "file", path: "added.bin", data: Buffer.from("New") });

    expect(extract(rebuildRaw(edited))).toStrictEqual(edited);
  });

  it("preserves caller entries, order and file buffers", () => {
    const contents = Buffer.from("Keep me");
    const entries: ArchiveEntry[] = [
      { type: "file", path: "nested/file.bin", data: contents },
      { type: "directory", path: "empty" },
    ];
    const original: ArchiveEntry[] = [
      { type: "file", path: "nested/file.bin", data: Buffer.from(contents) },
      { type: "directory", path: "empty" },
    ];

    rebuildRaw(entries);

    expect(entries).toStrictEqual(original);
    expect(entries.at(0)).toHaveProperty("data", contents);
  });

  interface InvalidPath {
    path: string;
  }

  const invalidPaths: InvalidPath[] = [
    { path: "" },
    { path: "." },
    { path: ".." },
    { path: "../outside.bin" },
    { path: "nested/../outside.bin" },
    { path: "nested/./file.bin" },
    { path: "/absolute.bin" },
    { path: "C:/absolute.bin" },
    { path: "nested\\file.bin" },
    { path: "nested//file.bin" },
    { path: "nested/file.bin/" },
    { path: "nul\0.bin" },
    { path: "unpaired\uD800.bin" },
    { path: "unpaired\uDC00.bin" },
  ];

  it.each(invalidPaths)("rejects unsafe file path $path", ({ path }) => {
    const entries: ArchiveEntry[] = [{ type: "file", path, data: Buffer.alloc(0) }];

    expect(() => rebuildRaw(entries)).toThrow(/U8|path/v);
  });

  it.each(invalidPaths)("rejects unsafe directory path $path", ({ path }) => {
    const entries: ArchiveEntry[] = [{ type: "directory", path }];

    expect(() => rebuildRaw(entries)).toThrow(/U8|path/v);
  });

  interface InvalidEntries {
    name: string;
    entries: ArchiveEntry[];
  }

  const invalidEntries: InvalidEntries[] = [
    {
      name: "duplicate files",
      entries: [
        { type: "file", path: "same.bin", data: Buffer.from("one") },
        { type: "file", path: "same.bin", data: Buffer.from("two") },
      ],
    },
    {
      name: "duplicate directories",
      entries: [
        { type: "directory", path: "same" },
        { type: "directory", path: "same" },
      ],
    },
    {
      name: "file and directory sharing a path",
      entries: [
        { type: "directory", path: "same" },
        { type: "file", path: "same", data: Buffer.alloc(0) },
      ],
    },
    {
      name: "file used as a parent",
      entries: [
        { type: "file", path: "parent", data: Buffer.alloc(0) },
        { type: "file", path: "parent/child.bin", data: Buffer.alloc(0) },
      ],
    },
    {
      name: "file replacing an implicit parent",
      entries: [
        { type: "file", path: "parent/child.bin", data: Buffer.alloc(0) },
        { type: "file", path: "parent", data: Buffer.alloc(0) },
      ],
    },
  ];

  it.each(invalidEntries)("rejects $name", ({ entries }) => {
    expect(() => rebuildRaw(entries)).toThrow(/U8|path|directory|duplicate/v);
  });
});
