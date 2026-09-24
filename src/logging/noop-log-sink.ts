import type { ILogEntry, ILogWriteResult } from "../core/contracts";
import type { ILogSink } from "./log-sink";

export class NoopLogSink implements ILogSink {
  readonly name = "noop";

  async write(_entry: ILogEntry): Promise<ILogWriteResult> {
    return {
      accepted: true,
      sinkName: this.name,
    };
  }
}
