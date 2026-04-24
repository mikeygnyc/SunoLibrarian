import { spawn } from "child_process";
import { CancellationError } from "./cancellation";

type RunCommandOptions = {
  signal?: AbortSignal;
};

type RunCommandResult = {
  stdout: string;
  stderr: string;
};

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  return new Promise<RunCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let abortTimeout: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (abortTimeout) {
        clearTimeout(abortTimeout);
      }
      options.signal?.removeEventListener("abort", onAbort);
    };

    const finishResolve = (result: RunCommandResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      if (settled) return;
      child.kill("SIGTERM");
      abortTimeout = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 1000);
    };

    if (options.signal?.aborted) {
      finishReject(getAbortError(options.signal.reason));
      child.kill("SIGTERM");
      return;
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      finishReject(error);
    });

    child.once("close", (code, signal) => {
      if (options.signal?.aborted) {
        finishReject(getAbortError(options.signal.reason));
        return;
      }

      if (code === 0) {
        finishResolve({ stdout, stderr });
        return;
      }

      const error = new Error(
        `${command} exited with code ${code ?? "null"} and signal ${signal ?? "null"}${stderr ? `: ${stderr}` : ""}`,
      ) as Error & { stdout?: string; stderr?: string };
      error.stdout = stdout;
      error.stderr = stderr;
      finishReject(error);
    });
  });
}

function getAbortError(reason: unknown): CancellationError {
  if (reason instanceof CancellationError) {
    return reason;
  }
  if (reason instanceof Error) {
    return new CancellationError(reason.message);
  }
  return new CancellationError(typeof reason === "string" ? reason : "Job cancelled");
}
