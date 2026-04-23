import { randomUUID } from "crypto";
import { Pool, type PoolClient } from "pg";
import type {
  IClaimedWorkItem,
  ICentralLogRepository,
  ILogEntry,
  ILogQueryFilter,
  ILogQueryResult,
  IOrchestrationJob,
  IOrchestrationRepository,
  IOrchestrationStage,
  IStatusEvent,
  IWorkItem,
  IWorkerInstance,
  IWorkerLease,
  OrchestrationJobStatus,
  OrchestrationStageStatus,
  WorkItemStatus,
} from "../lib/interfaces";

const CONTROL_PLANE_SCHEMA = `
CREATE TABLE IF NOT EXISTS orchestration_jobs (
  id TEXT PRIMARY KEY,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL,
  runtime_mode TEXT NOT NULL,
  queue_name TEXT,
  priority INTEGER,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_orchestration_jobs_status ON orchestration_jobs(status);
CREATE INDEX IF NOT EXISTS idx_orchestration_jobs_created_at ON orchestration_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS orchestration_stages (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES orchestration_jobs(id) ON DELETE CASCADE,
  stage_type TEXT NOT NULL,
  status TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  payload_json JSONB,
  depends_on_stage_ids JSONB,
  resource_key TEXT,
  blocked_by_stage_id TEXT,
  last_known_job_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_orchestration_stages_job_id ON orchestration_stages(job_id, sequence);
CREATE INDEX IF NOT EXISTS idx_orchestration_stages_status ON orchestration_stages(status);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES orchestration_jobs(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES orchestration_stages(id) ON DELETE CASCADE,
  stage_type TEXT NOT NULL,
  status TEXT NOT NULL,
  worker_role TEXT NOT NULL,
  lease_owner_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  clip_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_work_items_job_id ON work_items(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_work_items_stage_id ON work_items(stage_id, created_at);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_clip_id ON work_items(clip_id);

CREATE TABLE IF NOT EXISTS worker_instances (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  runtime_mode TEXT NOT NULL,
  hostname TEXT NOT NULL,
  process_id INTEGER,
  container_id TEXT,
  capabilities_json JSONB,
  started_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  metadata_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_worker_instances_role ON worker_instances(role);
CREATE INDEX IF NOT EXISTS idx_worker_instances_heartbeat_at ON worker_instances(heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS worker_leases (
  id TEXT PRIMARY KEY,
  resource_key TEXT NOT NULL,
  status TEXT NOT NULL,
  worker_instance_id TEXT NOT NULL REFERENCES worker_instances(id) ON DELETE CASCADE,
  worker_role TEXT NOT NULL,
  job_id TEXT,
  stage_id TEXT,
  work_item_id TEXT,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_worker_leases_resource_key ON worker_leases(resource_key, status);
CREATE INDEX IF NOT EXISTS idx_worker_leases_expires_at ON worker_leases(lease_expires_at);

CREATE TABLE IF NOT EXISTS status_events (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  job_id TEXT,
  stage_id TEXT,
  work_item_id TEXT,
  worker_instance_id TEXT,
  event_type TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_status_events_job_id ON status_events(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_events_scope ON status_events(scope, created_at DESC);

CREATE TABLE IF NOT EXISTS log_entries (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json JSONB,
  error_code TEXT,
  error_stack TEXT
);

CREATE INDEX IF NOT EXISTS idx_log_entries_timestamp ON log_entries(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_log_entries_level ON log_entries(level, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_log_entries_context_job_id ON log_entries((context_json->>'jobId'));
CREATE INDEX IF NOT EXISTS idx_log_entries_context_role ON log_entries((context_json->>'role'));
CREATE INDEX IF NOT EXISTS idx_log_entries_context_worker_instance_id ON log_entries((context_json->>'workerInstanceId'));
CREATE INDEX IF NOT EXISTS idx_log_entries_context_clip_id ON log_entries((context_json->>'clipId'));
`;

export type ControlPlaneOptions = {
  postgresUrl?: string;
  schema?: string;
};

