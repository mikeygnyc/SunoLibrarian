import type { ILogContext, ILogEntry, ILogWriteResult, LogLevel } from "../lib/interfaces";
import type { ILogSink } from "./log-sink";
import { shouldLog } from "./log-level";

export type CentralLoggerOptions = {
  minimumLevel?: LogLevel;
  sinks?: ILogSink[];
  baseContext?: ILogContext;
};

export class CentralLogger {
  private readonly minimumLevel: LogLevel;
  private readonly sinks: ILogSink[];
  private readonly baseContext?: ILogContext;

  constructor(options: CentralLoggerOptions = {}) {
    this.minimumLevel = options.minimumLevel ?? "info";
    this.sinks = options.sinks ?? [];
    this.baseContext = options.baseContext;
  }

  child(context: ILogContext): CentralLogger {
    return new CentralLogger({
      minimumLevel: this.minimumLevel,
      sinks: this.sinks,
      baseContext: mergeContext(this.baseContext, context),
    });
  }

  async debug(message: string, context?: ILogContext): Promise<ILogWriteResult[]> {
    return this.log("debug", message, context);
  }

  async info(message: string, context?: ILogContext): Promise<ILogWriteResult[]> {
    return this.log("info", message, context);
  }

  async warn(message: string, context?: ILogContext): Promise<ILogWriteResult[]> {
    return this.log("warn", message, context);
  }

  async error(message: string, context?: ILogContext): Promise<ILogWriteResult[]> {
    return this.log("error", message, context);
  }

  async log(level: LogLevel, message: string, context?: ILogContext): Promise<ILogWriteResult[]> {
    if (!shouldLog(level, this.minimumLevel)) {
      return [];
    }

    const entry: ILogEntry = {
      timestamp: new Date(),
      level,
      message,
      context: mergeContext(this.baseContext, context),
    };

    return Promise.all(this.sinks.map((sink) => sink.write(entry)));
  }
}

function mergeContext(baseContext?: ILogContext, overrideContext?: ILogContext): ILogContext | undefined {
  if (!baseContext && !overrideContext) return undefined;

  return {
    ...baseContext,
    ...overrideContext,
    properties: {
      ...(baseContext?.properties ?? {}),
      ...(overrideContext?.properties ?? {}),
    },
    tags: dedupeTags(baseContext?.tags, overrideContext?.tags),
  };
}

function dedupeTags(...tagLists: Array<string[] | undefined>): string[] | undefined {
  const tags = Array.from(new Set(tagLists.flatMap((tagList) => tagList ?? [])));
  return tags.length > 0 ? tags : undefined;
}
