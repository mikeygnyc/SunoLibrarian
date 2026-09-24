import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { CentralLogger, installStructuredConsoleBridge, sanitizeLogData, sanitizeLogMessage } from "../src/logging";
import type { ILogEntry, ILogWriteResult } from "../src/core/contracts";
import type { ILogSink } from "../src/logging/log-sink";
import { shouldLogHttpRequest } from "../src/http-api";
import { HttpApiServerLogger } from "../src/http-api-server-logger";

const yaml = require("js-yaml") as {
  load(input: string): unknown;
};

test("structured console bridge emits JSON and redacts sensitive values", () => {
  const lines: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  const bridge = installStructuredConsoleBridge({
    service: "worker",
    role: "asset",
    workspaceId: "workspace-1",
    tags: ["runtime"],
  });

  try {
    console.log("connected", {
      token: "secret-token",
      endpoint: "postgresql://operator:secret-password@db.internal:5432/suno",
    });
  } finally {
    bridge.close();
    process.stdout.write = originalWrite;
  }

  assert.equal(lines.length, 1);
  const payload = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(payload.level, "info");
  assert.equal(payload.service, "worker");
  assert.equal(payload.role, "asset");
  assert.equal(payload.workspaceId, "workspace-1");
  assert.match(String(payload.message), /connected/);
  assert.match(String(payload.message), /\[REDACTED\]/);
  assert.doesNotMatch(lines[0], /secret-token|secret-password/);
});

test("central logger sanitizes messages and nested properties before every sink", async () => {
  const sink = new CapturingSink();
  const logger = new CentralLogger({ sinks: [sink] });

  await logger.info("request used Bearer top-secret", {
    role: "asset",
    properties: {
      password: "db-password",
      nested: { authorization: "Bearer nested-secret" },
      safeHost: "db.internal",
    },
  });

  assert.equal(sink.entries.length, 1);
  const serialized = JSON.stringify(sink.entries[0]);
  assert.doesNotMatch(serialized, /top-secret|db-password|nested-secret/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.match(serialized, /db\.internal/);
});

test("HTTP API logger redacts stdout JSON and its text log file", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "suno-export-api-log-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const logPath = path.join(tempDir, "api.log");
  const stdout: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    new HttpApiServerLogger({ logFilePath: logPath }).info(
      "connecting to postgresql://api:message-secret@db.internal/suno",
      { authorization: "Bearer field-secret", host: "db.internal" },
    );
  } finally {
    process.stdout.write = originalWrite;
  }

  const combined = `${stdout.join("")}\n${fs.readFileSync(logPath, "utf8")}`;
  assert.doesNotMatch(combined, /message-secret|field-secret/);
  assert.match(combined, /\[REDACTED\]/);
  assert.match(combined, /db\.internal/);
});

test("log sanitizer redacts credential-bearing strings without hiding ordinary hosts", () => {
  const message = sanitizeLogMessage(
    "database=postgres://reader:password@db.internal:5432/library password=another-secret",
  );
  assert.equal(
    message,
    "database=postgres://[REDACTED]@db.internal:5432/library password=[REDACTED]",
  );
  assert.deepEqual(sanitizeLogData({ hasToken: true, token: "secret", host: "db.internal" }), {
    hasToken: true,
    token: "[REDACTED]",
    host: "db.internal",
  });
});

test("Filebeat config decodes JSON then extracts bracketed subsystem prefixes", () => {
  const manifestPath = path.join(process.cwd(), "k8s", "observability", "elk", "configmap.yaml");
  const manifest = yaml.load(fs.readFileSync(manifestPath, "utf8")) as {
    data: { "filebeat.yml": string };
  };
  const config = yaml.load(manifest.data["filebeat.yml"]) as {
    "filebeat.inputs": Array<{ processors: Array<Record<string, unknown>> }>;
  };
  const processors = config["filebeat.inputs"][0].processors;

  const decodeIndex = processors.findIndex((processor) => "decode_json_fields" in processor);
  const dissectIndex = processors.findIndex((processor) => "dissect" in processor);
  const dropIndex = processors.findIndex((processor) => "drop_fields" in processor);
  const renameIndex = processors.findIndex((processor) => "rename" in processor);
  const dissect = processors[dissectIndex].dissect as Record<string, unknown>;

  assert.ok(decodeIndex >= 0);
  assert.ok(dissectIndex > decodeIndex);
  assert.ok(dropIndex > dissectIndex);
  assert.ok(renameIndex > dropIndex);
  assert.equal(dissect.tokenizer, "[%{subsystem}] %{subsystem_message}");
  assert.equal(dissect.field, "message");
  assert.equal(dissect.target_prefix, "");
});

test("HTTP request logging suppresses health probes only", () => {
  assert.equal(shouldLogHttpRequest("/healthz"), false);
  assert.equal(shouldLogHttpRequest("/api/v1/jobs"), true);
  assert.equal(shouldLogHttpRequest("/dashboard"), true);
});

class CapturingSink implements ILogSink {
  readonly name = "capture";
  readonly entries: ILogEntry[] = [];

  async write(entry: ILogEntry): Promise<ILogWriteResult> {
    this.entries.push(entry);
    return { accepted: true, sinkName: this.name };
  }
}
