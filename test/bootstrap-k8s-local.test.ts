import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = join(__dirname, "..");
const requiredEnvironment = {
  RUNTIME_POSTGRES_URL: "postgres://test:password@postgres.test:5432/suno_export",
  RUNTIME_MQTT_URL: "mqtt://mqtt.test:1883",
  ELK_ELASTICSEARCH_HOSTS: "https://elasticsearch.test:9200",
  ELK_ELASTICSEARCH_USERNAME: "filebeat_test",
  ELK_ELASTICSEARCH_PASSWORD: "filebeat-password",
  ELK_ELASTICSEARCH_ADMIN_USERNAME: "elastic",
  ELK_ELASTICSEARCH_ADMIN_PASSWORD: "admin-password",
};

function createFixture(): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "suno-export-bootstrap-"));
  cpSync(join(repoRoot, "k8s", "base"), join(fixtureRoot, "k8s", "base"), { recursive: true });
  cpSync(
    join(repoRoot, "k8s", "observability"),
    join(fixtureRoot, "k8s", "observability"),
    { recursive: true },
  );
  cpSync(
    join(repoRoot, "scripts", "bootstrap-k8s-local.sh"),
    join(fixtureRoot, "scripts", "bootstrap-k8s-local.sh"),
  );
  return fixtureRoot;
}

function runBootstrap(
  fixtureRoot: string,
  args: string[],
  environment: NodeJS.ProcessEnv = requiredEnvironment,
) {
  return spawnSync("bash", ["scripts/bootstrap-k8s-local.sh", ...args], {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function countResource(kustomization: string, resource: string): number {
  return (kustomization.match(new RegExp(`^  - ${resource}$`, "gm")) || []).length;
}

test("bootstrap validates inputs, supports --skip-elk, and generates idempotent renderable manifests", (t) => {
  const fixtureRoot = createFixture();
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const missingEnvironment = { ...process.env } as NodeJS.ProcessEnv;
  for (const name of Object.keys(requiredEnvironment)) {
    delete missingEnvironment[name];
  }
  const missing = runBootstrap(fixtureRoot, ["--no-run"], missingEnvironment);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing required environment variables: RUNTIME_POSTGRES_URL RUNTIME_MQTT_URL/);
  assert.match(missing.stderr, /ELK_ELASTICSEARCH_ADMIN_PASSWORD/);
  assert.doesNotMatch(missing.stdout, /Local manifests are ready/);

  const skipped = runBootstrap(fixtureRoot, ["--no-run", "--skip-elk"], {
    RUNTIME_POSTGRES_URL: requiredEnvironment.RUNTIME_POSTGRES_URL,
    RUNTIME_MQTT_URL: requiredEnvironment.RUNTIME_MQTT_URL,
  });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /kubectl apply -k k8s\/local/);
  assert.doesNotMatch(skipped.stdout, /observability\/elk/);
  assert.throws(() => readFileSync(join(fixtureRoot, "k8s/local/observability/elk/kustomization.yaml")));

  const firstGeneration = runBootstrap(fixtureRoot, ["--force", "--no-run"]);
  assert.equal(firstGeneration.status, 0, firstGeneration.stderr);
  const secondGeneration = runBootstrap(fixtureRoot, ["--no-run"]);
  assert.equal(secondGeneration.status, 0, secondGeneration.stderr);

  const elkKustomizationPath = join(fixtureRoot, "k8s/local/observability/elk/kustomization.yaml");
  const elkKustomization = readFileSync(elkKustomizationPath, "utf8");
  assert.equal(countResource(elkKustomization, "bootstrap-secret.yaml"), 1);
  assert.equal(countResource(elkKustomization, "provisioner-job.yaml"), 1);
  const provisioner = readFileSync(
    join(fixtureRoot, "k8s/local/observability/elk/provisioner-job.yaml"),
    "utf8",
  );
  assert.match(provisioner, /_ilm\/policy\/suno-export-logs-30d/);
  assert.match(provisioner, /_index_template\/suno-export-logs/);
  assert.match(provisioner, /"min_age": "30d"/);
  assert.match(provisioner, /suno_export_filebeat_writer/);
  assert.match(provisioner, /suno_export_log_reader/);

  for (const overlay of ["k8s/local", "k8s/local/cluster", "k8s/local/observability/elk"]) {
    const rendered = execFileSync("kubectl", ["kustomize", overlay], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });
    assert.match(rendered, /apiVersion:/);
  }
});
