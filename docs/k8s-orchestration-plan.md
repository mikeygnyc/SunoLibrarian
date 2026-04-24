# Kubernetes Orchestration Plan

This document maps the current `suno-export` orchestration runtime to a
Kubernetes deployment model and proposes an incremental path toward a possible
operator.

## Summary

The current runtime is already close to a k8s-friendly shape:

- workflow commands submit durable jobs
- the control plane can be backed by Postgres
- workers are already split by role
- leases enforce global exclusivity and role-level concurrency
- logs and status are queryable outside the worker process

That means Kubernetes should be treated primarily as a deployment and lifecycle
layer, not as a reason to redesign the workflow model again.

Recommended path:

1. ship a Postgres-backed k8s deployment using standard primitives first
2. prove worker behavior, shared storage, auth handling, and observability
3. add an operator only after the runtime contract is stable and repetitive
   operational workflows are clear

## Current Runtime Fit

The existing model lines up well with Kubernetes concepts:

- `run-orchestrator`: long-running controller-style process
- `run-worker --role ...`: long-running role-specific workers
- Postgres control plane: shared durable coordination backend
- shared filesystem roots: shared mounted volumes
- structured logs and status tables: operational visibility surface

The runtime already distinguishes:

- exclusive stages: metadata acquisition and asset acquisition
- scalable stages: processing and conversion
- durable worker identity and lease heartbeats

That is enough to run the system on multiple pods without changing the core job
contract.

## Recommended Target Architecture

Use Kubernetes to run five main concerns:

- `submitter`: optional CLI or API entrypoint that creates jobs
- `orchestrator`: one active control loop deployment
- `workers`: separate deployments per role
- `postgres`: control-plane database, ideally managed outside the cluster or by
  a standard Postgres chart/service
- `shared storage`: RWX volume for downloads, metadata exports, images, and
  processed assets

Suggested pod layout:

- `orchestrator` Deployment with `replicas: 1` initially
- `worker-auth` Deployment with `replicas: 1`
- `worker-metadata` Deployment with `replicas: 1`
- `worker-asset` Deployment with `replicas: 1`
- `worker-processing` Deployment with horizontal scaling allowed
- `worker-conversion` Deployment with horizontal scaling allowed

Suggested external dependencies:

- Postgres for orchestration and centralized logs
- RWX storage class backed by EFS, CephFS, Azure Files, NFS, or equivalent
- Secret store for auth bootstrap material and Postgres credentials

## Deployment Model

### 1. Containerization

Build one image that contains the CLI and runtime. Use command overrides per
Deployment:

- `suno-export run-orchestrator`
- `suno-export run-worker --role auth`
- `suno-export run-worker --role metadata`
- `suno-export run-worker --role asset`
- `suno-export run-worker --role processing`
- `suno-export run-worker --role conversion`

This keeps runtime behavior identical across local, VM, and k8s environments.

### 2. Config and Secrets

Represent runtime config as:

- ConfigMap for non-secret runtime defaults
- Secret for Postgres URL and any token/bootstrap auth material
- env vars for control-plane connection and storage root mapping

Important config to externalize:

- `SUNO_EXPORT_CONTROL_PLANE_POSTGRES_URL`
- runtime mode and control plane backend
- lease timing
- concurrency limits
- storage root mappings
- log level and logging backend

### 3. Shared Storage

The runtime assumes all participating workers can see the same files. For k8s,
make that explicit:

- mount a shared RWX volume at a consistent path in every pod
- define logical storage roots that resolve to that shared path
- keep path conventions stable across orchestrator and worker pods

Initial assumption:

- one shared mounted filesystem is simpler and lower risk than introducing
  object storage now

### 4. Networking

Internal network requirements are minimal:

- workers need Postgres access
- workers need outbound access to Suno endpoints
- auth workers may need browser/debug endpoint access if connecting to a
  remote Chrome instance

Restrict ingress. Most components only need egress plus cluster-internal
service discovery.

## Auth Strategy

