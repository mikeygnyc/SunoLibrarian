import type { IRuntimeConfig } from "../core/contracts";

export const DEFAULT_RUNTIME_CONFIG: IRuntimeConfig = {
  mode: "distributed",
  controlPlane: {},
  leases: {
    heartbeatIntervalMs: 5_000,
    leaseTtlMs: 30_000,
    staleAfterMs: 60_000,
  },
  concurrency: {
    metadataAcquisitionMaxActive: 1,
    assetAcquisitionMaxActive: 1,
    conversionConcurrency: 4,
    metadataUpdateConcurrency: 8,
  },
  logging: {
    enabled: true,
    minimumLevel: "info",
    mirrorErrorsToConsole: true,
    backend: "console",
  },
  storageLocations: [],
  defaultRoots: {},
};
