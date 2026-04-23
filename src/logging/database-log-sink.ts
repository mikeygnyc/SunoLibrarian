import type { ILogEntry, ILogQueryFilter, ILogQueryResult, ILogQueryService, ILogWriteResult } from "../lib/interfaces";
import type { ILogSink } from "./log-sink";

export interface ILogRepository {
  write(entry: ILogEntry): Promise<void>;
  query(filter?: ILogQueryFilter): Promise<ILogQueryResult>;
}

export class DatabaseLogSink implements ILogSink {
  readonly name = "database";

  constructor(private readonly repository: ILogRepository) {}

  async write(entry: ILogEntry): Promise<ILogWriteResult> {
    try {
      await this.repository.write(entry);
      return {
        accepted: true,
        sinkName: this.name,
      };
    } catch (error) {
      return {
        accepted: false,
        sinkName: this.name,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}

export class LogQueryService implements ILogQueryService {
  constructor(private readonly repository: ILogRepository) {}

  query(filter?: ILogQueryFilter): Promise<ILogQueryResult> {
    return this.repository.query(filter);
  }
}

