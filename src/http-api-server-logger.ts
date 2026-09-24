import * as fs from "fs";
import * as path from "path";
import { sanitizeLogData, sanitizeLogMessage } from "./logging/sanitize-log-data";

type ServerLogLevel = "debug" | "info" | "warn" | "error";

export type HttpApiServerLoggerOptions = {
  logFilePath: string;
  minimumLevel?: ServerLogLevel;
};

const LOG_LEVELS: Record<ServerLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class HttpApiServerLogger {
  readonly logFilePath: string;
  private readonly minimumLevel: ServerLogLevel;

  constructor(options: HttpApiServerLoggerOptions) {
    this.logFilePath = path.resolve(options.logFilePath);
    this.minimumLevel = options.minimumLevel ?? "info";
    fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.write("error", message, fields);
  }

  private write(level: ServerLogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.minimumLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const sanitizedMessage = sanitizeLogMessage(message);
    const sanitizedFields = sanitizeLogData(fields);
    const structuredPayload = JSON.stringify({
      timestamp,
      level,
      service: "api",
      subsystem: "http-api",
      message: sanitizedMessage,
      properties: sanitizedFields,
    });
    const suffix = sanitizedFields && Object.keys(sanitizedFields).length > 0
      ? ` ${JSON.stringify(sanitizedFields)}`
      : "";
    const line = `[${timestamp}] ${level.toUpperCase()} ${sanitizedMessage}${suffix}`;

    switch (level) {
      case "debug":
      case "info":
        process.stdout.write(`${structuredPayload}\n`);
        break;
      case "warn":
        process.stderr.write(`${structuredPayload}\n`);
        break;
      case "error":
        process.stderr.write(`${structuredPayload}\n`);
        break;
    }

    fs.appendFileSync(this.logFilePath, `${line}\n`, "utf8");
  }
}
