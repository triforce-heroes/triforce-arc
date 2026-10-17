import { BufferBuilder, ByteOrder } from "@triforce-heroes/triforce-core";

import { extract } from "#/Extract";
import { assertArchivePath, type ArchiveEntry } from "#/types/Archive";

export type { ArchiveDirectory, ArchiveEntry, ArchiveFile } from "#/types/Archive";

interface ArchiveNode {
  entry: ArchiveEntry;
  children: ArchiveNode[];
  parentIndex: number;
  endIndex: number;
  nameOffset: number;
  dataOffset: number;
}

function createNode(entry: ArchiveEntry): ArchiveNode {
  return { entry, children: [], parentIndex: 0, endIndex: 0, nameOffset: 0, dataOffset: 0 };
}

export function rebuildRaw(entries: readonly ArchiveEntry[]): Buffer {
  const root = createNode({ type: "directory", path: "" });
  const paths = new Map<string, ArchiveNode>([["", root]]);
  const explicitPaths = new Set<string>();

  for (const entry of entries) {
    assertArchivePath(entry.path);

    if (explicitPaths.has(entry.path)) {
      throw new Error(`U8: duplicate path: ${entry.path}`);
    }

    explicitPaths.add(entry.path);

    const parts = entry.path.split("/");
    let parent = root;
    let parentPath = "";

    for (const part of parts.slice(0, -1)) {
      parentPath = parentPath === "" ? part : `${parentPath}/${part}`;
      let directory = paths.get(parentPath);

      if (directory === undefined) {
        directory = createNode({ type: "directory", path: parentPath });
        paths.set(parentPath, directory);
        parent.children.push(directory);
      }

      if (directory.entry.type !== "directory") {
        throw new Error(`U8: parent path is not a directory: ${parentPath}`);
      }

      parent = directory;
    }

    const existing = paths.get(entry.path);

    if (existing !== undefined) {
      if (entry.type !== "directory" || existing.entry.type !== "directory") {
        throw new Error(`U8: conflicting file and directory path: ${entry.path}`);
      }

      continue;
    }

    const node = createNode(entry);

    paths.set(entry.path, node);
    parent.children.push(node);
  }

  const nodes: ArchiveNode[] = [];

  function appendNode(node: ArchiveNode, parentIndex: number): void {
    const index = nodes.length;

    const planned = { ...node, parentIndex };

    nodes.push(planned);

    for (const child of node.children) {
      appendNode(child, index);
    }

    planned.endIndex = nodes.length;
  }

  appendNode(root, 0);

  const stringsBuilder = new BufferBuilder(ByteOrder.BIG_ENDIAN);

  for (const node of nodes) {
    node.nameOffset = stringsBuilder.length;

    if (node.nameOffset > 0x00_ff_ff_ff) {
      throw new Error("U8: string table exceeds 24-bit name offsets");
    }

    const name = node.entry.path.split("/").at(-1)!;

    stringsBuilder.writeString(`${name}\0`);
  }

  const rootOffset = 0x20;
  const headerSize = nodes.length * 12 + stringsBuilder.length;
  const dataOffset = Math.ceil((rootOffset + headerSize) / 0x20) * 0x20;
  let fileOffset = dataOffset;

  for (const node of nodes) {
    if (node.entry.type !== "file") {
      continue;
    }

    node.dataOffset = fileOffset;
    fileOffset = Math.ceil((fileOffset + node.entry.data.length) / 0x20) * 0x20;
  }

  if (fileOffset > 0xff_ff_ff_ff) {
    throw new Error("U8: archive exceeds 32-bit file offsets");
  }

  const dataBuilder = new BufferBuilder(ByteOrder.BIG_ENDIAN);

  dataBuilder.writeUnsignedInt32(0x55_aa_38_2d);
  dataBuilder.writeUnsignedInt32(rootOffset);
  dataBuilder.writeUnsignedInt32(headerSize);
  dataBuilder.writeUnsignedInt32(dataOffset);
  dataBuilder.write(16);

  for (const node of nodes) {
    dataBuilder.writeUnsignedInt32(
      (node.entry.type === "directory" ? 0x01_00_00_00 : 0) + node.nameOffset,
    );

    if (node.entry.type === "directory") {
      dataBuilder.writeUnsignedInt32(node.parentIndex);
      dataBuilder.writeUnsignedInt32(node.endIndex);
      continue;
    }

    dataBuilder.writeUnsignedInt32(node.dataOffset);
    dataBuilder.writeUnsignedInt32(node.entry.data.length);
  }

  dataBuilder.push(stringsBuilder.build());
  dataBuilder.pad(0x20);

  for (const node of nodes) {
    if (node.entry.type !== "file") {
      continue;
    }

    dataBuilder.push(node.entry.data);
    dataBuilder.pad(0x20);
  }

  return dataBuilder.build();
}

