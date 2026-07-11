# ELK Logging

This project now supports ELK-style log aggregation through structured JSON
logs written to container stdout/stderr plus an optional Filebeat DaemonSet.

## Runtime Behavior

The long-running k8s-facing processes now emit JSON log lines:

- `api`
- `worker`
- `librarian`
- `k8s-operator`

Each line includes fields such as:

- `timestamp`
- `level`
- `service`
- `role`
- `workspaceId`
- `pid`
- `tags`
- `message`

That means a log collector can ingest directly from Kubernetes container logs
without parsing ad hoc text output.

## Filebeat Bundle

An optional Filebeat-to-Logstash bundle lives under
[k8s/observability/elk](/Users/mikegales/Projects/SunoTrackExporter/k8s/observability/elk/kustomization.yaml:1).

It does the following:

- tails `suno-export` container logs from `/var/log/containers`
- parses the Kubernetes container envelope
- decodes the JSON payload written by the app
- forwards records directly to Elasticsearch

## Apply

Create a real secret from the example:

```bash
kubectl apply -f k8s/observability/elk/secret.example.yaml
```

Then deploy Filebeat:

```bash
kubectl apply -k k8s/observability/elk
```

If you change Filebeat processors, restart the DaemonSet so the running pods pick
up the updated config:

```bash
kubectl -n suno-export rollout restart daemonset/suno-export-filebeat
```

## Configuration

The example secret currently provides:

- `elasticsearch-hosts`
- `elasticsearch-username`
- `elasticsearch-password`
- `environment`

After JSON decoding, fields like `timestamp`, `level`, `service`, `role`,
`workspaceId`, `pid`, `tags`, and the inner application `message` are indexed
as first-class Elasticsearch fields instead of remaining embedded in the raw
container `message` string.

When an application message starts with a bracketed prefix like
`[metadata-db] Postgres connection ready in 44ms`, Filebeat also extracts
`subsystem: metadata-db` and rewrites `message` to `Postgres connection ready in
44ms` via a temporary parsed field and rename step.

If Elasticsearch rejects events, Filebeat writes rejection details under
`/usr/share/filebeat/logs` inside the pod so the cause is inspectable.
The Filebeat input also drops Filebeat's own decoded logs so `service.name`
from collector events does not conflict with the application's flat `service`
field mapping.

## Notes

- This path is intentionally separate from the Postgres log repository.
- Existing job/runtime status in Postgres still works, but container log
  aggregation is now intended to happen through ELK.
- If you already run a platform log collector, you may not need the Filebeat
  bundle at all. The important piece is the structured JSON stdout format.
