export class CancellationError extends Error {
  constructor(message: string = "Job cancelled") {
    super(message);
    this.name = "CancellationError";
  }
}

export type CancellationAssertion = () => Promise<void> | void;
export type CancellationMonitor = {
  signal: AbortSignal;
  stop: () => void;
};

export async function assertNotCancelled(source: { assertNotCancelled?: CancellationAssertion } | Record<string, any>): Promise<void> {
  const candidate = (source as { assertNotCancelled?: CancellationAssertion }).assertNotCancelled
    ?? (source as { __assertNotCancelled?: CancellationAssertion }).__assertNotCancelled;
  if (!candidate) return;
  await candidate();
}

export function isCancellationError(error: unknown): error is CancellationError {
  return error instanceof CancellationError
    || (error instanceof Error && error.name === "CancellationError");
}

export function createCancellationMonitor(
  assertNotCancelled: CancellationAssertion,
  pollIntervalMs: number = 250,
): CancellationMonitor {
  const controller = new AbortController();
  let stopped = false;
  let checking = false;

  const runCheck = async () => {
    if (stopped || checking || controller.signal.aborted) return;
    checking = true;
    try {
      await assertNotCancelled();
    } catch (error) {
      controller.abort(
        isCancellationError(error)
          ? error
          : new CancellationError(error instanceof Error ? error.message : String(error)),
      );
    } finally {
      checking = false;
    }
  };

  void runCheck();
  const timer = setInterval(() => {
    void runCheck();
  }, pollIntervalMs);
  timer.unref();

  return {
    signal: controller.signal,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
