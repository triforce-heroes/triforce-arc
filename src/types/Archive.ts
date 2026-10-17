export interface ArchiveDirectory {
  type: "directory";
  path: string;
}

export interface ArchiveFile {
  type: "file";
  path: string;
  data: Buffer;
}

export type ArchiveEntry = ArchiveDirectory | ArchiveFile;

export function assertArchivePath(path: string): void {
  if (
    path === "" ||
    !path.isWellFormed() ||
    /[\\:\0]/v.test(path) ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`U8: invalid archive path: ${path}`);
  }
}
