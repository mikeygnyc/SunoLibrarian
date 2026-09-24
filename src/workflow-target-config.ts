import * as fs from "fs";
import * as path from "path";
import type { CliOptions } from "./services/auth-service";

export const DEFAULT_WORKFLOW_TARGET_CONFIG = "suno-export.config.json";

type WorkflowTargetFile = {
  target?: {
    apiUrl?: string;
    localRoot?: string;
  };
  
};

export type ResolvedWorkflowTarget =
   {
      kind: "api";
      apiUrl: string;
      configPath?: string;
    }
  | {
      kind: "local";
      localRoot: string;
      configPath?: string;
    };

export function resolveWorkflowTarget(options: CliOptions): ResolvedWorkflowTarget | undefined {
  const explicitApiUrl = optionalString(options.apiUrl);
  if (explicitApiUrl) {
    return { kind: "api", apiUrl: explicitApiUrl };
  }

  const resolvedConfig = loadWorkflowTargetConfig(optionalString(options.config));
  if (!resolvedConfig) {
    return undefined;
  }

  return resolvedConfig;
}

function loadWorkflowTargetConfig(explicitPath?: string): ResolvedWorkflowTarget | undefined {
  const configPath = explicitPath
    ? path.resolve(explicitPath)
    : path.resolve(process.cwd(), DEFAULT_WORKFLOW_TARGET_CONFIG);

  if (!fs.existsSync(configPath)) {
    if (explicitPath) {
      throw new Error(`Workflow config file not found: ${configPath}`);
    }
    return undefined;
  }

  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: WorkflowTargetFile;
  try {
    parsed = JSON.parse(raw) as WorkflowTargetFile;
  } catch (error) {
    throw new Error(`Failed to parse workflow config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Workflow config must be a JSON object: ${configPath}`);
  }

  const target = parsed.target;
  if (target === undefined) {
    return undefined;
  }

  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new Error(`Workflow config target must be an object: ${configPath}`);
  }

  const apiUrl = optionalString(target.apiUrl);
  const localRootValue = optionalString(target.localRoot);
  const localRoot = localRootValue ? path.resolve(path.dirname(configPath), localRootValue) : undefined;

  if ((apiUrl ? 1 : 0) + (localRoot ? 1 : 0) !== 1) {
    throw new Error(`Workflow config target must include exactly one of target.apiUrl or target.localRoot: ${configPath}`);
  }

  return apiUrl
    ? { kind: "api", apiUrl, configPath }
    : { kind: "local", localRoot: localRoot!, configPath };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
