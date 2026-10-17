//#region src/types/Archive.d.ts
interface ArchiveDirectory {
  type: "directory";
  path: string;
}
interface ArchiveFile {
  type: "file";
  path: string;
  data: Buffer;
}
type ArchiveEntry = ArchiveDirectory | ArchiveFile;
//#endregion
export { ArchiveEntry as n, ArchiveFile as r, ArchiveDirectory as t };