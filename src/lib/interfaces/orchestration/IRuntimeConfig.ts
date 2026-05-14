import type { LogLevel, RuntimeMode, WorkerRole } from "./IOrchestrationShared";
import type { IStorageLocation, StorageRootKey } from "./IStorageLocation";

export interface ILeaseTimingConfig {
  heartbeatIntervalMs: number;
  leaseTtlMs: number;
  staleAfterMs?: number;
}

export interface IConcurrencyConfig {
  metadataAcquisitionMaxActive: number;
  assetAcquisitionMaxActive: number;
  conversionConcurrency: number;
  metadataUpdateConcurrency?: number;
}

export interface ICentralLoggingConfig {
  enabled: boolean;
  minimumLevel: LogLevel;
  mirrorErrorsToConsole: boolean;
  backend?: "console" | "postgres";
}

export interface IControlPlaneConfig {
  mqttTopicPrefix?: string;
  mqttUrl?: string;
  postgresUrl?: string;
  schema?: string;
}

export interface IRuntimeConfig {
  mode: RuntimeMode;
  workerRole?: WorkerRole;
  controlPlane: IControlPlaneConfig;
  leases: ILeaseTimingConfig;
  concurrency: IConcurrencyConfig;
  logging: ICentralLoggingConfig;
  storageLocations: IStorageLocation[];
  defaultRoots?: Partial<Record<StorageRootKey, string>>;
}