export function resolveControlPlanePostgresUrl(postgresUrl?: string): string {
  const resolved = postgresUrl?.trim()
    || process.env.SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL
    || process.env.SUNO_EXPORT_POSTGRES_URL;

  if (!resolved) {
    throw new Error(
      "Postgres control plane selected; provide config.controlPlane.postgresUrl, SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL, or SUNO_EXPORT_POSTGRES_URL",
    );
  }

  return resolved;
}

export class PostgresControlPlaneRepository implements IOrchestrationRepository, ICentralLogRepository {
  private readonly pool: Pool;
  private initialized = false;

  constructor(private readonly options: ControlPlaneOptions = {}) {
    this.pool = new Pool({
      connectionString: resolveControlPlanePostgresUrl(options.postgresUrl),
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const client = await this.pool.connect();
    try {
      await this.applySchema(client);
      this.initialized = true;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async createJob(job: IOrchestrationJob): Promise<IOrchestrationJob> {
    await this.initialize();
    await this.pool.query(
      `
      INSERT INTO orchestration_jobs (
        id, workflow_type, status, runtime_mode, queue_name, priority, payload_json,
        created_at, updated_at, started_at, completed_at, error_code, error_message
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
      `,
      [
        job.id,
        job.workflowType,
        job.status,
        job.runtimeMode,
        job.queueName ?? null,
        job.priority ?? null,
        toJson(job.payload),
        toDate(job.createdAt),
        toDate(job.updatedAt),
        toDate(job.startedAt),
        toDate(job.completedAt),
        job.errorCode ?? null,
        job.errorMessage ?? null,
      ],
    );
    return job;
  }

  async getJob(jobId: string): Promise<IOrchestrationJob | undefined> {
    await this.initialize();
    const result = await this.pool.query(`SELECT * FROM orchestration_jobs WHERE id = $1`, [jobId]);
    return result.rows[0] ? mapJobRow(result.rows[0]) : undefined;
  }

  async listJobs(limit: number = 100): Promise<IOrchestrationJob[]> {
    await this.initialize();
    const result = await this.pool.query(
      `SELECT * FROM orchestration_jobs ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapJobRow);
  }

  async updateJobStatus(
    jobId: string,
    status: OrchestrationJobStatus,
    details: Partial<Pick<IOrchestrationJob, "startedAt" | "completedAt" | "errorCode" | "errorMessage">> = {},
  ): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `
      UPDATE orchestration_jobs
      SET status = $2,
          started_at = COALESCE($3, started_at),
          completed_at = COALESCE($4, completed_at),
          error_code = COALESCE($5, error_code),
          error_message = COALESCE($6, error_message),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [jobId, status, toDate(details.startedAt), toDate(details.completedAt), details.errorCode ?? null, details.errorMessage ?? null],
    );
  }

  async createStage(stage: IOrchestrationStage): Promise<IOrchestrationStage> {
    await this.initialize();
    await this.pool.query(
      `
      INSERT INTO orchestration_stages (
        id, job_id, stage_type, status, sequence, payload_json, depends_on_stage_ids,
        resource_key, blocked_by_stage_id, last_known_job_status,
        created_at, updated_at, started_at, completed_at, error_code, error_message
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `,
      [
        stage.id,
        stage.jobId,
        stage.stageType,
        stage.status,
        stage.sequence,
        toNullableJson(stage.payload),
        toNullableJson(stage.dependsOnStageIds),
        stage.resourceKey ?? null,
        stage.blockedByStageId ?? null,
        stage.lastKnownJobStatus ?? null,
        toDate(stage.createdAt),
        toDate(stage.updatedAt),
        toDate(stage.startedAt),
        toDate(stage.completedAt),
        stage.errorCode ?? null,
        stage.errorMessage ?? null,
      ],
    );
    return stage;
  }

  async listStages(jobId: string): Promise<IOrchestrationStage[]> {
    await this.initialize();
    const result = await this.pool.query(
      `SELECT * FROM orchestration_stages WHERE job_id = $1 ORDER BY sequence ASC, created_at ASC`,
      [jobId],
    );
    return result.rows.map(mapStageRow);
  }

  async updateStageStatus(
    stageId: string,
    status: OrchestrationStageStatus,
    details: Partial<Pick<IOrchestrationStage, "startedAt" | "completedAt" | "blockedByStageId" | "errorCode" | "errorMessage">> = {},
  ): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `
      UPDATE orchestration_stages
      SET status = $2,
          started_at = COALESCE($3, started_at),
          completed_at = COALESCE($4, completed_at),
          blocked_by_stage_id = COALESCE($5, blocked_by_stage_id),
          error_code = COALESCE($6, error_code),
          error_message = COALESCE($7, error_message),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [stageId, status, toDate(details.startedAt), toDate(details.completedAt), details.blockedByStageId ?? null, details.errorCode ?? null, details.errorMessage ?? null],
    );
  }

  async createWorkItem(workItem: IWorkItem): Promise<IWorkItem> {
    await this.initialize();
    await this.pool.query(
      `
      INSERT INTO work_items (
        id, job_id, stage_id, stage_type, status, worker_role, lease_owner_id,
        attempt_count, max_attempts, payload_json, clip_id,
        created_at, updated_at, started_at, completed_at, error_code, error_message
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17)
      `,
      [
        workItem.id,
        workItem.jobId,
        workItem.stageId,
        workItem.stageType,
        workItem.status,
        workItem.workerRole,
        workItem.leaseOwnerId ?? null,
        workItem.attemptCount,
        workItem.maxAttempts ?? null,
        toJson(workItem.payload),
        workItem.clipId ?? null,
        toDate(workItem.createdAt),
        toDate(workItem.updatedAt),
        toDate(workItem.startedAt),
        toDate(workItem.completedAt),
        workItem.errorCode ?? null,
        workItem.errorMessage ?? null,
      ],
    );
    return workItem;
  }

  async listWorkItems(jobId: string): Promise<IWorkItem[]> {
    await this.initialize();
    const result = await this.pool.query(
      `SELECT * FROM work_items WHERE job_id = $1 ORDER BY created_at ASC`,
      [jobId],
    );
    return result.rows.map(mapWorkItemRow);
  }

  async claimNextRunnableWorkItem(workerRole: IWorkItem["workerRole"], workerInstanceId: string): Promise<IClaimedWorkItem | null> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const candidateResult = await client.query(
        `
        SELECT
          w.*,
          s.id AS stage_record_id,
          s.job_id AS stage_job_id,
          s.stage_type AS stage_record_type,
          s.status AS stage_record_status,
          s.sequence AS stage_record_sequence,
          s.payload_json AS stage_payload_json,
          s.depends_on_stage_ids AS stage_depends_on_stage_ids,
          s.resource_key AS stage_resource_key,
          s.blocked_by_stage_id AS stage_blocked_by_stage_id,
          s.last_known_job_status AS stage_last_known_job_status,
          s.created_at AS stage_created_at,
          s.updated_at AS stage_updated_at,
          s.started_at AS stage_started_at,
          s.completed_at AS stage_completed_at,
          s.error_code AS stage_error_code,
          s.error_message AS stage_error_message,
          j.id AS job_record_id,
          j.workflow_type AS job_workflow_type,
          j.status AS job_record_status,
          j.runtime_mode AS job_runtime_mode,
          j.queue_name AS job_queue_name,
          j.priority AS job_priority,
          j.payload_json AS job_payload_json,
          j.created_at AS job_created_at,
          j.updated_at AS job_updated_at,
          j.started_at AS job_started_at,
          j.completed_at AS job_completed_at,
          j.error_code AS job_error_code,
          j.error_message AS job_error_message
        FROM work_items w
        INNER JOIN orchestration_stages s ON s.id = w.stage_id
        INNER JOIN orchestration_jobs j ON j.id = w.job_id
        WHERE j.status IN ('queued', 'running')
          AND w.worker_role = $1
          AND w.status IN ('pending', 'blocked')
          AND NOT EXISTS (
            SELECT 1
            FROM orchestration_stages prior
            WHERE prior.job_id = s.job_id
              AND prior.sequence < s.sequence
              AND prior.status <> 'succeeded'
          )
        ORDER BY w.created_at ASC
        FOR UPDATE OF w SKIP LOCKED
        LIMIT 1
        `,
        [workerRole],
      );

      if (candidateResult.rows.length === 0) {
        await client.query("COMMIT");
        return null;
      }

      const row = candidateResult.rows[0];
      const claimedAt = new Date();
      await client.query(
        `
        UPDATE work_items
        SET status = 'leased',
            lease_owner_id = $2,
            updated_at = $3
        WHERE id = $1
        `,
        [row.id, workerInstanceId, claimedAt],
      );
      await client.query(
        `
        UPDATE orchestration_stages
        SET status = 'queued',
            updated_at = $2
        WHERE id = $1
        `,
        [row.stage_record_id, claimedAt],
      );
      await client.query("COMMIT");

      return {
        job: mapClaimedJobRow(row),
        stage: mapClaimedStageRow(row),
        workItem: {
          ...mapWorkItemRow(row),
          status: "leased",
          leaseOwnerId: workerInstanceId,
          updatedAt: claimedAt,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateWorkItemStatus(
    workItemId: string,
    status: WorkItemStatus,
    details: Partial<Pick<IWorkItem, "startedAt" | "completedAt" | "leaseOwnerId" | "errorCode" | "errorMessage">> = {},
  ): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `
      UPDATE work_items
      SET status = $2,
          started_at = COALESCE($3, started_at),
          completed_at = COALESCE($4, completed_at),
          lease_owner_id = COALESCE($5, lease_owner_id),
          error_code = COALESCE($6, error_code),
          error_message = COALESCE($7, error_message),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [workItemId, status, toDate(details.startedAt), toDate(details.completedAt), details.leaseOwnerId ?? null, details.errorCode ?? null, details.errorMessage ?? null],
    );
  }

  async upsertWorkerInstance(worker: IWorkerInstance): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `
      INSERT INTO worker_instances (
        id, role, runtime_mode, hostname, process_id, container_id, capabilities_json,
        started_at, heartbeat_at, metadata_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb)
      ON CONFLICT(id) DO UPDATE SET
        role = excluded.role,
        runtime_mode = excluded.runtime_mode,
        hostname = excluded.hostname,
        process_id = excluded.process_id,
        container_id = excluded.container_id,
        capabilities_json = excluded.capabilities_json,
        heartbeat_at = excluded.heartbeat_at,
        metadata_json = excluded.metadata_json
      `,
      [
        worker.id,
        worker.role,
        worker.runtimeMode,
        worker.hostname,
        worker.processId ?? null,
        worker.containerId ?? null,
        toNullableJson(worker.capabilities),
        toDate(worker.startedAt),
        toDate(worker.heartbeatAt),
        toNullableJson(worker.metadata),
      ],
    );
  }

