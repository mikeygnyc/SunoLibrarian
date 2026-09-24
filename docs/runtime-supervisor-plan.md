# Runtime Supervisor Plan

This document proposes the next architectural step after the app split:
introducing a supervisor-managed runtime model that owns component startup on a
single host while reducing Postgres to a persistence layer rather than a
startup/backplane coordinator.

The immediate motivation is operational clarity. The split app model improved
boundaries, but it still relies on independently launched processes rendezvousing
through shared Postgres state. That is workable, but it is a weak fit for local
development and single-host deployments:

- process startup order is implicit rather than owned
- multiple processes may race during initialization
- Postgres ends up acting like both storage and coordination backplane
- it is hard to tell which runtime topology is intended for a given deployment

## Goals

- make one process explicitly responsible for local runtime topology
- keep app responsibilities narrow even when one binary supervises many child
  processes
- reduce startup-time coupling through Postgres
- support both single-host managed startup and externally managed multi-process
  deployment
- preserve the existing app split rather than collapsing back to one monolith

## Non-Goals

- removing Postgres support for orchestration durability
- removing the split app entrypoints
- introducing Kubernetes-specific abstractions yet
- replacing the current orchestration model in one pass

## Core Recommendation

Add a supervisor-managed runtime architecture.

The system should support two explicit supervisor operating modes:

### Local Supervisor-Managed Runtime

A local supervisor process starts and owns the local runtime graph. In this
mode, the supervisor is responsible for:

- starting required child processes
- ordering startup so dependencies become ready before dependent processes begin
  active work
- stopping or restarting child processes
- presenting a coherent local/dev entrypoint for the system

### Remote Supervisor-Managed Runtime

The same supervisor app manages the runtime graph remotely instead of spawning
local child processes directly. In this mode, the supervisor controls the other
apps through deployment-specific mechanisms such as shell scripts, launchd,
Docker, a Kubernetes operator, or similar orchestration tools.

This preserves the value of the app split:

- `api` stays API-only
- `orchestrator` stays orchestration-only
- `worker` stays role-specific
- `librarian` stays workspace-scoped

The difference is not managed versus unmanaged. The difference is whether the
supervisor is directly managing local child processes or managing the app graph
through remote/deployment-specific control mechanisms.

## Supervisor Responsibilities

The supervisor should own process lifecycle, not business logic.

That means:

- it decides which components should exist
- it launches and monitors them
- it waits for readiness signals
- it restarts or exits when required
- it collects enough logs/status to explain what is running

It should not absorb:

- HTTP route handling
- workflow scheduling logic
- worker execution logic
- librarian sync logic

Those remain inside the existing apps.

## Relationship to the Orchestrator

The orchestrator and the supervisor are related but distinct concerns.

### Orchestrator

- owns workflow scheduling
- owns job progression rules
- owns control-plane decisions about runnable work

### Supervisor

- owns process startup/shutdown
- owns local runtime topology
- owns readiness/wait-for-child behavior

They should remain separate concepts in code. If we overload the orchestrator
with process lifecycle duties, the boundary gets blurry again.

Recommended direction:

- keep the current `orchestrator` app responsibility intact
- add a new `supervisor` app
- have the supervisor wrap the existing app entrypoints while keeping the
  internal roles distinct

## Postgres Role After This Change

Postgres should remain durable shared state, not startup coordination.

Good uses:

- job persistence
- stage/work item persistence
- logs and status history
- metadata persistence

Uses we should reduce or eliminate:

- implicit component discovery
- startup ordering
- concurrent schema/bootstrap coordination where a single local supervisor could
  own that ordering
- treating DB presence as proof that all required runtimes are already alive

This does not mean Postgres disappears from the control plane. It means it stops
being responsible for process lifecycle.

## Target Runtime Shapes

### Local Dev / Single Host

Preferred entrypoint:

- `supervisor`

Required child topology:

- `api`
- `orchestrator`
- one or more `worker` roles
- `librarian` instances created from discovered workspaces unless excluded by
  initial supervisor config

### Distributed / Containerized

Preferred entrypoint:

- separate app processes

Likely topology:

- `api` deployment
- `orchestrator` deployment
- `worker` deployments by role
- `librarian` deployments by workspace, created for discovered workspaces
  unless excluded by initial config

The same app binaries support both modes.

## Configuration Direction

Introduce a runtime-topology config separate from workflow config.

