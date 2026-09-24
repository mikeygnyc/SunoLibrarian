import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";

export const DEFAULT_CLI_CONFIG = "suno-export.config.json";

type CliConfigFile = {
  target?: {
    apiUrl?: string;
    localRoot?: string;
  };
  runtime?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  commands?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

const RESERVED_TOP_LEVEL_KEYS = new Set(["target", "runtime", "defaults", "commands"]);
const PATH_OPTION_KEYS = new Set([
  "browserProfile",
  "cacheDir",
  "config",
  "database",
  "exportMetadataJson",
  "fetchImageList",
  "importMetadataJson",
  "input",
  "library",
  "list",
  "logFile",
  "metadataFile",
  "output",
  "payload",
]);

export function resolveCliCommandOptions(
  commandName: string,
  rawOptions: Record<string, unknown>,
  command?: Command,
): Record<string, unknown> {
  const resolvedConfig = loadCliConfigFile(optionalString(rawOptions.config));
  const configDefaults = resolvedConfig
    ? buildConfigDefaults(resolvedConfig.parsed, resolvedConfig.baseDir, commandName)
    : {};

  const mergedOptions: Record<string, unknown> = { ...configDefaults };
  const optionEntries = Object.entries(rawOptions);

  for (const [key, value] of optionEntries) {
    const source = command?.getOptionValueSource(key);
    if (source === "cli" || source === "env" || !(key in mergedOptions)) {
      mergedOptions[key] = value;
    }
  }

  if (resolvedConfig) {
    mergedOptions.config = resolvedConfig.configPath;
  }

  return mergedOptions;
}

type LoadedCliConfig = {
  configPath: string;
  baseDir: string;
  parsed: CliConfigFile;
};

function loadCliConfigFile(explicitPath?: string): LoadedCliConfig | undefined {
  const configPath = explicitPath
    ? path.resolve(explicitPath)
    : path.resolve(process.cwd(), DEFAULT_CLI_CONFIG);

  if (!fs.existsSync(configPath)) {
    if (explicitPath) {
      throw new Error(`CLI config file not found: ${configPath}`);
    }
    return undefined;
  }

  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse CLI config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`CLI config must be a JSON object: ${configPath}`);
  }

  return {
    configPath,
    baseDir: path.dirname(configPath),
    parsed: parsed as CliConfigFile,
  };
}

function buildConfigDefaults(
  config: CliConfigFile,
  baseDir: string,
  commandName: string,
): Record<string, unknown> {
  const topLevelDefaults = Object.fromEntries(
    Object.entries(config).filter(([key]) => !RESERVED_TOP_LEVEL_KEYS.has(key)),
  );

  const commandDefaults = resolveCommandDefaults(config, commandName);
  if (commandDefaults !== undefined && !isPlainObject(commandDefaults)) {
    throw new Error(`CLI config commands.${commandName} must be an object`);
  }

  return resolveConfigPaths(
    {
      ...topLevelDefaults,
      ...(isPlainObject(config.runtime) ? config.runtime : {}),
      ...(isPlainObject(config.defaults) ? config.defaults : {}),
      ...(commandDefaults ?? {}),
    },
    baseDir,
  );
}

function resolveCommandDefaults(
  config: CliConfigFile,
  commandName: string,
): Record<string, unknown> | undefined {
  const commands = config.commands;
  if (!commands) {
    return undefined;
  }

  const explicitDefaults = commands[commandName];
  if (explicitDefaults !== undefined) {
    return explicitDefaults;
  }

  const fallbackCommandNames = COMMAND_DEFAULT_FALLBACKS[commandName] ?? [];
  for (const fallbackName of fallbackCommandNames) {
    const fallbackDefaults = commands[fallbackName];
    if (fallbackDefaults !== undefined) {
      return fallbackDefaults;
    }
  }

  return undefined;
}

const COMMAND_DEFAULT_FALLBACKS: Record<string, string[]> = {
  "run-librarian": ["serve-api"],
  "run-worker": ["serve-api"],
};

function resolveConfigPaths(
  options: Record<string, unknown>,
  baseDir: string,
): Record<string, unknown> {
  const resolvedOptions: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(options)) {
    if (PATH_OPTION_KEYS.has(key) && typeof value === "string" && value.trim().length > 0) {
      resolvedOptions[key] = path.resolve(baseDir, value.trim());
      continue;
    }
    resolvedOptions[key] = value;
  }

  return resolvedOptions;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
