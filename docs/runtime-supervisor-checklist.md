# Runtime Supervisor Checklist

This checklist turns the runtime supervisor plan into a concrete execution
sequence.

## Phase 11.1: Supervisor Boundary Freeze

- [ ] Confirm `apps/supervisor` as the new app boundary
- [ ] Confirm that `orchestrator` keeps scheduling ownership only
- [ ] Confirm that supervisor owns runtime topology and process lifecycle
- [ ] Confirm that API is always part of the supervised topology
- [ ] Confirm that librarian processes are required supervised children
- [ ] Confirm that workspaces discovered at runtime create librarians unless
  excluded by initial config
- [ ] Confirm that operator-driven workspace disable/enable applies after
  initial librarian creation
- [ ] Confirm that readiness will use lightweight HTTP health endpoints
- [ ] Confirm that supervisor modes are `local` and `remote`

Phase 11 decisions are recorded in `docs/runtime-supervisor-plan.md`.

## Phase 11.2: Supervisor Contracts

- [ ] Introduce `SupervisorRuntimeMode`
- [ ] Introduce `SupervisorConfig`
- [ ] Introduce `SupervisorWorkerSpec`
- [ ] Introduce `SupervisorLibrarianSpec`
- [ ] Introduce `SupervisorWorkspacePolicy`
- [ ] Introduce `SupervisedRuntimeTopology`
- [ ] Separate supervisor topology config from workflow submission config
- [ ] Define child readiness/health endpoint contracts
- [ ] Define child identity metadata for logs and status

## Phase 11.3: Supervisor Entrypoint

- [ ] Create `apps/supervisor/src/main.ts`
- [ ] Add a dedicated supervisor bootstrap flow
- [ ] Keep existing split app entrypoints working during the transition
- [ ] Add per-app script support for supervisor start/dev flows
- [ ] Add temporary compatibility wiring if needed without widening old
  bootstraps

## Phase 11.4: Local Child Process Management

- [ ] Implement local child process spawn/stop behavior
- [ ] Implement child restart policy handling
- [ ] Implement labeled child log forwarding
- [ ] Implement startup sequencing based on readiness
- [ ] Start `api` as a required child
- [ ] Start `orchestrator` as a required child
- [ ] Start a configurable worker set
- [ ] Surface child exit codes and startup failures clearly

## Phase 11.5: Health and Readiness

- [ ] Add lightweight HTTP health endpoints to `api`
- [ ] Add lightweight HTTP health endpoints to `orchestrator`
- [ ] Add lightweight HTTP health endpoints to `worker`
- [ ] Add lightweight HTTP health endpoints to `librarian`
- [ ] Have supervisor wait for readiness before declaring the stack healthy
- [ ] Fail fast when a required child never becomes ready
- [ ] Include child role/workspace metadata in readiness reporting

## Phase 11.6: Worker Topology Management

- [ ] Add default local worker topology for `auth`, `asset`, `processing`, and
  `conversion`
- [ ] Support configurable worker counts per role
- [ ] Keep worker-role ownership one role per process
- [ ] Ensure supervisor can run with reduced worker sets when intentionally
  configured

## Phase 11.7: Librarian Topology Management

- [ ] Add workspace discovery flow owned by supervisor
- [ ] Create librarian children for discovered workspaces unless initially
  excluded
- [ ] Keep one workspace per librarian process
- [ ] Add operator-driven disable/enable handling for existing workspace
  librarians
- [ ] Ensure disabled workspaces generate no librarian polling traffic
- [ ] Ensure newly discovered allowed workspaces create librarians
- [ ] Ensure excluded workspaces do not create librarians during initial
  discovery

## Phase 11.8: Remote Supervisor Mode

- [ ] Define remote supervisor control interface
- [ ] Support remote lifecycle actions for `api`
- [ ] Support remote lifecycle actions for `orchestrator`
- [ ] Support remote lifecycle actions for `worker`
- [ ] Support remote lifecycle actions for `librarian`
- [ ] Preserve the same topology model across local and remote modes
- [ ] Keep remote mode deployment-tool specific behavior behind a clear adapter
  boundary

## Phase 11.9: Postgres Role Reduction

- [ ] Remove remaining startup assumptions that Postgres is the rendezvous layer
- [ ] Keep Postgres focused on durable shared state
- [ ] Move startup ordering responsibility into supervisor-owned sequencing
- [ ] Reduce reliance on database state as proof of runtime liveness
- [ ] Re-review schema/bootstrap behavior under supervised startup

## Phase 11.10: Tooling and Docs

- [ ] Add per-app build/dev scripts for supervisor
- [ ] Update VS Code launch configs to prefer supervisor-based local startup
- [ ] Update README runtime examples for supervisor mode
- [ ] Document local versus remote supervisor operation
- [ ] Document librarian discovery, exclusion, and disable/enable behavior

## Validation Checklist

- [ ] supervisor starts `api`, `orchestrator`, and required workers in local
  mode
- [ ] supervisor waits for required children to become healthy
- [ ] API remains available even while underlying child topology is supervised
- [ ] orchestrator remains scheduling-only under supervisor control
- [ ] each worker process still owns exactly one role
- [ ] librarian children are created for discovered workspaces unless excluded
- [ ] each librarian process is pinned to exactly one workspace
- [ ] disabled workspaces generate no librarian polling traffic
- [ ] excluded workspaces are skipped during initial librarian creation
- [ ] remote supervisor mode preserves the same runtime topology model
- [ ] Postgres is no longer required as startup coordination between local child
  processes
- [ ] startup failures identify the specific child and failed readiness step

## Suggested First Implementation Slice

If doing this incrementally, start here:

- [ ] add `apps/supervisor/src/main.ts`
- [ ] add supervisor config types
- [ ] make supervisor start `api`
- [ ] make supervisor start `orchestrator`
- [ ] make supervisor start one worker role
- [ ] add lightweight HTTP health endpoints for those children
- [ ] have supervisor wait for readiness before reporting success

That slice creates the supervisor foundation before layering in full worker
topology management, workspace discovery, librarian creation, and remote mode
adapters.