  async heartbeatWorkerInstance(workerInstanceId: string, heartbeatAt: Date = new Date()): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `UPDATE worker_instances SET heartbeat_at = $2 WHERE id = $1`,
      [workerInstanceId, toDate(heartbeatAt)],
    );
  }

  async upsertLease(lease: IWorkerLease): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `
      INSERT INTO worker_leases (
        id, resource_key, status, worker_instance_id, worker_role, job_id, stage_id,
        work_item_id, lease_expires_at, heartbeat_at, created_at, updated_at, released_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT(id) DO UPDATE SET
        resource_key = excluded.resource_key,
        status = excluded.status,
        worker_instance_id = excluded.worker_instance_id,
        worker_role = excluded.worker_role,
        job_id = excluded.job_id,
        stage_id = excluded.stage_id,
        work_item_id = excluded.work_item_id,
        lease_expires_at = excluded.lease_expires_at,
        heartbeat_at = excluded.heartbeat_at,
        updated_at = excluded.updated_at,
        released_at = excluded.released_at
      `,
      [
        lease.id,
        lease.resourceKey,
        lease.status,
        lease.workerInstanceId,
        lease.workerRole,
        lease.jobId ?? null,
        lease.stageId ?? null,
        lease.workItemId ?? null,
        toDate(lease.leaseExpiresAt),
        toDate(lease.heartbeatAt),
        toDate(lease.createdAt),
        toDate(lease.updatedAt),
        toDate(lease.releasedAt),
      ],
    );
  }

  async releaseLease(leaseId: string, releasedAt: Date = new Date()): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `
      UPDATE worker_leases
      SET status = 'released',
          released_at = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [leaseId, toDate(releasedAt)],
    );
  }

  async listActiveLeases(resourceKey?: string): Promise<IWorkerLease[]> {
    await this.initialize();
    const result = resourceKey
      ? await this.pool.query(
        `SELECT * FROM worker_leases WHERE status = 'active' AND resource_key = $1 ORDER BY created_at ASC`,
        [resourceKey],
      )
      : await this.pool.query(
        `SELECT * FROM worker_leases WHERE status = 'active' ORDER BY created_at ASC`,
      );
    return result.rows.map(mapLeaseRow);
  }

  async acquireLease(params: {
    resourceKey: string;
    workerInstanceId: string;
    workerRole: IWorkerLease["workerRole"];
    jobId?: string;
    stageId?: string;
    workItemId?: string;
    maxActive: number;
    conflictResourceKeys?: string[];
    leaseTtlMs?: number;
  }): Promise<IWorkerLease | null> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = new Date();
      const conflictKeys = [params.resourceKey, ...(params.conflictResourceKeys ?? [])];
      await client.query(
        `
        UPDATE worker_leases
        SET status = 'expired',
            updated_at = $2
        WHERE status = 'active'
          AND resource_key = ANY($1::text[])
          AND lease_expires_at <= $2
        `,
        [conflictKeys, now],
      );

      const activeConflictResult = await client.query(
        `
        SELECT id
        FROM worker_leases
        WHERE status = 'active'
          AND resource_key = ANY($1::text[])
        FOR UPDATE
        `,
        [conflictKeys],
      );
      if ((activeConflictResult.rowCount ?? 0) >= params.maxActive) {
        await client.query("COMMIT");
        return null;
      }

      const lease: IWorkerLease = {
        id: randomLeaseId(),
        resourceKey: params.resourceKey,
        status: "active",
        workerInstanceId: params.workerInstanceId,
        workerRole: params.workerRole,
        jobId: params.jobId,
        stageId: params.stageId,
        workItemId: params.workItemId,
        leaseExpiresAt: new Date(now.getTime() + (params.leaseTtlMs ?? 30_000)),
        heartbeatAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await client.query(
        `
        INSERT INTO worker_leases (
          id, resource_key, status, worker_instance_id, worker_role, job_id, stage_id,
          work_item_id, lease_expires_at, heartbeat_at, created_at, updated_at, released_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `,
        [
          lease.id,
          lease.resourceKey,
          lease.status,
          lease.workerInstanceId,
          lease.workerRole,
          lease.jobId ?? null,
          lease.stageId ?? null,
          lease.workItemId ?? null,
          toDate(lease.leaseExpiresAt),
          toDate(lease.heartbeatAt),
          toDate(lease.createdAt),
          toDate(lease.updatedAt),
          toDate(lease.releasedAt),
        ],
      );
      await client.query("COMMIT");
      return lease;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendStatusEvent(event: IStatusEvent): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `
      INSERT INTO status_events (
        id, scope, entity_id, job_id, stage_id, work_item_id, worker_instance_id,
        event_type, level, message, payload_json, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      `,
      [
        event.id,
        event.scope,
        event.entityId,
        event.jobId ?? null,
        event.stageId ?? null,
        event.workItemId ?? null,
        event.workerInstanceId ?? null,
        event.eventType,
        event.level,
        event.message,
        toNullableJson(event.payload),
        toDate(event.createdAt),
      ],
    );
  }

  async listStatusEvents(jobId: string): Promise<IStatusEvent[]> {
    await this.initialize();
    const result = await this.pool.query(
      `SELECT * FROM status_events WHERE job_id = $1 ORDER BY created_at ASC`,
      [jobId],
    );
    return result.rows.map(mapStatusEventRow);
  }

  async write(entry: ILogEntry): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `
      INSERT INTO log_entries (timestamp, level, message, context_json, error_code, error_stack)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6)
      `,
      [
        toDate(entry.timestamp),
        entry.level,
        entry.message,
        toNullableJson(entry.context),
        entry.errorCode ?? null,
        entry.errorStack ?? null,
      ],
    );
  }

  async query(filter: ILogQueryFilter = {}): Promise<ILogQueryResult> {
    await this.initialize();
    const { clauseSql, params } = buildLogQuery(filter);
    const limit = filter.limit ?? 100;
    const result = await this.pool.query(
      `
      SELECT id, timestamp, level, message, context_json, error_code, error_stack
      FROM log_entries
      ${clauseSql}
      ORDER BY timestamp DESC, id DESC
      LIMIT $${params.length + 1}
      `,
      [...params, limit],
    );

    return {
      entries: result.rows.map(mapLogRow),
    };
  }

  private async applySchema(client: PoolClient): Promise<void> {
    if (this.options.schema?.trim()) {
      const schemaName = this.options.schema.trim();
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`);
      await client.query(`SET search_path TO ${quoteIdentifier(schemaName)}, public`);
    }

    await client.query(CONTROL_PLANE_SCHEMA);
  }
}

