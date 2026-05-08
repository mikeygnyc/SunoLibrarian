# Runtime Supervisor Checklist

This checklist turns the runtime supervisor plan into a concrete execution
sequence.

## Phase 11.1: Supervisor Boundary Freeze

- [x] Confirm `apps/supervisor` as the new app boundary
- [x] Confirm that `orchestrator` keeps scheduling ownership only
- [x] Confirm that supervisor owns runtime topology and process lifecycle
- [x] Confirm that API is always part of the supervised topology
- [x] Confirm that librarian processes are required supervised children
- [x] Confirm that workspaces discovered at runtime create librarians unless
  excluded by initial config
- [x] Confirm that operator-driven workspace disable/enable applies after
  initial librarian creation
- [x] Confirm that readiness will use lightweight HTTP health endpoints
- [x] Confirm that supervisor modes are `local` and `remote`

Phase 11 decisions are recorded in `docs/runtime-supervisor-plan.md`.

## Phase 11.2: Supervisor Contracts

- [x] Introduce `SupervisorRuntimeMode`
- [x] Introduce `SupervisorConfig`
- [x] Introduce `SupervisorWorkerSpec`
- [x] Introduce `SupervisorLibrarianSpec`
- [x] Introduce `SupervisorWorkspacePolicy`
- [x] Introduce `SupervisedRuntimeTopology`
- [x] Separate supervisor topology config from workflow submission config
- [x] Define child readiness/health endpoint contracts
- [x] Define child identity metadata for logs and status

## Phase 11.3: Supervisor Entrypoint

- [x] Create `apps/supervisor/src/main.ts`
- [x] Add a dedicated supervisor bootstrap flow
- [x] Keep existing split app entrypoints working during the transition
- [x] Add per-app script support for supervisor start/dev flows
- [x] Add temporary compatibility wiring if needed without widening old
  bootstraps

## Phase 11.4: Local Child Process Management

- [x] Implement local child process spawn/stop behavior
- [x] Implement child restart policy handling
- [x] Implement labeled child log forwarding
- [x] Implement startup sequencing based on readiness
- [x] Start `api` as a required child
- [x] Start `orchestrator` as a required child
- [x] Start a configurable worker set
- [x] Surface child exit codes and startup failures clearly

## Phase 11.5: Health and Readiness

- [x] Add lightweight HTTP health endpoints to `api`
- [x] Add lightweight HTTP health endpoints to `orchestrator`
- [x] Add lightweight HTTP health endpoints to `worker`
- [x] Add lightweight HTTP health endpoints to `librarian`
- [x] Have supervisor wait for readiness before declaring the stack healthy
- [x] Fail fast when a required child never becomes ready
- [x] Include child role/workspace metadata in readiness reporting

## Phase 11.6: Worker Topology Management

- [x] Add default local worker topology for `auth`, `asset`, `processing`, and
  `conversion`
- [x] Support configurable worker counts per role
- [x] Keep worker-role ownership one role per process
- [x] Ensure supervisor can run with reduced worker sets when intentionally
  configured

## Phase 11.7: Librarian Topology Management

- [x] Add workspace discovery flow owned by supervisor
- [x] Create librarian children for discovered workspaces unless initially
  excluded
- [x] Keep one workspace per librarian process
- [x] Add operator-driven disable/enable handling for existing workspace
  librarians
- [x] Ensure disabled workspaces generate no librarian polling traffic
- [x] Ensure newly discovered allowed workspaces create librarians
- [x] Ensure excluded workspaces do not create librarians during initial
  discovery

## Phase 11.8: Remote Supervisor Mode

- [x] Define remote supervisor control interface
- [x] Support remote lifecycle actions for `api`
- [x] Support remote lifecycle actions for `orchestrator`
- [x] Support remote lifecycle actions for `worker`
- [x] Support remote lifecycle actions for `librarian`
- [x] Preserve the same topology model across local and remote modes
- [x] Keep remote mode deployment-tool specific behavior behind a clear adapter
  boundary

## Phase 11.9: Postgres Role Reduction

- [x] Remove remaining startup assumptions that Postgres is the rendezvous layer
- [x] Keep Postgres focused on durable shared state
- [x] Move startup ordering responsibility into supervisor-owned sequencing
- [x] Reduce reliance on database state as proof of runtime liveness
- [x] Re-review schema/bootstrap behavior under supervised startup

## Phase 11.10: Tooling and Docs

- [x] Add per-app build/dev scripts for supervisor
- [x] Update VS Code launch configs to prefer supervisor-based local startup
- [x] Update README runtime examples for supervisor mode
- [x] Document local versus remote supervisor operation
- [x] Document librarian discovery, exclusion, and disable/enable behavior

## Validation Checklist

- [x] supervisor starts `api`, `orchestrator`, and required workers in local
  mode
- [x] supervisor waits for required children to become healthy
- [x] API remains available even while underlying child topology is supervised
- [x] orchestrator remains scheduling-only under supervisor control
- [x] each worker process still owns exactly one role
- [x] librarian children are created for discovered workspaces unless excluded
- [x] each librarian process is pinned to exactly one workspace
- [x] disabled workspaces generate no librarian polling traffic
- [x] excluded workspaces are skipped during initial librarian creation
- [x] remote supervisor mode preserves the same runtime topology model
- [x] Postgres is no longer required as startup coordination between local child
  processes
- [x] startup failures identify the specific child and failed readiness step

## Suggested First Implementation Slice

If doing this incrementally, start here:

- [x] add `apps/supervisor/src/main.ts`
- [x] add supervisor config types
- [x] make supervisor start `api`
- [x] make supervisor start `orchestrator`
- [x] make supervisor start one worker role
- [x] add lightweight HTTP health endpoints for those children
- [x] have supervisor wait for readiness before reporting success

That slice creates the supervisor foundation before layering in full worker
topology management, workspace discovery, librarian creation, and remote mode
adapters.