Authentication is the least k8s-native part of the current system because
`src/auth.ts` depends on Chrome/Puppeteer and browser token extraction.

Recommended phases:

1. treat auth as an externally bootstrapped dependency
2. let operators inject a short-lived token or refresh it from a controlled
   browser environment
3. only later decide whether browser automation should run inside the cluster

Near-term recommendation:

- keep browser-based login outside the cluster
- store the extracted token in a Secret or another secure secret manager
- let the `auth` role validate and rotate cached tokens, but avoid making k8s
  responsible for interactive login

This avoids coupling normal worker scaling to a full browser runtime.

## Observability

The Postgres-backed log/status model already gives a good baseline. On k8s we
should add standard platform signals around it:

- pod logs shipped to a cluster log backend
- readiness and liveness probes
- Prometheus-compatible metrics if we add them later
- dashboards for queued jobs, running jobs, failed jobs, lease contention, and
  per-role throughput

Recommended first metrics:

- jobs submitted/completed/failed
- work items claimed/completed/failed
- lease acquisition latency
- work-item queue depth by role
- active workers by role
- processing and conversion durations

## Autoscaling

Autoscaling should follow role semantics, not generic CPU-only rules.

Safe first pass:

- keep `orchestrator`, `auth`, `metadata`, and `asset` fixed at 1 replica
- allow `processing` and `conversion` workers to scale horizontally

Better autoscaling later:

- scale processing workers on queued processing work items
- scale conversion workers on queued conversion work items
- keep exclusive-acquisition roles pinned unless the runtime contract changes

This strongly suggests queue-depth-based autoscaling over simple CPU/HPA alone.

## Failure Model

The existing lease and heartbeat model is a good fit for pod churn:

- pod dies: heartbeat expires
- lease expires: work can be reclaimed
- orchestrator or worker restarts: state survives in Postgres

Before production rollout, verify:

- idempotent work-item retry behavior
- partial file cleanup or resume behavior
- duplicate conversion/download protection
- graceful shutdown on `SIGTERM`

Kubernetes will surface restarts often enough that these behaviors need to be
first-class, not best-effort.

## Security Model

Baseline controls:

- run containers as non-root
- use read-only root filesystem where practical
- mount only the shared volume and required temp dirs
- store Postgres credentials and tokens in Secrets
- apply NetworkPolicies for Postgres and outbound access
- avoid logging bearer tokens or raw auth headers

## Operator Decision

An operator is plausible, but it should come after the plain k8s deployment is
proven.

### Why not start with an operator

- the runtime contract is still settling
- auth and shared-storage assumptions are the real hard parts right now
- standard Deployments, CronJobs, HPAs, and ConfigMaps can cover the first
  production version
- an operator would add another control plane before we fully understand the
  steady-state operational workflows

### When an operator becomes worth it

Build an operator when we want custom lifecycle management such as:

- declarative `SunoExportCluster` installation
- automatic creation of orchestrator/worker deployments by role
- reconciliation of concurrency and replica policy
- queue-depth-aware autoscaling hooks
- per-workflow custom resources such as `SunoExportJob`
- status rollups in Kubernetes-native objects

### Likely CRDs

If we do build one, the first CRDs should probably be:

- `SunoExportRuntime`
  - desired worker roles
  - replica policies
  - storage mounts
  - control-plane connection refs
  - logging and concurrency config
- `SunoExportJob`
  - workflow type
  - payload or input refs
  - status summary mirrored from Postgres
  - links to logs and outputs

Recommendation:

- do not move orchestration truth into the operator
- let Postgres remain the runtime source of truth
- let the operator reconcile infrastructure and mirror status, not replace the
  internal job state machine

## Implementation Roadmap

### Phase 0: Runtime Hardening

Goal: make the current distributed runtime safe to run in ephemeral pods.

Tasks:

- verify all worker commands handle `SIGTERM` cleanly
- verify leases expire and work is reclaimable after hard pod death
- document required shared filesystem semantics
- make worker startup configuration fully env-driven
- ensure logs/status are sufficient for remote operations

