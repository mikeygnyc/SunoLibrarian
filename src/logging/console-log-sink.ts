import type { ILogEntry, ILogWriteResult } from "../lib/interfaces";
import type { ILogSink } from "./log-sink";

function formatLogEntry(entry: ILogEntry): string {
  const segments = [
    entry.timestamp.toISOString(),
    entry.level.toUpperCase(),
    entry.context?.role,
    entry.context?.jobId,
    entry.message,
  ].filter((segment): segment is string => Boolean(segment));

  return segments.join(" ");
}

export class ConsoleLogSink implements ILogSink {
  readonly name = "console";

  async write(entry: ILogEntry): Promise<ILogWriteResult> {
    const formatted = formatLogEntry(entry);
    switch (entry.level) {
      case "debug":
      case "info":
        console.log(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "error":
        console.error(formatted);
        break;
      default:
        console.log(formatted);
        break;
    }

    return {
      accepted: true,
      sinkName: this.name,
    };
  }
}

