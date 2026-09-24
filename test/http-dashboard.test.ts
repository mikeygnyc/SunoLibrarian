import assert from "node:assert/strict";
import test from "node:test";
import { renderDashboardHtml } from "../src/http-dashboard";

test("renderDashboardHtml includes the operator shell and API hooks", () => {
  const html = renderDashboardHtml();

  assert.match(html, /Suno Export Control Room/);
  assert.match(html, /id="authAlertRoot"/);
  assert.match(html, /id="workflowForm"/);
  assert.match(html, /id="jobsList"/);
  assert.match(html, /\/api\/v1\/workflows\//);
  assert.match(html, /\/api\/v1\/jobs\//);
  assert.match(html, /capture-auth-token --browser/);
  assert.match(html, /Auto-refresh overview every 10 seconds/);
});
