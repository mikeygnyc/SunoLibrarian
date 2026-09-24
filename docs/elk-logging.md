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

## Repeatable Smoke Test

With the local bootstrap environment configured, run:

```bash
scripts/elk-smoke-test.sh
```

The command regenerates the ignored local manifests, applies the Filebeat and
application manifests, waits for Filebeat and the API to become ready, sends a
uniquely tagged API request, and confirms Elasticsearch indexed its decoded
structured event. It leaves resources running by default. Use `--teardown` only
when you explicitly want to remove the local Kubernetes installation afterward.

## Filebeat Provisioner Lifecycle

The Filebeat writer-account provisioner uses the fixed Job name
`suno-export-filebeat-provisioner`. Each normal bootstrap and smoke-test run
deletes any prior instance immediately before applying the ELK bundle, then
waits for the replacement Job to complete. This deliberately makes credential
rotation rerun provisioning without leaving a growing set of uniquely named
Jobs. Completed Jobs also retain their existing five-minute TTL as a fallback
cleanup mechanism.

## Elasticsearch Troubleshooting

Filebeat writes to rollover indices such as `suno-export-logs-000011`. The
provisioner now maintains `suno-export-logs` as the write alias, but the broader
`suno-export-*` pattern is still preferred for troubleshooting because it also
includes historical indices created before that alias was managed. With the
local bootstrap environment loaded, this lists matching concrete indices:

```bash
source scripts/pre-conf-bootstrap-k8s-local.env
curl --fail --silent --show-error \
  --user "$ELK_ELASTICSEARCH_ADMIN_USERNAME:$ELK_ELASTICSEARCH_ADMIN_PASSWORD" \
  "${ELK_ELASTICSEARCH_HOSTS%/}/_cat/indices/suno-export-*?v&s=index"
```

To inspect recent decoded application events, use the same pattern with
`_search`:

```bash
curl --fail --silent --show-error \
  --user "$ELK_ELASTICSEARCH_ADMIN_USERNAME:$ELK_ELASTICSEARCH_ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{"size":20,"sort":[{"@timestamp":{"order":"desc"}}],"query":{"match_all":{}}}' \
  "${ELK_ELASTICSEARCH_HOSTS%/}/suno-export-*/_search?pretty"
```

If the local environment uses a private CA, add
`--cacert /path/to/elasticsearch-ca.pem` to each command.
The Filebeat writer credentials intentionally cannot run these queries.

## Index Lifecycle, Mappings, and Access

The local provisioner installs an explicit Elasticsearch baseline instead of
granting Filebeat permission to run its automatic setup:

- the `suno-export-logs-30d` ILM policy rolls over after one day or a 25 GB
  primary shard, then deletes an index after 30 days
- the `suno-export-logs` index template applies that policy and the
  `suno-export-logs` write alias to `suno-export-logs-*`
- core timestamps use `date`, operational identifiers and tags use `keyword`,
  and `message` uses `match_only_text`; additional fields remain dynamic
- `suno_export_filebeat_writer` can create documents and inspect index metadata
  but cannot read logs or change lifecycle policy
- `suno_export_log_reader` can read `suno-export-*` and inspect index metadata;
  assign it to human or service accounts separately as needed

The provisioner creates `suno-export-logs-000001` only when the write alias does
not already exist, so reruns update policy, mappings, and roles without resetting
existing data. Before changing the 30-day baseline, confirm legal, incident
response, and storage requirements for the target environment.

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

## Sensitive Data

Shared logging boundaries redact bearer credentials, credential-bearing URLs,
token/password assignments, and fields with sensitive names before writing to
stdout, stderr, the API text log, Postgres log sinks, or Elasticsearch. Tests
cover nested structured properties as well as free-form messages.

The metadata database status description intentionally retains the PostgreSQL
username, host, port, and database name after removing the password. These
values are useful for distinguishing runtime targets and are considered
acceptable for the intended operator-only log audience. If logs are shared more
broadly, restrict access at the Elasticsearch reader role or remove those fields
at the collector boundary.

## Notes

- This path is intentionally separate from the Postgres log repository.
- Existing job/runtime status in Postgres still works, but container log
  aggregation is now intended to happen through ELK.
- If you already run a platform log collector, you may not need the Filebeat
  bundle at all. The important piece is the structured JSON stdout format.
