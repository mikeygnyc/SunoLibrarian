import * as http from "http";
import type { IRuntimeHealthResponse } from "../core/contracts";

export interface RuntimeHealthServerHandle {
  readonly url: string;
  markReady(): void;
  close(): Promise<void>;
}

type RuntimeHealthServerOptions = Pick<IRuntimeHealthResponse, "service" | "role" | "workspaceId"> & {
  host?: string;
  port?: string | number;
};

export async function startRuntimeHealthServer(
  options: RuntimeHealthServerOptions,
): Promise<RuntimeHealthServerHandle | undefined> {
  const port = parseOptionalPort(options.port);
  if (port == null) {
    return undefined;
  }

  const host = typeof options.host === "string" && options.host.trim().length > 0
    ? options.host.trim()
    : "127.0.0.1";
  let status: IRuntimeHealthResponse["status"] = "starting";

  const server = http.createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/healthz") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const body: IRuntimeHealthResponse = {
      ok: status === "ready",
      status,
      service: options.service,
      role: options.role,
      pid: process.pid,
      workspaceId: options.workspaceId,
    };
    res.statusCode = status === "ready" ? 200 : 503;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  return {
    url: `http://${host}:${port}/healthz`,
    markReady() {
      status = "ready";
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

export function createHealthUrl(host: string, port: number): string {
  return `http://${host}:${port}/healthz`;
}

function parseOptionalPort(value: string | number | undefined): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid health port: ${value}`);
  }
  return parsed;
}