### Phase 1: Container + Plain Kubernetes

Goal: run the existing runtime on k8s without introducing new control-plane
code.

Tasks:

- add production Dockerfile
- add example manifests or Helm chart
- deploy Postgres-backed control plane
- deploy shared storage
- deploy one orchestrator and one worker deployment per role
- validate `download`, `process`, and `sync` flows end-to-end

Success criteria:

- jobs can be submitted from outside the cluster
- workers claim and complete work through Postgres
- pod restart does not corrupt job state
- outputs are visible on shared storage

### Phase 2: Operational Maturity

Goal: make the plain k8s deployment operable.

Tasks:

- add health probes
- add metrics and dashboards
- add alerting for stuck leases, failed jobs, and queue buildup
- add auth-expired and auth-required states that pause affected work and
  surface clear operator action
- add a supported operator token update flow
- add autoscaling for processing/conversion workers
- add cancellation and backpressure controls before scaling worker counts
- document auth bootstrap and rotation workflow

### Phase 3: Optional Operator

Goal: reduce operational toil once deployment patterns are stable.

Tasks:

- define `SunoExportRuntime` CRD
- reconcile deployments, config, secrets refs, and storage bindings
- optionally define `SunoExportJob` CRD as a submission/status mirror
- integrate queue-depth-aware scaling decisions

Success criteria:

- operator removes repetitive manifest management
- operator does not duplicate or replace the internal orchestration state
- runtime behavior remains identical with or without the operator

## Required Code Changes Before K8s

The repo is already partway there, but these gaps are worth addressing before a
real deployment:

- make storage root configuration explicit and fully documented for containers
- harden signal handling and shutdown behavior in long-running loops
- confirm the Postgres control plane is complete for all worker paths, not just
  local orchestration and log storage
- add metrics emission points around leases, queue depth, and work-item timing
- add auth pause/resume behavior and a supported token injection path
- introduce cancellation and backpressure primitives before queue-depth-based
  autoscaling
- define a shared HTTP API contract so CLI and future dashboard usage go
  through the same backend path

## Resolved Decisions

- Auth model for long-running clustered execution:
  - browser-based auth remains operator-driven for now
  - add a local standalone utility that captures a token on the operator's
    machine for paste-in or submission to the cluster control surface
  - the long-term UX should include a web dashboard where an operator can
    update auth state
  - when auth expires or re-auth is required, the system should pause affected
    work in a visible way instead of repeatedly failing or thrashing
- Storage strategy:
  - shared RWX storage is acceptable for the foreseeable future
  - object storage is explicitly deferred until scale or operational needs make
    it worthwhile
- Submission surfaces:
  - support both CLI submission and HTTP API submission
  - a future web dashboard should call the same HTTP API rather than creating a
    separate control path
- Orchestrator topology:
  - keep the orchestrator single-replica
  - active/passive and multi-active orchestration are out of scope unless the
    project goals change
- Cancellation and backpressure:
  - add sane cancellation and backpressure semantics before aggressive
    autoscaling
  - the system should be a good citizen in a shared multi-application cluster
    and avoid monopolizing compute or storage bandwidth

## Recommendation

Proceed with Kubernetes in two steps:

1. standard k8s deployment using Postgres + shared storage + one deployment per
   worker role
2. operator only after the runtime has been exercised enough to know which
   platform workflows deserve reconciliation logic

That path keeps the project aligned with its current architecture, reduces
delivery risk, and gives us room to build an operator for the right reasons
instead of using one as a substitute for runtime hardening.

## Directional Notes

These decisions imply a fairly clear platform shape:

- the orchestrator stays intentionally single-replica
- the HTTP API becomes the shared control surface for CLI and future dashboard
  use
- auth is an operator workflow with explicit pause/resume semantics
- shared storage remains part of the planned architecture rather than a
  temporary workaround
- autoscaling should stay conservative and be governed by queue depth plus
  cluster fairness limits rather than raw throughput alone
