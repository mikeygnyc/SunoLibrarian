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
[k8s/observability/elk](./k8s/observability/elk/kustomization.yaml:1).

It does the following:

- tails `suno-export` container logs from `/var/log/containers`
- parses the Kubernetes container envelope
- decodes the JSON payload written by the app
- enriches records with Kubernetes metadata
- forwards them to Logstash

## Apply

Create a real secret from the example:

```bash
kubectl apply -f k8s/observability/elk/secret.example.yaml
```

Then deploy Filebeat:

```bash
kubectl apply -k k8s/observability/elk
```

## Configuration

The example secret currently provides:

- `logstash-hosts`
- `environment`

By default the bundle expects Logstash on port `5044`.

## Notes

- This path is intentionally separate from the Postgres log repository.
- Existing job/runtime status in Postgres still works, but container log
  aggregation is now intended to happen through ELK.
- If you already run a platform log collector, you may not need the Filebeat
  bundle at all. The important piece is the structured JSON stdout format.