interface SourceFile {
  path: string;
  data: Buffer;
  offset: number;
  nodeOffset: number;
}

export function rebuild(source: Buffer, replacements: ReadonlyMap<string, Buffer>): Buffer {
  const entries = extract(source);
  const rootOffset = source.readUInt32BE(4);
  const files: SourceFile[] = [];

  for (const [index, entry] of entries.entries()) {
    if (entry.type !== "file") {
      continue;
    }

    files.push({
      path: entry.path,
      data: entry.data,
      offset: entry.data.byteOffset - source.byteOffset,
      nodeOffset: rootOffset + (index + 1) * 12,
    });
  }

  const paths = new Map(files.map((file) => [file.path, file]));
  let changed = false;
  let resized = false;

  for (const [path, replacement] of replacements) {
    const file = paths.get(path);

    if (file === undefined) {
      throw new Error(`U8: file does not exist: ${path}`);
    }

    changed ||= !replacement.equals(file.data);
    resized ||= replacement.length !== file.data.length;
  }

  if (!changed) {
    return Buffer.from(source);
  }

  if (!resized) {
    const data = Buffer.from(source);

    for (const [path, replacement] of replacements) {
      replacement.copy(data, paths.get(path)!.offset);
    }

    return data;
  }

  const ordered = files.toSorted(
    (left, right) => left.offset - right.offset || left.data.length - right.data.length,
  );
  const prefixLength = ordered.at(0)!.offset;
  const prefix = Buffer.from(source.subarray(0, prefixLength));
  const chunks: Buffer[] = [prefix];
  const deferred: SourceFile[] = [];
  let alignment = 0x20;

  while (
    alignment > 1 &&
    files.some((file) => file.data.length > 0 && file.offset % alignment !== 0)
  ) {
    alignment /= 2;
  }

  let sourcePosition = prefixLength;
  let position = prefixLength;

  for (const file of ordered) {
    // Empty files can point inside another payload; relocate those after all physical ranges.
    if (file.offset < sourcePosition) {
      deferred.push(file);
      continue;
    }

    const gap = source.subarray(sourcePosition, file.offset);

    chunks.push(gap);
    position += gap.length;

    const padding = (alignment - (position % alignment)) % alignment;

    chunks.push(Buffer.alloc(padding));
    position += padding;

    const content = replacements.get(file.path) ?? file.data;

    if (position + content.length > 0xff_ff_ff_ff) {
      throw new Error("U8: archive exceeds 32-bit file offsets");
    }

    prefix.writeUInt32BE(position, file.nodeOffset + 4);
    prefix.writeUInt32BE(content.length, file.nodeOffset + 8);
    chunks.push(content);
    position += content.length;
    sourcePosition = file.offset + file.data.length;
  }

  for (const file of deferred) {
    const padding = (alignment - (position % alignment)) % alignment;

    chunks.push(Buffer.alloc(padding));
    position += padding;

    const content = replacements.get(file.path) ?? file.data;

    if (position + content.length > 0xff_ff_ff_ff) {
      throw new Error("U8: archive exceeds 32-bit file offsets");
    }

    prefix.writeUInt32BE(position, file.nodeOffset + 4);
    prefix.writeUInt32BE(content.length, file.nodeOffset + 8);
    chunks.push(content);
    position += content.length;
  }

  chunks.push(source.subarray(sourcePosition));

  return Buffer.concat(chunks);
}
