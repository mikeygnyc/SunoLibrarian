import * as util from "util";
import { sanitizeLogData } from "./sanitize-log-data";

type ConsoleMethodName = "log" | "info" | "warn" | "error" | "debug";

export interface StructuredConsoleBridgeOptions {
  service: string;
  role?: string;
  workspaceId?: string;
  tags?: string[];
}

export interface StructuredConsoleBridgeHandle {
  close(): void;
}

export function installStructuredConsoleBridge(
  options: StructuredConsoleBridgeOptions,
): StructuredConsoleBridgeHandle {
  const originalConsole: Record<ConsoleMethodName, (...args: unknown[]) => void> = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  let closed = false;

  const emit = (level: "info" | "warn" | "error" | "debug", args: unknown[]) => {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      service: options.service,
      role: options.role,
      workspaceId: options.workspaceId,
      pid: process.pid,
      tags: options.tags,
      message: formatConsoleArgs(sanitizeLogData(args)),
    };
    const line = JSON.stringify(payload);
    if (level === "warn" || level === "error") {
      process.stderr.write(`${line}\n`);
      return;
    }
    process.stdout.write(`${line}\n`);
  };

  console.log = (...args: unknown[]) => {
    if (closed) {
      originalConsole.log(...args);
      return;
    }
    emit("info", args);
  };
  console.info = (...args: unknown[]) => {
    if (closed) {
      originalConsole.info(...args);
      return;
    }
    emit("info", args);
  };
  console.warn = (...args: unknown[]) => {
    if (closed) {
      originalConsole.warn(...args);
      return;
    }
    emit("warn", args);
  };
  console.error = (...args: unknown[]) => {
    if (closed) {
      originalConsole.error(...args);
      return;
    }
    emit("error", args);
  };
  console.debug = (...args: unknown[]) => {
    if (closed) {
      originalConsole.debug(...args);
      return;
    }
    emit("debug", args);
  };

  return {
    close() {
      if (closed) return;
      closed = true;
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;
    },
  };
}

function formatConsoleArgs(args: unknown[]): string {
  return args.map((arg) => {
    if (typeof arg === "string") {
      return arg;
    }
    return util.inspect(arg, {
      depth: 5,
      breakLength: Infinity,
      compact: true,
      sorted: true,
    });
  }).join(" ");
}
