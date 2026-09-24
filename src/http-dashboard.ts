export function renderDashboardHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Suno Export Control Room</title>
    <style>
      :root {
        --bg: #f4efe4;
        --bg-accent: #e4dcc9;
        --panel: rgba(255, 252, 246, 0.86);
        --panel-strong: #fffaf0;
        --ink: #173229;
        --muted: #5e6d64;
        --line: rgba(23, 50, 41, 0.14);
        --brand: #be5b3c;
        --brand-strong: #8f3e29;
        --ok: #2d7d57;
        --warn: #b97222;
        --danger: #a13e3a;
        --shadow: 0 24px 60px rgba(69, 44, 23, 0.12);
        --radius: 22px;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--ink);
        font-family: "Avenir Next", "Trebuchet MS", "Helvetica Neue", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(190, 91, 60, 0.12), transparent 28%),
          radial-gradient(circle at top right, rgba(45, 125, 87, 0.14), transparent 24%),
          linear-gradient(180deg, #f9f4e8 0%, var(--bg) 42%, #ebe1cf 100%);
        min-height: 100vh;
      }

      .shell {
        width: min(1440px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 40px;
      }

      .hero {
        position: relative;
        overflow: hidden;
        margin-bottom: 20px;
        padding: 28px;
        border: 1px solid rgba(255, 255, 255, 0.35);
        border-radius: calc(var(--radius) + 8px);
        background:
          linear-gradient(135deg, rgba(23, 50, 41, 0.96), rgba(23, 50, 41, 0.82)),
          linear-gradient(135deg, rgba(190, 91, 60, 0.12), rgba(255, 255, 255, 0.04));
        box-shadow: var(--shadow);
        color: #fff7ed;
      }

      .hero::after {
        content: "";
        position: absolute;
        inset: auto -60px -100px auto;
        width: 240px;
        height: 240px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255, 208, 156, 0.36), transparent 70%);
        pointer-events: none;
      }

      .eyebrow {
        margin: 0 0 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        font-size: 12px;
        color: rgba(255, 247, 237, 0.72);
      }

      h1, h2, h3 {
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
        letter-spacing: -0.02em;
        margin: 0;
      }

      h1 {
        font-size: clamp(2.3rem, 4vw, 4.2rem);
        line-height: 0.96;
        max-width: 9ch;
      }

      .hero-copy {
        max-width: 720px;
        margin: 14px 0 22px;
        color: rgba(255, 247, 237, 0.86);
        font-size: 1.03rem;
      }

      .hero-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }

      .hero-stat {
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(10px);
      }

      .hero-stat-label {
        display: block;
        margin-bottom: 6px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: rgba(255, 247, 237, 0.68);
      }

      .hero-stat-value {
        font-size: 1.15rem;
        font-weight: 700;
      }

      .layout {
        display: grid;
        gap: 18px;
        grid-template-columns: 360px minmax(0, 1fr);
      }

      .stack {
        display: grid;
        gap: 18px;
      }

      .panel {
        border: 1px solid rgba(255, 255, 255, 0.5);
        border-radius: var(--radius);
        background: var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(12px);
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 18px 20px 0;
      }

      .panel-header p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 0.94rem;
      }

      .panel-body {
        padding: 18px 20px 20px;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 0.83rem;
        font-weight: 700;
        background: rgba(255, 255, 255, 0.72);
        color: var(--ink);
        border: 1px solid var(--line);
      }

      .chip::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
        opacity: 0.7;
      }

      .chip.ok { color: var(--ok); }
      .chip.warn { color: var(--warn); }
      .chip.danger { color: var(--danger); }
      .chip.brand { color: var(--brand-strong); }

      .alert {
        margin-bottom: 18px;
        padding: 16px 18px;
        border-radius: 18px;
        border: 1px solid rgba(185, 114, 34, 0.26);
        background: linear-gradient(180deg, rgba(255, 243, 220, 0.96), rgba(255, 249, 239, 0.98));
        box-shadow: 0 12px 28px rgba(69, 44, 23, 0.08);
      }

      .alert strong {
        display: block;
        margin-bottom: 6px;
      }

      .alert.danger {
        border-color: rgba(161, 62, 58, 0.28);
        background: linear-gradient(180deg, rgba(255, 233, 229, 0.96), rgba(255, 247, 245, 0.98));
      }

      form, .form-grid {
        display: grid;
        gap: 12px;
      }

      .form-grid.two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      label {
        display: grid;
        gap: 6px;
        font-size: 0.84rem;
        font-weight: 700;
        color: var(--muted);
      }

      input, select, textarea, button {
        font: inherit;
      }

      input, select, textarea {
        width: 100%;
        padding: 12px 13px;
        border: 1px solid rgba(23, 50, 41, 0.16);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.88);
        color: var(--ink);
        transition: border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
      }

      textarea {
        min-height: 220px;
        resize: vertical;
        font-family: "SFMono-Regular", "Menlo", "Monaco", "Consolas", monospace;
        font-size: 0.92rem;
        line-height: 1.45;
      }

      input:focus, select:focus, textarea:focus {
        outline: none;
        border-color: rgba(190, 91, 60, 0.58);
        box-shadow: 0 0 0 4px rgba(190, 91, 60, 0.11);
        transform: translateY(-1px);
      }

      button {
        cursor: pointer;
        border: 0;
        border-radius: 999px;
        padding: 12px 16px;
        background: var(--ink);
        color: #fff8f1;
        font-weight: 700;
        transition: transform 160ms ease, filter 160ms ease, background 160ms ease;
      }

      button:hover:not(:disabled) {
        transform: translateY(-1px);
        filter: brightness(1.04);
      }

      button:disabled {
        opacity: 0.58;
        cursor: wait;
      }

      .button-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .button-secondary {
        background: rgba(255, 255, 255, 0.88);
        color: var(--ink);
        border: 1px solid var(--line);
      }

      .button-brand {
        background: linear-gradient(135deg, var(--brand), var(--brand-strong));
      }

      .button-danger {
        background: linear-gradient(135deg, var(--danger), #7f2825);
      }

      .jobs-toolbar, .detail-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }

      .jobs-list {
        display: grid;
        gap: 12px;
      }

      .job-card {
        border: 1px solid transparent;
        border-radius: 18px;
        padding: 14px 15px;
        background: rgba(255, 255, 255, 0.7);
        transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
      }

      .job-card:hover {
        transform: translateY(-1px);
        border-color: rgba(190, 91, 60, 0.25);
      }

      .job-card.active {
        background: rgba(255, 247, 237, 0.94);
        border-color: rgba(190, 91, 60, 0.48);
      }

      .job-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }

      .job-card-title {
        font-weight: 800;
      }

      .job-card-meta, .muted {
        color: var(--muted);
        font-size: 0.92rem;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: rgba(23, 50, 41, 0.08);
      }

      .status-pill::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
      }

      .status-pill.running, .status-pill.succeeded, .status-pill.completed { color: var(--ok); }
      .status-pill.queued, .status-pill.pending, .status-pill.blocked { color: var(--warn); }
      .status-pill.failed, .status-pill.cancelled { color: var(--danger); }

      .status-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }

      .status-count {
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 0.78rem;
        font-weight: 700;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.72);
      }

      .detail-grid {
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
      }

      .stage-list, .log-list {
        display: grid;
        gap: 10px;
      }

      .stage-card, .log-card {
        padding: 14px 15px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(23, 50, 41, 0.1);
      }

      .stage-head, .log-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }

      .stage-seq {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(190, 91, 60, 0.12);
        color: var(--brand-strong);
        font-weight: 800;
      }

      .prelude {
        padding: 16px;
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(255,255,255,0.56), rgba(255,255,255,0.82));
        border: 1px dashed rgba(23, 50, 41, 0.2);
        color: var(--muted);
      }

      .message {
        min-height: 22px;
        font-size: 0.92rem;
        color: var(--brand-strong);
      }

      .message.error {
        color: var(--danger);
      }

      .mono {
        font-family: "SFMono-Regular", "Menlo", "Monaco", "Consolas", monospace;
      }

      .footer-note {
        margin-top: 20px;
        color: var(--muted);
        font-size: 0.88rem;
        text-align: center;
      }

      @media (max-width: 1100px) {
        .layout,
        .detail-grid,
        .form-grid.two {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 720px) {
        .shell {
          width: min(100vw - 20px, 1440px);
          padding-top: 14px;
        }

        .hero,
        .panel-body {
          padding-left: 16px;
          padding-right: 16px;
        }

        .panel-header {
          padding-left: 16px;
          padding-right: 16px;
        }

        .jobs-toolbar, .detail-toolbar, .button-row {
          flex-direction: column;
          align-items: stretch;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <p class="eyebrow">Suno Export</p>
        <h1>Control Room</h1>
        <p class="hero-copy">
          A small operator dashboard for submitting workflows, checking auth state,
          following job progress, and cancelling work before it hogs a shared cluster.
        </p>
        <div class="hero-grid">
          <div class="hero-stat">
            <span class="hero-stat-label">API</span>
            <span class="hero-stat-value" id="apiHealthValue">Checking...</span>
          </div>
          <div class="hero-stat">
            <span class="hero-stat-label">Auth Cache</span>
            <span class="hero-stat-value" id="authStateValue">Checking...</span>
          </div>
          <div class="hero-stat">
            <span class="hero-stat-label">Queued + Running</span>
            <span class="hero-stat-value" id="jobCountValue">0 jobs</span>
          </div>
        </div>
      </section>

      <div class="layout">
        <div class="stack">
          <section class="panel">
            <div class="panel-header">
              <div>
                <h2>Auth</h2>
                <p>Update or clear the cached token used by acquisition flows.</p>
              </div>
            </div>
            <div class="panel-body">
              <div class="chips" id="authChips"></div>
              <form id="tokenForm">
                <label>
                  Token
                  <input id="tokenInput" type="password" placeholder="Paste a bearer token">
                </label>
                <div class="button-row">
                  <button class="button-brand" type="submit" id="setTokenButton">Save Token</button>
                  <button class="button-secondary" type="button" id="clearTokenButton">Clear Token</button>
                </div>
                <div class="message" id="authMessage"></div>
              </form>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <div>
                <h2>Submit Workflow</h2>
                <p>Use the validated API payloads instead of raw CLI options.</p>
              </div>
            </div>
            <div class="panel-body">
              <form id="workflowForm">
                <div class="form-grid two">
                  <label>
                    Workflow
                    <select id="workflowTypeSelect"></select>
                  </label>
                  <label>
                    Jobs To Show
                    <input id="jobLimitInput" type="number" min="1" step="1" value="25">
                  </label>
                </div>
                <label>
                  Payload JSON
                  <textarea id="workflowPayloadInput" spellcheck="false"></textarea>
                </label>
                <div class="button-row">
                  <button class="button-brand" type="submit" id="submitWorkflowButton">Queue Workflow</button>
                  <button class="button-secondary" type="button" id="resetPayloadButton">Reset Sample</button>
                  <button class="button-secondary" type="button" id="refreshAllButton">Refresh Everything</button>
                </div>
                <label>
                  <input id="autoRefreshCheckbox" type="checkbox" checked>
                  Auto-refresh overview every 10 seconds
                </label>
                <div class="message" id="workflowMessage"></div>
              </form>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <div class="panel-header">
              <div>
                <h2>Jobs</h2>
                <p>Pick a job to inspect stage progress, event messages, and related logs.</p>
              </div>
            </div>
            <div class="panel-body">
              <div class="jobs-toolbar">
                <div class="chips" id="overviewChips"></div>
                <div class="button-row">
                  <button class="button-secondary" type="button" id="refreshJobsButton">Refresh Jobs</button>
                </div>
              </div>
              <div class="jobs-list" id="jobsList">
                <div class="prelude">Jobs will appear here once the control plane has work queued.</div>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <div>
                <h2>Job Detail</h2>
                <p>Selected job stage breakdown, status event summary, and recent logs.</p>
              </div>
              <div class="button-row">
                <button class="button-danger" type="button" id="cancelJobButton" disabled>Cancel Job</button>
              </div>
            </div>
            <div class="panel-body">
              <div id="jobDetailRoot" class="prelude">Choose a job from the list to inspect it here.</div>
            </div>
          </section>
        </div>
      </div>

      <div id="authAlertRoot"></div>

      <p class="footer-note">
        The dashboard talks to the same HTTP API used by the CLI utility and future automation clients.
      </p>
    </div>

    <script>
      (function () {
        const WORKFLOW_SAMPLES = {
          download: {
            format: "wav"
          },
          process: {
            formats: ["flac", "mp3"],
            bitrateKbps: 320,
            embedImages: true,
            embedLyrics: true
          },
          sync: {
            format: "wav",
            formats: ["flac", "mp3"],
            bitrateKbps: 320,
            embedImages: true,
            embedLyrics: true
          },
          "download-images": {
            fetchMissing: true
          },
          "fetch-metadata": {},
          refresh: {}
        };

        const state = {
          jobs: [],
          auth: null,
          health: null,
          selectedJobId: null,
          selectedJobDetail: null,
          selectedJobLogs: []
        };

        const refs = {
          apiHealthValue: document.getElementById("apiHealthValue"),
          authStateValue: document.getElementById("authStateValue"),
          jobCountValue: document.getElementById("jobCountValue"),
          authChips: document.getElementById("authChips"),
          authAlertRoot: document.getElementById("authAlertRoot"),
          authMessage: document.getElementById("authMessage"),
          workflowMessage: document.getElementById("workflowMessage"),
          jobsList: document.getElementById("jobsList"),
          overviewChips: document.getElementById("overviewChips"),
          jobDetailRoot: document.getElementById("jobDetailRoot"),
          workflowTypeSelect: document.getElementById("workflowTypeSelect"),
          workflowPayloadInput: document.getElementById("workflowPayloadInput"),
          resetPayloadButton: document.getElementById("resetPayloadButton"),
          refreshAllButton: document.getElementById("refreshAllButton"),
          refreshJobsButton: document.getElementById("refreshJobsButton"),
          submitWorkflowButton: document.getElementById("submitWorkflowButton"),
          cancelJobButton: document.getElementById("cancelJobButton"),
          clearTokenButton: document.getElementById("clearTokenButton"),
          setTokenButton: document.getElementById("setTokenButton"),
          tokenInput: document.getElementById("tokenInput"),
          tokenForm: document.getElementById("tokenForm"),
          workflowForm: document.getElementById("workflowForm"),
          jobLimitInput: document.getElementById("jobLimitInput"),
          autoRefreshCheckbox: document.getElementById("autoRefreshCheckbox")
        };

        function setMessage(element, text, isError) {
          element.textContent = text || "";
          element.className = isError ? "message error" : "message";
        }

        function statusTone(status) {
          switch (status) {
            case "completed":
            case "succeeded":
            case "running":
              return "ok";
            case "queued":
            case "pending":
            case "blocked":
              return "warn";
            case "failed":
            case "cancelled":
              return "danger";
            default:
              return "brand";
          }
        }

        function statusPill(status) {
          return '<span class="status-pill ' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>';
        }

        function statusCount(status, count) {
          return '<span class="status-count">' + escapeHtml(status) + ': ' + escapeHtml(String(count)) + '</span>';
        }

        function escapeHtml(value) {
          return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        function formatTime(value) {
          if (!value) return "Not started";
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) return String(value);
          return date.toLocaleString();
        }

        function getSelectedWorkflow() {
          return refs.workflowTypeSelect.value;
        }

        function applyWorkflowSample(workflow) {
          refs.workflowPayloadInput.value = JSON.stringify(WORKFLOW_SAMPLES[workflow], null, 2);
        }

        function selectedLimit() {
          const parsed = Number.parseInt(refs.jobLimitInput.value, 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
        }

        function workflowNeedsAuth(workflowType) {
          return workflowType !== "process";
        }

        function isActiveJob(job) {
          return job && (job.status === "queued" || job.status === "running");
        }

        function mentionsAuth(value) {
          return typeof value === "string" && /(auth|token|login|401|403|browser)/i.test(value);
        }

        function getAuthBlockedJobs() {
          return (state.jobs || []).filter(function (job) {
            return isActiveJob(job) && workflowNeedsAuth(job.workflowType);
          });
        }

        function selectedJobNeedsAuthAttention() {
          const detail = state.selectedJobDetail;
          if (!detail || !detail.job || !workflowNeedsAuth(detail.job.workflowType)) {
            return false;
          }

          const authStage = (detail.stages || []).find(function (stage) {
            return stage.stageType === "authorization";
          });
          const latestStatusMessage = detail.statusEvents && detail.statusEvents.length
            ? detail.statusEvents[detail.statusEvents.length - 1].message
            : "";
          const authLog = (state.selectedJobLogs || []).find(function (entry) {
            return mentionsAuth(entry.message) || mentionsAuth(entry.context && entry.context.role);
          });

          return Boolean(
            (authStage && ["pending", "queued", "running", "blocked", "failed"].includes(authStage.status)) ||
            mentionsAuth(detail.job.errorMessage) ||
            mentionsAuth(latestStatusMessage) ||
            authLog
          );
        }

        async function fetchJson(path, options) {
          const response = await fetch(path, Object.assign({
            headers: {
              "accept": "application/json"
            }
          }, options || {}));

          const body = await response.json().catch(function () {
            return {};
          });

          if (!response.ok) {
            throw new Error(body && body.error ? body.error : "Request failed with status " + response.status);
          }

          return body;
        }

        async function loadOverview() {
          const limit = selectedLimit();
          const results = await Promise.all([
            fetchJson("/healthz"),
            fetchJson("/api/v1/auth/status"),
            fetchJson("/api/v1/jobs?limit=" + encodeURIComponent(String(limit)))
          ]);
          state.health = results[0];
          state.auth = results[1];
          state.jobs = results[2].jobs || [];
          renderOverview();
          renderJobs();
        }

        async function loadJobDetail(jobId) {
          if (!jobId) {
            state.selectedJobId = null;
            state.selectedJobDetail = null;
            state.selectedJobLogs = [];
            renderJobDetail();
            return;
          }

          state.selectedJobId = jobId;
          const detail = await fetchJson("/api/v1/jobs/" + encodeURIComponent(jobId));
          const logs = await fetchJson("/api/v1/logs?jobId=" + encodeURIComponent(jobId) + "&limit=40");
          state.selectedJobDetail = detail;
          state.selectedJobLogs = logs.entries || [];
          renderJobs();
          renderJobDetail();
        }

        function renderOverview() {
          refs.apiHealthValue.textContent = state.health && state.health.ok ? "Healthy" : "Unreachable";
          refs.authStateValue.textContent = state.auth && state.auth.hasToken ? "Token ready" : "Missing token";
          const activeJobs = state.jobs.filter(function (job) {
            return job.status === "queued" || job.status === "running";
          }).length;
          const authBlockedJobs = getAuthBlockedJobs();
          refs.jobCountValue.textContent = activeJobs + " active";

          refs.authChips.innerHTML = [
            '<span class="chip ' + (state.auth && state.auth.hasToken ? "ok" : "warn") + '">' +
              (state.auth && state.auth.hasToken ? "Cached token available" : "Auth required soon") +
            '</span>',
            '<span class="chip brand">Local helper: suno-export capture-auth-token --browser</span>'
          ].join("");

          if (state.auth && !state.auth.hasToken && authBlockedJobs.length > 0) {
            refs.authAlertRoot.innerHTML = '' +
              '<div class="alert danger">' +
                '<strong>Auth token required before queued work can move.</strong>' +
                '<div>' + escapeHtml(String(authBlockedJobs.length)) + ' queued or running job(s) still need Suno authentication. Capture a fresh token on your local machine with <span class="mono">suno-export capture-auth-token --browser http://localhost:9222</span>, then paste it into the Auth panel.</div>' +
              '</div>';
          } else if (state.auth && !state.auth.hasToken) {
            refs.authAlertRoot.innerHTML = '' +
              '<div class="alert">' +
                '<strong>No cached auth token is available.</strong>' +
                '<div>Auth-backed workflows will pause at authorization until you paste in a fresh token. The local helper is <span class="mono">suno-export capture-auth-token --browser http://localhost:9222</span>.</div>' +
              '</div>';
          } else {
            refs.authAlertRoot.innerHTML = "";
          }

          const counts = {};
          state.jobs.forEach(function (job) {
            counts[job.status] = (counts[job.status] || 0) + 1;
          });

          const chips = Object.keys(counts).length === 0
            ? ['<span class="chip brand">No jobs yet</span>']
            : Object.keys(counts).sort().map(function (status) {
              return '<span class="chip ' + statusTone(status) + '">' + escapeHtml(status) + ': ' + counts[status] + '</span>';
            });
          refs.overviewChips.innerHTML = chips.join("");
        }

        function renderJobs() {
          if (!state.jobs.length) {
            refs.jobsList.innerHTML = '<div class="prelude">No jobs found. Submit a workflow to get the queue moving.</div>';
            return;
          }

          refs.jobsList.innerHTML = state.jobs.map(function (job) {
            const isActive = state.selectedJobId === job.id;
            return '' +
              '<button class="job-card' + (isActive ? ' active' : '') + '" data-job-id="' + escapeHtml(job.id) + '">' +
                '<div class="job-card-header">' +
                  '<div>' +
                    '<div class="job-card-title mono">' + escapeHtml(job.id) + '</div>' +
                    '<div class="job-card-meta">' + escapeHtml(job.workflowType) + ' · ' + escapeHtml(job.runtimeMode) + '</div>' +
                  '</div>' +
                  statusPill(job.status) +
                '</div>' +
                '<div class="job-card-meta">Updated ' + escapeHtml(formatTime(job.updatedAt)) + '</div>' +
                (job.errorMessage ? '<div class="job-card-meta">Issue: ' + escapeHtml(job.errorMessage) + '</div>' : '') +
              '</button>';
          }).join("");

          Array.from(refs.jobsList.querySelectorAll("[data-job-id]")).forEach(function (button) {
            button.addEventListener("click", function () {
              loadJobDetail(button.getAttribute("data-job-id")).catch(handleError);
            });
          });
        }

        function renderJobDetail() {
          const detail = state.selectedJobDetail;
          refs.cancelJobButton.disabled = !detail || !detail.job || !["queued", "running"].includes(detail.job.status);

          if (!detail || !detail.job) {
            refs.jobDetailRoot.className = "prelude";
            refs.jobDetailRoot.innerHTML = "Choose a job from the list to inspect it here.";
            return;
          }

          const latestStatusMessage = detail.statusEvents && detail.statusEvents.length
            ? detail.statusEvents[detail.statusEvents.length - 1].message
            : "";
          const authBlockedCallout = !state.auth?.hasToken && selectedJobNeedsAuthAttention()
            ? '<div class="alert danger" style="margin-bottom:16px;"><strong>Authorization is probably holding up this job.</strong><div>This workflow still needs a fresh Suno token. Run <span class="mono">suno-export capture-auth-token --browser http://localhost:9222</span> locally, then paste the token into the Auth panel above.</div></div>'
            : "";

          const stageCards = (detail.stages || []).map(function (stage) {
            const workItemCounts = {};
            (detail.workItems || []).forEach(function (workItem) {
              if (workItem.stageId !== stage.id) return;
              workItemCounts[workItem.status] = (workItemCounts[workItem.status] || 0) + 1;
            });
            const countHtml = Object.keys(workItemCounts).length === 0
              ? '<span class="status-count">No work items</span>'
              : Object.keys(workItemCounts).sort().map(function (status) {
                return statusCount(status, workItemCounts[status]);
              }).join("");

            return '' +
              '<div class="stage-card">' +
                '<div class="stage-head">' +
                  '<div style="display:flex;align-items:center;gap:10px;">' +
                    '<span class="stage-seq">' + escapeHtml(String(stage.sequence)) + '</span>' +
                    '<div>' +
                      '<div><strong>' + escapeHtml(stage.stageType) + '</strong></div>' +
                      '<div class="muted">Started ' + escapeHtml(formatTime(stage.startedAt)) + '</div>' +
                    '</div>' +
                  '</div>' +
                  statusPill(stage.status) +
                '</div>' +
                '<div class="status-grid">' + countHtml + '</div>' +
                (stage.errorMessage ? '<div class="muted">Issue: ' + escapeHtml(stage.errorMessage) + '</div>' : '') +
              '</div>';
          }).join("");

          const logCards = state.selectedJobLogs.length === 0
            ? '<div class="prelude">No logs yet for this job.</div>'
            : state.selectedJobLogs.map(function (entry) {
              return '' +
                '<div class="log-card">' +
                  '<div class="log-head">' +
                    '<div><strong>' + escapeHtml(entry.message) + '</strong></div>' +
                    statusPill(entry.level) +
                  '</div>' +
                  '<div class="muted">' + escapeHtml(formatTime(entry.timestamp)) + '</div>' +
                  '<div class="muted mono">' +
                    [entry.context && entry.context.workflowType, entry.context && entry.context.role, entry.context && entry.context.jobId, entry.context && entry.context.stageId]
                      .filter(Boolean)
                      .map(escapeHtml)
                      .join(" · ") +
                  '</div>' +
                '</div>';
            }).join("");

          refs.jobDetailRoot.className = "";
          refs.jobDetailRoot.innerHTML = '' +
            authBlockedCallout +
              '<div class="detail-toolbar">' +
                '<div>' +
                  '<h3 class="mono">' + escapeHtml(detail.job.id) + '</h3>' +
                  '<div class="muted">' + escapeHtml(detail.job.workflowType) + ' · Updated ' + escapeHtml(formatTime(detail.job.updatedAt)) + '</div>' +
                (latestStatusMessage ? '<div class="muted">Latest event: ' + escapeHtml(latestStatusMessage) + '</div>' : '') +
              '</div>' +
              statusPill(detail.job.status) +
            '</div>' +
            '<div class="detail-grid">' +
              '<div>' +
                '<h3 style="margin-bottom:10px;">Stages</h3>' +
                '<div class="stage-list">' + stageCards + '</div>' +
              '</div>' +
              '<div>' +
                '<h3 style="margin-bottom:10px;">Recent Logs</h3>' +
                '<div class="log-list">' + logCards + '</div>' +
              '</div>' +
            '</div>';
        }

        async function submitWorkflow(event) {
          event.preventDefault();
          const workflow = getSelectedWorkflow();
          let payload;
          try {
            payload = JSON.parse(refs.workflowPayloadInput.value || "{}");
          } catch (error) {
            setMessage(refs.workflowMessage, "Payload JSON is invalid: " + error.message, true);
            return;
          }

          refs.submitWorkflowButton.disabled = true;
          setMessage(refs.workflowMessage, "Submitting workflow...", false);
          try {
            const result = await fetchJson("/api/v1/workflows/" + encodeURIComponent(workflow), {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "accept": "application/json"
              },
              body: JSON.stringify(payload)
            });
            setMessage(refs.workflowMessage, "Queued " + result.workflowType + " as " + result.jobId + ".", false);
            await loadOverview();
            await loadJobDetail(result.jobId);
          } catch (error) {
            setMessage(refs.workflowMessage, error.message || String(error), true);
          } finally {
            refs.submitWorkflowButton.disabled = false;
          }
        }

        async function setToken(event) {
          event.preventDefault();
          const token = refs.tokenInput.value.trim();
          if (!token) {
            setMessage(refs.authMessage, "Paste a token before saving.", true);
            return;
          }

          refs.setTokenButton.disabled = true;
          setMessage(refs.authMessage, "Saving token...", false);
          try {
            const result = await fetchJson("/api/v1/auth/token", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "accept": "application/json"
              },
              body: JSON.stringify({ token: token })
            });
            refs.tokenInput.value = "";
            if (result && result.restartError) {
              setMessage(refs.authMessage, "Cached token updated, but job restart failed: " + result.restartError, true);
            } else if (result && result.restartedJobCount > 0) {
              setMessage(refs.authMessage, "Cached token updated. Restarted " + result.restartedJobCount + " recent auth-blocked job(s).", false);
            } else {
              setMessage(refs.authMessage, "Cached token updated. No recent auth-blocked jobs needed a restart.", false);
            }
            await loadOverview();
            if (state.selectedJobId) {
              await loadJobDetail(state.selectedJobId);
            }
          } catch (error) {
            setMessage(refs.authMessage, error.message || String(error), true);
          } finally {
            refs.setTokenButton.disabled = false;
          }
        }

        async function clearToken() {
          refs.clearTokenButton.disabled = true;
          setMessage(refs.authMessage, "Clearing cached token...", false);
          try {
            await fetchJson("/api/v1/auth/token", { method: "DELETE" });
            setMessage(refs.authMessage, "Cached token cleared.", false);
            await loadOverview();
          } catch (error) {
            setMessage(refs.authMessage, error.message || String(error), true);
          } finally {
            refs.clearTokenButton.disabled = false;
          }
        }

        async function cancelSelectedJob() {
          if (!state.selectedJobId) return;
          refs.cancelJobButton.disabled = true;
          try {
            await fetchJson("/api/v1/jobs/" + encodeURIComponent(state.selectedJobId) + "/cancel", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "accept": "application/json"
              },
              body: JSON.stringify({ reason: "Cancelled from dashboard" })
            });
            await loadOverview();
            await loadJobDetail(state.selectedJobId);
          } catch (error) {
            setMessage(refs.workflowMessage, error.message || String(error), true);
          } finally {
            refs.cancelJobButton.disabled = false;
          }
        }

        function handleError(error) {
          const message = error && error.message ? error.message : String(error);
          setMessage(refs.workflowMessage, message, true);
        }

        function scheduleAutoRefresh() {
          setInterval(function () {
            if (!refs.autoRefreshCheckbox.checked) return;
            loadOverview()
              .then(function () {
                if (state.selectedJobId) {
                  return loadJobDetail(state.selectedJobId);
                }
              })
              .catch(handleError);
          }, 10000);
        }

        function installEventHandlers() {
          Object.keys(WORKFLOW_SAMPLES).forEach(function (workflow) {
            const option = document.createElement("option");
            option.value = workflow;
            option.textContent = workflow;
            refs.workflowTypeSelect.appendChild(option);
          });
          refs.workflowTypeSelect.value = "process";
          applyWorkflowSample("process");

          refs.workflowTypeSelect.addEventListener("change", function () {
            applyWorkflowSample(getSelectedWorkflow());
          });
          refs.resetPayloadButton.addEventListener("click", function () {
            applyWorkflowSample(getSelectedWorkflow());
            setMessage(refs.workflowMessage, "Payload reset to the sample for " + getSelectedWorkflow() + ".", false);
          });
          refs.refreshAllButton.addEventListener("click", function () {
            loadOverview()
              .then(function () {
                if (state.selectedJobId) {
                  return loadJobDetail(state.selectedJobId);
                }
              })
              .catch(handleError);
          });
          refs.refreshJobsButton.addEventListener("click", function () {
            loadOverview().catch(handleError);
          });
          refs.workflowForm.addEventListener("submit", submitWorkflow);
          refs.tokenForm.addEventListener("submit", setToken);
          refs.clearTokenButton.addEventListener("click", function () {
            clearToken().catch(handleError);
          });
          refs.cancelJobButton.addEventListener("click", function () {
            cancelSelectedJob().catch(handleError);
          });
        }

        installEventHandlers();
        loadOverview().catch(handleError);
        scheduleAutoRefresh();
      })();
    </script>
  </body>
</html>`;
}
