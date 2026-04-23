import * as path from "path";
import type { IResolvedStoragePath, IRuntimeConfig, IStorageLocation, StorageRootKey } from "../lib/interfaces";

export class PathResolver {
  constructor(private readonly config: Pick<IRuntimeConfig, "storageLocations" | "defaultRoots">) {}

  resolveRoot(rootKey: StorageRootKey): IStorageLocation {
    const configuredRootPath = this.config.defaultRoots?.[rootKey];
    const configuredLocation = configuredRootPath
      ? this.config.storageLocations.find((location) => {
        return location.rootKey === rootKey && path.resolve(location.path) === path.resolve(configuredRootPath);
      })
      : undefined;

    const location = configuredLocation
      ?? this.config.storageLocations.find((candidate) => candidate.rootKey === rootKey);

    if (!location) {
      throw new Error(`No storage location configured for root ${rootKey}`);
    }

    return location;
  }

  resolve(rootKey: StorageRootKey, relativePath?: string): IResolvedStoragePath {
    const location = this.resolveRoot(rootKey);
    const absolutePath = relativePath
      ? path.resolve(location.path, relativePath)
      : path.resolve(location.path);

    return {
      location,
      absolutePath,
      relativePath,
    };
  }

  relativize(rootKey: StorageRootKey, absolutePath: string): string {
    const location = this.resolveRoot(rootKey);
    const relativePath = path.relative(path.resolve(location.path), path.resolve(absolutePath));
    if (relativePath.startsWith("..")) {
      throw new Error(`Path ${absolutePath} is outside configured root ${rootKey}`);
    }
    return relativePath || ".";
  }
}

