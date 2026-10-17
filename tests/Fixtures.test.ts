import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extract } from "#/Extract";
import { rebuild } from "#/Rebuild";
import type { ArchiveEntry, ArchiveFile } from "#/types/Archive";

interface ArchiveFixture {
  path: string;
}

const directories = await readdir("tests/fixtures", { withFileTypes: true });
const fixtureGroups = await Promise.all(
  directories
    .filter((directory) => directory.isDirectory())
    .map(async (directory) => {
      const directoryPath = join("tests/fixtures", directory.name);
      const files = await readdir(directoryPath);

      return files
        .filter((file) => file.endsWith(".arc"))
        .map((file) => ({ path: join(directoryPath, file) }));
    }),
);
const fixtures: ArchiveFixture[] = fixtureGroups.flat();

function findFirstFile(entries: ArchiveEntry[]): ArchiveFile {
  const file = entries.find((entry) => entry.type === "file");

  if (file === undefined) {
    throw new Error("Original fixture must contain a file");
  }

  return file;
}

function replaceFile(entry: ArchiveEntry, path: string, data: Buffer): ArchiveEntry {
  if (entry.type === "file" && entry.path === path) {
    return { type: "file", path, data };
  }

  return entry;
}

function entriesEqual(actual: ArchiveEntry[], expected: ArchiveEntry[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  return actual.every((entry, index) => {
    const original = expected.at(index)!;

    if (entry.type !== original.type || entry.path !== original.path) {
      return false;
    }

    if (entry.type === "file" && original.type === "file") {
      return entry.data.length === original.data.length && entry.data.equals(original.data);
    }

    return true;
  });
}

describe("original archives", () => {
  it("includes all 99 original locale and layout archives", () => {
    expect(fixtures).toHaveLength(99);
  });

  it.each(fixtures)("preserves every byte of $path", async ({ path }) => {
    expect.assertions(4);

    const source = await readFile(path);
    const original = Buffer.from(source);
    const rebuilt = rebuild(source, new Map());
    const entries = extract(source);
    const replacements = new Map(
      entries.filter((entry) => entry.type === "file").map((entry) => [entry.path, entry.data]),
    );
    const reconstructed = rebuild(source, replacements);

    expect(rebuilt.equals(original)).toBe(true);
    expect(reconstructed).toHaveLength(original.length);
    expect(reconstructed.equals(original)).toBe(true);
    expect(source.equals(original)).toBe(true);
  });

  it.each(fixtures)("replaces a file in $path and preserves sibling contents", async ({ path }) => {
    expect.assertions(5);

    const source = await readFile(path);
    const original = Buffer.from(source);
    const entries = extract(source);
    const firstFile = findFirstFile(entries);

    expect(firstFile).toBeDefined();

    const unchanged = rebuild(source, new Map([[firstFile.path, Buffer.from(firstFile.data)]]));
    const replacement = Buffer.concat([firstFile.data, Buffer.from("Replacement fixture suffix")]);
    const rebuilt = rebuild(source, new Map([[firstFile.path, replacement]]));
    const expected = entries.map((entry) => replaceFile(entry, firstFile.path, replacement));
    const actual = extract(rebuilt);

    expect(unchanged.equals(original)).toBe(true);
    expect(actual).toHaveLength(expected.length);
    expect(entriesEqual(actual, expected)).toBe(true);
    expect(source.equals(original)).toBe(true);
  });
});