type BuiltQuery = {
  clauseSql: string;
  params: unknown[];
};

export function buildLogQuery(filter: ILogQueryFilter = {}): BuiltQuery {
  const clauses: string[] = [];
  const params: unknown[] = [];

  addEqualsClause(clauses, params, "context_json->>'jobId'", filter.jobId);
  addEqualsClause(clauses, params, "context_json->>'stageId'", filter.stageId);
  addEqualsClause(clauses, params, "context_json->>'workItemId'", filter.workItemId);
  addEqualsClause(clauses, params, "context_json->>'workflowType'", filter.workflowType);
  addEqualsClause(clauses, params, "context_json->>'workerInstanceId'", filter.workerInstanceId);
  addEqualsClause(clauses, params, "context_json->>'role'", filter.role);
  addEqualsClause(clauses, params, "context_json->>'clipId'", filter.clipId);
  addEqualsClause(clauses, params, "level", filter.level);

  if (filter.startTime) {
    params.push(toDate(filter.startTime));
    clauses.push(`timestamp >= $${params.length}`);
  }

  if (filter.endTime) {
    params.push(toDate(filter.endTime));
    clauses.push(`timestamp <= $${params.length}`);
  }

  return {
    clauseSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function addEqualsClause(clauses: string[], params: unknown[], sql: string, value: unknown): void {
  if (value == null || value === "") return;
  params.push(value);
  clauses.push(`${sql} = $${params.length}`);
}

function toDate(value?: Date): Date | null {
  return value ?? null;
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function toNullableJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function fromDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value : new Date(String(value));
}

function mapJobRow(row: any): IOrchestrationJob {
  return {
    id: row.id,
    workflowType: row.workflow_type,
    status: row.status,
    runtimeMode: row.runtime_mode,
    queueName: row.queue_name ?? undefined,
    priority: row.priority ?? undefined,
    payload: row.payload_json ?? {},
    createdAt: fromDate(row.created_at) ?? new Date(),
    updatedAt: fromDate(row.updated_at) ?? new Date(),
    startedAt: fromDate(row.started_at),
    completedAt: fromDate(row.completed_at),
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

function mapStageRow(row: any): IOrchestrationStage {
  return {
    id: row.id,
    jobId: row.job_id,
    stageType: row.stage_type,
    status: row.status,
    sequence: row.sequence,
    payload: row.payload_json ?? undefined,
    dependsOnStageIds: row.depends_on_stage_ids ?? undefined,
    resourceKey: row.resource_key ?? undefined,
    blockedByStageId: row.blocked_by_stage_id ?? undefined,
    lastKnownJobStatus: row.last_known_job_status ?? undefined,
    createdAt: fromDate(row.created_at) ?? new Date(),
    updatedAt: fromDate(row.updated_at) ?? new Date(),
    startedAt: fromDate(row.started_at),
    completedAt: fromDate(row.completed_at),
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

function mapWorkItemRow(row: any): IWorkItem {
  return {
    id: row.id,
    jobId: row.job_id,
    stageId: row.stage_id,
    stageType: row.stage_type,
    status: row.status,
    workerRole: row.worker_role,
    leaseOwnerId: row.lease_owner_id ?? undefined,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts ?? undefined,
    payload: row.payload_json ?? {},
    clipId: row.clip_id ?? undefined,
    createdAt: fromDate(row.created_at) ?? new Date(),
    updatedAt: fromDate(row.updated_at) ?? new Date(),
    startedAt: fromDate(row.started_at),
    completedAt: fromDate(row.completed_at),
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

function mapLeaseRow(row: any): IWorkerLease {
  return {
    id: row.id,
    resourceKey: row.resource_key,
    status: row.status,
    workerInstanceId: row.worker_instance_id,
    workerRole: row.worker_role,
    jobId: row.job_id ?? undefined,
    stageId: row.stage_id ?? undefined,
    workItemId: row.work_item_id ?? undefined,
    leaseExpiresAt: fromDate(row.lease_expires_at) ?? new Date(),
    heartbeatAt: fromDate(row.heartbeat_at) ?? new Date(),
    createdAt: fromDate(row.created_at) ?? new Date(),
    updatedAt: fromDate(row.updated_at) ?? new Date(),
    releasedAt: fromDate(row.released_at),
  };
}

function mapStatusEventRow(row: any): IStatusEvent {
  return {
    id: row.id,
    scope: row.scope,
    entityId: row.entity_id,
    jobId: row.job_id ?? undefined,
    stageId: row.stage_id ?? undefined,
    workItemId: row.work_item_id ?? undefined,
    workerInstanceId: row.worker_instance_id ?? undefined,
    eventType: row.event_type,
    level: row.level,
    message: row.message,
    payload: row.payload_json ?? undefined,
    createdAt: fromDate(row.created_at) ?? new Date(),
  };
}

function mapLogRow(row: any): ILogEntry {
  return {
    id: String(row.id),
    timestamp: fromDate(row.timestamp) ?? new Date(),
    level: row.level,
    message: row.message,
    context: row.context_json ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorStack: row.error_stack ?? undefined,
  };
}

function mapClaimedJobRow(row: any): IOrchestrationJob {
  return {
    id: row.job_record_id,
    workflowType: row.job_workflow_type,
    status: row.job_record_status,
    runtimeMode: row.job_runtime_mode,
    queueName: row.job_queue_name ?? undefined,
    priority: row.job_priority ?? undefined,
    payload: row.job_payload_json ?? {},
    createdAt: fromDate(row.job_created_at) ?? new Date(),
    updatedAt: fromDate(row.job_updated_at) ?? new Date(),
    startedAt: fromDate(row.job_started_at),
    completedAt: fromDate(row.job_completed_at),
    errorCode: row.job_error_code ?? undefined,
    errorMessage: row.job_error_message ?? undefined,
  };
}

function mapClaimedStageRow(row: any): IOrchestrationStage {
  return {
    id: row.stage_record_id,
    jobId: row.stage_job_id,
    stageType: row.stage_record_type,
    status: row.stage_record_status,
    sequence: row.stage_record_sequence,
    payload: row.stage_payload_json ?? undefined,
    dependsOnStageIds: row.stage_depends_on_stage_ids ?? undefined,
    resourceKey: row.stage_resource_key ?? undefined,
    blockedByStageId: row.stage_blocked_by_stage_id ?? undefined,
    lastKnownJobStatus: row.stage_last_known_job_status ?? undefined,
    createdAt: fromDate(row.stage_created_at) ?? new Date(),
    updatedAt: fromDate(row.stage_updated_at) ?? new Date(),
    startedAt: fromDate(row.stage_started_at),
    completedAt: fromDate(row.stage_completed_at),
    errorCode: row.stage_error_code ?? undefined,
    errorMessage: row.stage_error_message ?? undefined,
  };
}

function randomLeaseId(): string {
  return `lease-${randomUUID()}`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}
