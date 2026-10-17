# triforce-arc

Extract and rebuild uncompressed U8 `.arc` archives in memory. File contents are opaque `Buffer`
values. The library does not read or write the filesystem or interpret embedded file formats.
Process MSBT messages separately with `triforce-msbt`.

## Supported format

- Archive format: U8, big-endian, with magic number `0x55AA382D`.
- Compression: none. Decompress LZSS/Yaz0 separately before calling this library.
- Other formats that use the `.arc` extension are not supported.
- Validation covers archive structure and file contents. Rebuilt archives still require in-game
  runtime testing.

## API selection

| Task                                                | Function                        | Original archive required? | Preservation guarantee                                                                                    |
| --------------------------------------------------- | ------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Read directories and file contents                  | `extract(data)`                 | Yes                        | Entry order, paths, empty entries, and file contents                                                      |
| Replace existing files                              | `rebuild(source, replacements)` | Yes                        | Original layout metadata, gaps, trailing bytes, and unchanged file contents; offsets and sizes may change |
| Create an archive or add, remove, or rename entries | `rebuildRaw(entries)`           | No                         | Paths and file contents; canonical layout with recalculated offsets                                       |

Use `rebuild` when original layout preservation matters. Use `rebuildRaw` when changing the archive
hierarchy or creating an archive from scratch. `rebuildRaw` cannot recover the original physical
layout from extracted entries alone.

## Imports and signatures

```ts
import { extract } from "@triforce-heroes/triforce-arc/Extract";
import type { ArchiveEntry } from "@triforce-heroes/triforce-arc/Extract";
import { rebuild, rebuildRaw } from "@triforce-heroes/triforce-arc/Rebuild";
```

Public function signatures:

```ts
extract(data: Buffer): ArchiveEntry[];
rebuild(source: Buffer, replacements: ReadonlyMap<string, Buffer>): Buffer;
rebuildRaw(entries: readonly ArchiveEntry[]): Buffer;
```

Both public modules also export the `ArchiveDirectory`, `ArchiveFile`, and `ArchiveEntry` types.

## Entry model and path rules

```ts
type ArchiveEntry =
  | { type: "directory"; path: string }
  | { type: "file"; path: string; data: Buffer };
```

- Paths are relative to the archive root and use `/` as the separator.
- Paths have no leading or trailing slash. The archive root is omitted from the entry list.
- Empty paths, empty segments, `.` and `..` segments, backslashes, colons, null characters, and
  malformed Unicode are rejected.
- Duplicate paths and file/directory conflicts are rejected.
- Empty directories and empty files are supported.

## `extract(data)`

Returns directories and files in archive entry order. File data is returned as subarrays of the
input buffer, without copying the payload bytes.

**Mutating an extracted file buffer also mutates the input buffer.** Assign a different `Buffer` to
`entry.data` when editing file contents without changing the input.

```ts
const entries = extract(source);

for (const entry of entries) {
  if (entry.type === "file" && entry.path === "0-Common/000-Test.msbt") {
    entry.data = translatedMsbt;
  }
}

const rebuilt = rebuildRaw(entries);
```

Invalid archives throw an error, including malformed headers, invalid names or hierarchies, invalid
file ranges, and overlapping file data.

## `rebuild(source, replacements)`

Replaces existing files in the original archive. Map keys must be exact file paths returned by
`extract(source)`.

```ts
const replacements = new Map([["0-Common/000-Test.msbt", translatedMsbt]]);
const rebuilt = rebuild(source, replacements);
```

Contract:

- Files omitted from the map retain their contents.
- Missing paths and paths that identify directories throw an error.
- Adding, removing, or renaming entries requires `rebuildRaw`.
- The source archive is validated even when the replacement map is empty.
- The source buffer and replacement buffers are not modified.
- The header, name table, physical file order, original gap bytes, and trailing bytes are preserved,
  except for the offset and size fields that must change when files are resized.
- Same-size replacements change only the corresponding file payload bytes.
- Resized replacements recalculate file offsets and sizes, preserve other file contents, and
  maintain the alignment inferred from the source, up to `0x20`.
- An empty replacement map or byte-identical replacements produce output identical to the source,
  byte for byte.

## `rebuildRaw(entries)`

Builds a canonical U8 archive from entries. No original archive, manifest, or previous offsets are
required. This is the former `rebuild(entries)` API, renamed to `rebuildRaw(entries)`.

```ts
const data = rebuildRaw([
  { type: "directory", path: "empty" },
  { type: "file", path: "text/new.msbt", data: newMsbt },
  { type: "file", path: "data.bin", data: Buffer.from([0, 1, 255]) },
]);
```

Contract:

- Missing parent directories are created automatically.
- Entries can be added, removed, renamed, or modified before rebuilding.
- Insertion order is preserved within each directory.
- The U8 node table is written in depth-first order, with recalculated indices, sizes, and offsets.
- File payloads are aligned to `0x20` bytes.
- Paths and file contents are preserved. Original padding bytes and physical offsets are not
  preserved, so output size and hash may differ from the source.
- Caller entries and file buffers are not modified.
- `rebuildRaw([])` produces a valid empty archive.
- Invalid paths, duplicate paths, and file/directory conflicts throw an error.

## Repository layout

| Path                       | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `src/Extract.ts`           | Archive extraction and validation                                |
| `src/Rebuild.ts`           | Source-preserving replacement and canonical archive construction |
| `src/types/Archive.ts`     | Entry types and path validation                                  |
| `tests/Extract.test.ts`    | Extraction and invalid archive tests                             |
| `tests/Replace.test.ts`    | Source-preserving replacement tests                              |
| `tests/RebuildRaw.test.ts` | Canonical construction and entry editing tests                   |
| `tests/Fixtures.test.ts`   | Original archive regression tests                                |
| `tests/Files.ts`           | Filesystem helpers for tests, outside the public API             |

Internal imports use the `#/*` and `#tests/*` aliases. Binary operations use `BufferConsumer` and
`BufferBuilder` from `@triforce-heroes/triforce-core`. The project uses shared Oxc configurations,
Vitest for tests, and tsdown for builds.

## GitHub installation

The public exports point to compiled JavaScript and declarations in `dist/`. GitHub dependencies
install the committed repository contents, so `dist/` must be committed together with source
changes. Run `bun run build` before committing and include every generated file, including shared
chunks and declarations. The `files` field also includes `dist/` when packing the npm package.

Consumers can import the public modules directly without building this dependency or transpiling its
TypeScript sources.

## Verification

Run commands from the repository root:

```powershell
bun run test
bun run build
bunx oxfmt
```

`bun run build` runs lint checks, tests, and the package build. Its lint step includes TypeScript,
Oxlint, and source/test formatting checks. `bunx oxfmt` formats supported files across the
repository, subject to the formatter configuration and exclusions.

The test suite uses a synthetic U8 fixture and 99 original archives: 84 under
`tests/fixtures/{locale}/*.arc`, with six containers, `0-Common` through `5-CenterField`, across 14
languages; and 15 under `tests/fixtures/Layout/*.arc`, containing localized interface MSBT files.
The originals were copied byte for byte from the supplied dump and checked with SHA-256 when copied.
Localized layout MSBT fixtures are stored separately in
`triforce-msbt/tests/fixtures/{locale}/Layout/{archive}/*.msbt`.

Coverage includes extraction; byte-for-byte reconstruction with no replacements and with identical
contents for every extracted file; replacement growth and preservation of sibling file contents;
creation from scratch; hierarchy; empty directories and files; growing, shrinking, adding, and
removing files; alignment; UTF-8 names; and rejection of invalid archives.
