import { n as ArchiveEntry, r as ArchiveFile, t as ArchiveDirectory } from "./Archive-BoEQ0KUg.mjs";
//#region src/Rebuild.d.ts
export declare function rebuildRaw(entries: readonly ArchiveEntry[]): Buffer;
export declare function rebuild(source: Buffer, replacements: ReadonlyMap<string, Buffer>): Buffer;
//#endregion
export type { ArchiveDirectory, ArchiveEntry, ArchiveFile };