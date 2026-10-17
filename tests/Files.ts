import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ArchiveEntry } from "#/types/Archive";
import { assertArchivePath } from "#/types/Archive";

export async function readDirectory(directory: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];

  async function visit(path: string, prefix: string): Promise<void> {
    const files = await readdir(path, { withFileTypes: true });

    files.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const file of files) {
      const entryPath = `${prefix}${file.name}`;

      assertArchivePath(entryPath);

      if (file.isDirectory()) {
        entries.push({ type: "directory", path: entryPath });
        // oxlint-disable-next-line no-await-in-loop
        await visit(join(path, file.name), `${entryPath}/`);
        continue;
      }

      if (!file.isFile()) {
        throw new Error(`Unsupported filesystem entry: ${entryPath}`);
      }

      // oxlint-disable-next-line no-await-in-loop
      const data = await readFile(join(path, file.name));

      entries.push({ type: "file", path: entryPath, data });
    }
  }

  await visit(directory, "");

  return entries;
}

export async function writeDirectory(
  directory: string,
  entries: readonly ArchiveEntry[],
): Promise<void> {
  const paths = new Set<string>();

  for (const entry of entries) {
    assertArchivePath(entry.path);

    const path = process.platform === "win32" ? entry.path.toLowerCase() : entry.path;

    if (paths.has(path)) {
      throw new Error(`Duplicate output path: ${entry.path}`);
    }

    paths.add(path);
  }

  await mkdir(directory, { recursive: true });

  for (const entry of entries) {
    const path = join(directory, entry.path);

    if (entry.type === "directory") {
      // oxlint-disable-next-line no-await-in-loop
      await mkdir(path, { recursive: true });
      continue;
    }

    // oxlint-disable-next-line no-await-in-loop
    await mkdir(dirname(path), { recursive: true });
    // oxlint-disable-next-line no-await-in-loop
    await writeFile(path, entry.data, { flag: "wx" });
  }
}

async function resolvePhysicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }

    const parent = dirname(path);

    if (parent === path) {
      throw error;
    }

    const physicalParent = await resolvePhysicalPath(parent);

    return join(physicalParent, relative(parent, path));
  }
}

function containsPath(parent: string, child: string): boolean {
  const path = relative(parent, child);

  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

export async function assertSeparatePaths(source: string, output: string): Promise<void> {
  const sourcePath = await resolvePhysicalPath(resolve(source));
  const outputPath = await resolvePhysicalPath(resolve(output));

  if (containsPath(sourcePath, outputPath) || containsPath(outputPath, sourcePath)) {
    throw new Error("Origem e saída devem ser caminhos separados, sem sobreposição.");
  }
}
