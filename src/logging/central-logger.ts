import type { ILogContext, ILogEntry, ILogWriteResult, LogLevel } from "../core/contracts";
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

    const mergedContext = withDerivedSubsystem(mergeContext(this.baseContext, context));

    const entry: ILogEntry = {
      timestamp: new Date(),
      level,
      message,
      context: mergedContext,
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

function withDerivedSubsystem(context?: ILogContext): ILogContext | undefined {
  if (!context) {
    return undefined;
  }

  if (typeof context.subsystem === "string" && context.subsystem.trim().length > 0) {
    return context;
  }

  const stageType = typeof context.properties?.stageType === "string"
    ? context.properties.stageType.trim()
    : "";
  if (stageType) {
    return {
      ...context,
      subsystem: stageType,
    };
  }

  const role = typeof context.role === "string" ? context.role.trim() : "";
  if (role) {
    return {
      ...context,
      subsystem: role,
    };
  }

  return context;
}
