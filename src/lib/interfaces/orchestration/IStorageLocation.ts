export type StorageLocationKind = "local" | "network-share";

export type StorageRootKey =
  | "download-root"
  | "library-root"
  | "metadata-export-root"
  | "images-root"
  | "workspace-root"
  | "logs-root";

export interface IStorageLocation {
  id: string;
  kind: StorageLocationKind;
  rootKey: StorageRootKey;
  path: string;
  description?: string;
  readOnly?: boolean;
  metadata?: Record<string, unknown>;
}

export interface IResolvedStoragePath {
  location: IStorageLocation;
  absolutePath: string;
  relativePath?: string;
}

