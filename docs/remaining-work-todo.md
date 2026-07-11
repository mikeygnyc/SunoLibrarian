# Remaining Work TODO

This is the working list after the local Kubernetes bootstrap and ELK logging
smoke test. It is ordered by operational risk and release value.

## P0 — Complete before sharing or deploying the current branch

- [x] Rotate the database, MQTT, and Elasticsearch credentials that were
  previously embedded in the local bootstrap wrapper. Update the local ignored
  environment file only after rotation.
- [x] Review the generated `k8s/local` manifests after rotating secrets, then
  apply them to the intended cluster. Do not commit any generated manifests or
  local environment files.
- [x] Review and commit the focused Kubernetes/ELK change set separately from
  unrelated VS Code configuration changes.

## P1 — Close the runtime and operational gaps

- [ ] Resolve the `run-supervisor` documentation mismatch: the README describes
  it, but the built CLI help does not currently expose that command. Either
  register and test the command, or remove/update the documentation.
- [ ] Add a repeatable ELK smoke-test command that is safe by default. It should
  generate manifests, wait for Filebeat readiness, emit a tagged API request,
  and verify that Elasticsearch indexes the decoded structured event. Keep any
  destructive teardown behind an explicit flag.
- [ ] Document an Elasticsearch troubleshooting query using
  `suno-export-*`, rather than assuming the bare `suno-export-logs` name is a
  readable alias. The smoke test confirmed indexed rollover indices such as
  `suno-export-logs-000011`.
- [ ] Decide the lifecycle of the Filebeat provisioner Job: rerunning bootstrap
  creates a new Job only if its prior object is absent. Confirm whether the Job
  should be retained, replaced, or use a unique generated name on credential
  rotation.

## P2 — Quality and security hardening

- [ ] Add automated coverage for bootstrap validation: missing required values,
  `--skip-elk`, idempotent kustomization generation, and `kubectl kustomize`
  rendering.
- [ ] Add integration coverage for JSON logging and Filebeat field extraction,
  especially bracketed subsystem prefixes and health-check log suppression.
- [ ] Review application logs for connection-string and token redaction. The
  smoke test showed the PostgreSQL username and host in logs; confirm this is an
  intentional, acceptable disclosure for the target log audience.
- [ ] Triage and remediate the dependency audit findings reported by
  `npm install` (18 findings at the last build, including 11 high severity),
  with a lockfile-aware upgrade plan and regression check.
- [ ] Confirm Elasticsearch index lifecycle, retention, mappings, and access
  policy for `suno-export-*`; the current Filebeat configuration disables its
  automatic ILM and template setup.

## Verified in the current local environment

- [x] Bootstrap configuration no longer embeds credentials in the tracked
  wrapper and supports a gitignored local env file.
- [x] Bootstrap requires runtime and ELK values before writing local secrets.
- [x] Repeated generation does not duplicate generated kustomization resources.
- [x] Generated base, cluster, and ELK kustomizations render successfully.
- [x] Docker Desktop smoke test confirmed Filebeat delivery and decoded API and
  operator events in Elasticsearch.
