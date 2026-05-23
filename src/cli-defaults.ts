import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const DEFAULT_DOWNLOAD_ROOT = path.join(os.homedir(), "Downloads", "suno-export");

const DEFAULT_CONTAINER_STATE_ROOT = "/var/lib/suno-export";

function isContainerRuntime(): boolean {
  return process.env.SUNO_EXPORT_CONTAINER === "1" || fs.existsSync("/.dockerenv");
}

function resolveDefaultDataRoot(): string {
  if (isContainerRuntime()) {
    return path.join(DEFAULT_CONTAINER_STATE_ROOT, "data");
  }
  return path.resolve("data");
}

function resolveDefaultLogRoot(): string {
  if (isContainerRuntime()) {
    return path.join(DEFAULT_CONTAINER_STATE_ROOT, "logs");
  }
  return path.resolve("data");
}

export const DEFAULT_DATABASE_PATH = path.join(resolveDefaultDataRoot(), "suno-export.sqlite");
export const DEFAULT_HTTP_API_LOG_PATH = path.join(resolveDefaultLogRoot(), "http-api.log");