Example concerns:

- whether the supervisor is operating in local or remote mode
- API startup configuration, while still treating API presence as required
- which worker roles should be started
- how many worker processes per role
- which workspaces are initially excluded from librarian creation
- which discovered workspace librarians are currently disabled after initial
  creation
- restart policy and readiness timeouts

This config should not be hidden inside workflow payloads or spread across
unrelated app flags.

Suggested types:

- `SupervisorRuntimeMode = "local" | "remote"`
- `SupervisorConfig`
- `SupervisorWorkerSpec`
- `SupervisorLibrarianSpec`
- `SupervisorWorkspacePolicy`
- `SupervisedRuntimeTopology`

Librarian policy needs to be explicit:

- librarian processes are not optional
- when workspaces are discovered, librarians should be created for them unless
  those workspaces are excluded in initial config
- after the initial workspace discovery pass, an operator may disable
  individual workspace librarians
- disabling a workspace means its librarian stops syncing until re-enabled

## Readiness Model

Supervisor-managed startup needs explicit readiness signals.

Recommended mechanism:

- lightweight HTTP health endpoints on supervised apps

At minimum:

- `api` reports listen/bind success
- `orchestrator` reports control-plane initialization complete
- `worker` reports role registration and polling readiness
- `librarian` reports workspace validation and sync-loop readiness

The supervisor should wait for readiness before declaring the stack healthy.

This is more reliable than assuming a spawned process is ready because it has a
PID.

## Logging and Diagnostics

The supervisor should make startup easier to understand.

It should provide:

- child process name/role/workspace labeling
- startup sequencing messages
- readiness/failure summaries
- exit-code reporting
- enough context to identify which child emitted a failure

This gives us a much better answer than a vague downstream message like
`deadlock detected`, because the operator can see which component was
initializing and what it was waiting on.

## Phased Implementation Plan

### Phase 11.1: Design and Contracts

- write down local and remote supervisor runtime expectations
- define supervisor-owned topology config
- define lightweight HTTP child readiness contract
- define workspace discovery and librarian creation policy

### Phase 11.2: Supervisor Bootstrap

- add a new supervisor entrypoint
- implement child process spawn/stop behavior
- add labeled log forwarding
- support launching API, orchestrator, and a configurable worker set
- treat API startup as mandatory

### Phase 11.3: Managed Local Topology

- add a default local topology preset
- support `api + orchestrator + auth/asset/processing/conversion workers`
- support librarian child specs derived from discovered workspaces plus initial
  exclusions
- update VS Code launch configs to prefer supervisor-based local startup

### Phase 11.4: Readiness and Health

- add structured readiness events from each app
- have supervisor wait for readiness
- fail fast on startup errors with clear summaries
- expose a simple supervisor status view if needed

### Phase 11.5: Postgres Role Reduction

- remove remaining startup assumptions that Postgres is the rendezvous layer
- keep schema creation and persistence durable, but stop using DB state as the
  only source of runtime liveness
- review whether any startup coordination logic can move fully into supervisor
  ordering

### Phase 11.6: Documentation and Tooling

- update README runtime examples
- add per-mode launch examples
- document when to use local vs remote supervisor runtime

## First Implementation Slice

The safest first slice is:

1. add a `supervisor` entrypoint
2. make it start `api`
3. make it start `orchestrator`
4. make it start one worker role
5. add lightweight HTTP readiness messages
6. keep librarian discovery/creation in the next slice

That gives us the process-lifecycle foundation without immediately rewriting the
whole local stack.

The next slice after that would be:

1. support multiple worker roles
2. support workspace discovery
3. create librarian children for discovered workspaces unless initially
   excluded
4. support operator-driven disable/enable behavior for existing workspace
   librarians
5. switch local debug guidance toward the supervisor entrypoint

## Decisions Captured

- supervisor should be a new app at `apps/supervisor`
- child readiness should use lightweight HTTP health endpoints
- the API should always exist in the supervised topology
- librarian processes are supervised children with explicit workspace ownership;
  they are not outside the supervisor model

## Recommendation Summary

The split app architecture is still the right foundation. The next improvement
is not to undo that split, but to add an explicit supervisor layer on top of it.

That gives us:

- clearer startup ownership
- less accidental reliance on Postgres as a backplane
- better local/dev ergonomics
- a path to support both local and remote supervisor control models cleanly
