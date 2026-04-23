import type { ILogEntry, ILogWriteResult } from "../lib/interfaces";

export interface ILogSink {
  readonly name: string;
  write(entry: ILogEntry): Promise<ILogWriteResult>;
}

