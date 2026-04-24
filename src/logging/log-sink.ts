import type { ILogEntry, ILogWriteResult } from "../core/contracts";

export interface ILogSink {
  readonly name: string;
  write(entry: ILogEntry): Promise<ILogWriteResult>;
}
