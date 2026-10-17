import { BufferConsumer, ByteOrder } from "@triforce-heroes/triforce-core";

import { assertArchivePath, type ArchiveEntry } from "#/types/Archive";

export type { ArchiveDirectory, ArchiveEntry, ArchiveFile } from "#/types/Archive";

export function extract(data: Buffer): ArchiveEntry[] {
  if (data.length < 32) {
    throw new Error("U8: truncated archive header");
  }

  const dataConsumer = new BufferConsumer(data, 0, ByteOrder.BIG_ENDIAN);

  BufferConsumer.assert(dataConsumer.readUnsignedInt32(), 0x55_aa_38_2d, "U8: invalid magic");

  const rootOffset = dataConsumer.readUnsignedInt32();
  const headerSize = dataConsumer.readUnsignedInt32();
  const dataOffset = dataConsumer.readUnsignedInt32();
  const stringsEnd = rootOffset + headerSize;

  if (
    rootOffset < 32 ||
    headerSize < 13 ||
    stringsEnd > data.length ||
    dataOffset < stringsEnd ||
    dataOffset > data.length
  ) {
    throw new Error("U8: invalid archive header");
  }

  dataConsumer.seek(rootOffset);

  const rootType = dataConsumer.readUnsignedInt32();
  const rootParent = dataConsumer.readUnsignedInt32();
  const nodesCount = dataConsumer.readUnsignedInt32();
  const stringsOffset = rootOffset + nodesCount * 12;

  if (
    rootType !== 0x01_00_00_00 ||
    rootParent !== 0 ||
    nodesCount === 0 ||
    stringsOffset >= stringsEnd ||
    data.at(stringsOffset) !== 0
  ) {
    throw new Error("U8: invalid root directory or node table");
  }

  const directories = [{ index: 0, path: "", end: nodesCount }];
  const paths = new Set<string>();
  const entries: ArchiveEntry[] = [];
  const fileRanges: Array<{ offset: number; size: number }> = [];
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

  for (let index = 1; index < nodesCount; index++) {
    while (index >= directories.at(-1)!.end) {
      directories.pop();
    }

    const parent = directories.at(-1)!;

    dataConsumer.seek(rootOffset + index * 12);

    const typeAndName = dataConsumer.readUnsignedInt32();
    const type = Math.floor(typeAndName / 0x01_00_00_00);
    const nameOffset = stringsOffset + (typeAndName % 0x01_00_00_00);
    const offset = dataConsumer.readUnsignedInt32();
    const size = dataConsumer.readUnsignedInt32();
    const nameEnd = data.indexOf(0, nameOffset);

    if (nameOffset >= stringsEnd || nameEnd <= nameOffset || nameEnd >= stringsEnd) {
      throw new Error("U8: invalid node name");
    }

    const name = decoder.decode(data.subarray(nameOffset, nameEnd));

    if (name.includes("/")) {
      throw new Error("U8: invalid node name");
    }

    const path = `${parent.path}${name}`;

    assertArchivePath(path);

    if (paths.has(path)) {
      throw new Error(`U8: duplicate path: ${path}`);
    }

    paths.add(path);

    if (type === 1) {
      if (offset !== parent.index || size <= index || size > parent.end) {
        throw new Error("U8: invalid directory hierarchy");
      }

      entries.push({ type: "directory", path });
      directories.push({ index, path: `${path}/`, end: size });
      continue;
    }

    if (type !== 0 || offset < dataOffset || offset > data.length || size > data.length - offset) {
      throw new Error("U8: invalid file range or node type");
    }

    dataConsumer.seek(offset);
    entries.push({ type: "file", path, data: dataConsumer.read(size) });

    if (size > 0) {
      fileRanges.push({ offset, size });
    }
  }

  fileRanges.sort((left, right) => left.offset - right.offset);

  for (let index = 1; index < fileRanges.length; index++) {
    const previous = fileRanges.at(index - 1)!;

    if (fileRanges.at(index)!.offset < previous.offset + previous.size) {
      throw new Error("U8: overlapping file data");
    }
  }

  return entries;
}
