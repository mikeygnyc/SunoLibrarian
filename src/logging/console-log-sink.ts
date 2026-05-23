import type { ILogEntry, ILogWriteResult } from "../core/contracts";
import type { ILogSink } from "./log-sink";

export class ConsoleLogSink implements ILogSink {
  readonly name = "console";

  async write(entry: ILogEntry): Promise<ILogWriteResult> {
    const formatted = JSON.stringify({
      timestamp: entry.timestamp.toISOString(),
      level: entry.level,
      service: entry.context?.service,
      role: entry.context?.role,
      jobId: entry.context?.jobId,
      stageId: entry.context?.stageId,
      workItemId: entry.context?.workItemId,
      workerInstanceId: entry.context?.workerInstanceId,
      workflowType: entry.context?.workflowType,
      clipId: entry.context?.clipId,
      tags: entry.context?.tags,
      properties: entry.context?.properties,
      message: entry.message,
      errorCode: entry.errorCode,
      errorStack: entry.errorStack,
    });
    switch (entry.level) {
      case "debug":
      case "info":
        process.stdout.write(`${formatted}\n`);
        break;
      case "warn":
        process.stderr.write(`${formatted}\n`);
        break;
      case "error":
        process.stderr.write(`${formatted}\n`);
        break;
      default:
        process.stdout.write(`${formatted}\n`);
        break;
    }

    return {
      accepted: true,
      sinkName: this.name,
    };
  }
}
