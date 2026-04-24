import assert from "node:assert/strict";
import test from "node:test";
import { attachBrowserAbortHandlers } from "../src/auth";

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
