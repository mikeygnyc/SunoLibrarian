import assert from "node:assert/strict";
import test from "node:test";
import {
  attachBrowserAbortHandlers,
  visitSunoRoutesUntilToken,
} from "../src/lib/auth/auth";

test("attachBrowserAbortHandlers closes page and local browser on abort", async () => {
  let pageClosed = 0;
  let browserClosed = 0;

  const controller = new AbortController();
  const cleanup = attachBrowserAbortHandlers({
    browser: {
      close: async () => {
        browserClosed += 1;
      },
      disconnect: async () => undefined,
    } as any,
    page: {
      isClosed: () => false,
      close: async () => {
        pageClosed += 1;
      },
    } as any,
    isRemoteBrowser: false,
    signal: controller.signal,
  });

  controller.abort(new Error("cancelled"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  cleanup();

  assert.equal(pageClosed, 1);
  assert.equal(browserClosed, 1);
});

test("visitSunoRoutesUntilToken ignores a navigation timeout after capturing a token", async () => {
  let capturedToken: string | null = null;
  let waitUntil: string | undefined;
  const page = {
    isClosed: () => false,
    goto: async (_route: string, options: { waitUntil?: string }) => {
      waitUntil = options.waitUntil;
      capturedToken = "captured-token";
      throw new Error("Navigation timeout of 30000 ms exceeded");
    },
  };

  await visitSunoRoutesUntilToken(page as any, () => capturedToken);

  assert.equal(waitUntil, "domcontentloaded");
  assert.equal(capturedToken, "captured-token");
});

test("visitSunoRoutesUntilToken preserves navigation failures before token capture", async () => {
  const page = {
    isClosed: () => false,
    goto: async () => {
      throw new Error("Navigation failed");
    },
  };

  await assert.rejects(
    visitSunoRoutesUntilToken(page as any, () => null),
    /Navigation failed/,
  );
});
