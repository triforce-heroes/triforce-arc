import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ArchiveEntry } from "#/types/Archive";
import { assertSeparatePaths, readDirectory, writeDirectory } from "#tests/Files";

describe("archive directories", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.map(async (path) => rm(path, { recursive: true, force: true })),
    );
    temporaryDirectories.length = 0;
  });

  it("writes and reads opaque files, nested paths and empty directories", async () => {
    expect.assertions(1);

    const directory = await mkdtemp(join(tmpdir(), "triforce-arc-"));

    temporaryDirectories.push(directory);

    const entries: ArchiveEntry[] = [
      { type: "directory", path: "empty" },
      { type: "directory", path: "nested" },
      { type: "file", path: "nested/raw.msbt", data: Buffer.from([0, 255, 128, 42]) },
      { type: "file", path: "zero.bin", data: Buffer.alloc(0) },
    ];

    await writeDirectory(directory, entries);

    const extracted = await readDirectory(directory);

    expect(extracted).toStrictEqual(entries);
  });

  it("preserves existing output files", async () => {
    expect.assertions(2);

    const directory = await mkdtemp(join(tmpdir(), "triforce-arc-"));

    temporaryDirectories.push(directory);
    await writeFile(join(directory, "original.bin"), "original");

    await expect(
      writeDirectory(directory, [
        { type: "file", path: "original.bin", data: Buffer.from("changed") },
      ]),
    ).rejects.toThrow(/EEXIST/v);

    const preserved = await readFile(join(directory, "original.bin"), "utf-8");

    expect(preserved).toBe("original");
  });

  it("rejects traversal before writing any entry", async () => {
    expect.assertions(1);

    const directory = await mkdtemp(join(tmpdir(), "triforce-arc-"));

    temporaryDirectories.push(directory);

    await expect(
      writeDirectory(directory, [{ type: "file", path: "../outside.bin", data: Buffer.alloc(0) }]),
    ).rejects.toThrow(/path/v);
  });

  it("rejects source and output overlap", async () => {
    expect.assertions(3);

    const directory = await mkdtemp(join(tmpdir(), "triforce-arc-"));

    temporaryDirectories.push(directory);
    await mkdir(join(directory, "source"));

    await expect(assertSeparatePaths(directory, directory)).rejects.toThrow(/sobreposição/v);
    await expect(assertSeparatePaths(directory, join(directory, "output"))).rejects.toThrow(
      /sobreposição/v,
    );
    await expect(
      assertSeparatePaths(join(directory, "source"), join(directory, "output")),
    ).resolves.toBeUndefined();
  });
});
