import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import puppeteer, { type Browser, type HTTPRequest, type Page } from "puppeteer";
import { spawn } from "child_process";
const browsersToCloseOnExit = new Set<Browser>();
let browserExitHooksRegistered = false;

export type BrowserLaunchOptions = {
  userDataDir?: string;
  profileDirectory?: string;
};

type BrowserProfileLaunchPaths = {
  userDataDir: string;
  profileDirectory?: string;
  preferencesDir: string;
};

type ChromeVersionInfo = {
  commandLine?: string;
  profilePath?: string;
};

const CHROME_PROFILE_COPY_SKIP_NAMES = new Set([
  "BrowserMetrics",
  "Cache",
  "Code Cache",
  "Crash Reports",
  "Crashpad",
  "DawnCache",
  "DevToolsActivePort",
  "GrShaderCache",
  "GPUCache",
  "Media Cache",
  "ShaderCache",
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket",
]);

function registerBrowserForProcessExit(browser: Browser): void {
  browsersToCloseOnExit.add(browser);

  if (browserExitHooksRegistered) return;
  browserExitHooksRegistered = true;

  const closeTrackedBrowsers = async () => {
    const browsers = Array.from(browsersToCloseOnExit);
    browsersToCloseOnExit.clear();
    await Promise.allSettled(
      browsers.map(async (b) => {
        try {
          await b.close();
        } catch {
          // best-effort shutdown
        }
      }),
    );
  };

  process.once("beforeExit", () => {
    void closeTrackedBrowsers();
  });
  process.once("SIGINT", () => {
    void closeTrackedBrowsers().finally(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    void closeTrackedBrowsers().finally(() => process.exit(143));
  });
}

function getBrowserDebugPort(browserUrl?: string): number {
  if (!browserUrl) return 9222;
  try {
    const parsed = new URL(browserUrl);
    const port = Number(parsed.port || "9222");
    return Number.isFinite(port) && port > 0 ? port : 9222;
  } catch {
    return 9222;
  }
}

function getPlatformChromeExecutablePath(): string | undefined {
  const candidates: string[] = [];

  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else if (process.platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    );
  } else if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    candidates.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(localAppData, "Google\\Chrome\\Application\\chrome.exe"),
    );
  }

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getDefaultChromeUserDataDir(): string | undefined {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library/Application Support/Google/Chrome");
  }

  if (process.platform === "linux") {
    return path.join(os.homedir(), ".config/google-chrome");
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData ? path.join(localAppData, "Google/Chrome/User Data") : undefined;
  }

  return undefined;
}

function realPathIfExists(filePath: string): string {
  return fs.existsSync(filePath) ? fs.realpathSync(filePath) : path.resolve(filePath);
}

function isSamePath(left: string, right: string): boolean {
  const resolvedLeft = realPathIfExists(left);
  const resolvedRight = realPathIfExists(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function assertRemoteDebuggableUserDataDir(userDataDir: string): void {
  const defaultChromeUserDataDir = getDefaultChromeUserDataDir();
  if (!defaultChromeUserDataDir || !isSamePath(userDataDir, defaultChromeUserDataDir)) {
    return;
  }

  throw new Error(
    [
      `Chrome remote debugging cannot use the default Chrome user data directory: ${userDataDir}`,
      "This also applies when the provided path is a symlink that resolves to the default Chrome profile root.",
      "Use a dedicated non-default profile directory and sign in there, or launch Chrome yourself with a non-default --user-data-dir and connect with --browser.",
    ].join("\n"),
  );
}

function buildBrowserLaunchError(error: unknown, userDataDir?: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const profileHint = userDataDir
    ? [
        "",
        `Chrome could not be launched with profile directory: ${userDataDir}`,
        "If this is your normal Chrome profile, close all Chrome windows first, or start Chrome yourself with remote debugging enabled and use --browser to connect to it.",
        "For day-to-day CLI auth, a dedicated profile directory is usually safer than the default Chrome profile.",
      ].join("\n")
    : "";

  return new Error(`Failed to launch local browser: ${message}${profileHint}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasChromePreferences(dir: string): boolean {
  return fs.existsSync(path.join(dir, "Preferences"));
}

function resolveBrowserProfileLaunchPaths(
  profilePath?: string,
  profileDirectory?: string,
): BrowserProfileLaunchPaths {
  const requestedPath = path.resolve(
    profilePath || path.join(os.homedir(), ".suno-exporter-chrome-profile"),
  );
  const requestedProfileDirectory = profileDirectory?.trim();

  if (requestedProfileDirectory) {
    return {
      userDataDir: requestedPath,
      profileDirectory: requestedProfileDirectory,
      preferencesDir: path.join(requestedPath, requestedProfileDirectory),
    };
  }

  if (hasChromePreferences(requestedPath)) {
    return {
      userDataDir: path.dirname(requestedPath),
      profileDirectory: path.basename(requestedPath),
      preferencesDir: requestedPath,
    };
  }

  return {
    userDataDir: requestedPath,
    profileDirectory: undefined,
    preferencesDir: path.join(requestedPath, "Default"),
  };
}

async function assertDebugPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", () => {
      reject(
        new Error(
          `Chrome debug port ${port} is already in use. Close the existing debug browser or pass a different --browser URL.`,
        ),
      );
    });

    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve());
    });
  });
}

function forceCleanExit(preferencesDir: string): void {
  const prefPath = path.join(preferencesDir, "Preferences");
  if (!fs.existsSync(prefPath)) return;

  let prefs = fs.readFileSync(prefPath, "utf8");
  
  // Replace the crash status with a normal exit status
  prefs = prefs.replace(/"exit_type":"Crashed"/g, '"exit_type":"Normal"');
  
  fs.writeFileSync(prefPath, prefs);
}

function warnIfProfileRootLooksIncomplete(
  launchPaths: BrowserProfileLaunchPaths,
): void {
  const localStatePath = path.join(launchPaths.userDataDir, "Local State");
  if (fs.existsSync(localStatePath)) return;

  console.warn(
    [
      `Chrome user data directory is missing Local State: ${localStatePath}`,
      "If this profile is a symlink to your regular Chrome account, symlink or provide the user-data root, not only the profile folder.",
      "A linked Default folder without Local State can open the right profile path but still lose login/cookie state.",
    ].join("\n"),
  );
}

async function getChromeVersionInfo(browser: Browser): Promise<ChromeVersionInfo> {
  const page = await browser.newPage();
  try {
    await page.goto("chrome://version", { waitUntil: "domcontentloaded" });
    const bodyText = String(await page.evaluate("document.body.innerText"));
    return {
      commandLine: bodyText.match(/Command Line\s+(.+)/)?.[1]?.trim(),
      profilePath: bodyText.match(/Profile Path\s+(.+)/)?.[1]?.trim(),
    };
  } catch {
    return {};
  } finally {
    await page.close().catch(() => {});
  }
}

async function warnIfChromeProfilePathDiffers(
  browser: Browser,
  launchPaths: BrowserProfileLaunchPaths,
): Promise<void> {
  const versionInfo = await getChromeVersionInfo(browser);
  if (versionInfo.commandLine) {
    console.log(`Chrome reports command line: ${versionInfo.commandLine}`);
  }
  if (!versionInfo.profilePath) return;

  console.log(`Chrome reports profile path: ${versionInfo.profilePath}`);

  const expectedProfilePath = path.join(
    launchPaths.userDataDir,
    launchPaths.profileDirectory || "Default",
  );
  const actualProfilePath = path.resolve(versionInfo.profilePath);
  const expectedResolvedPath = fs.existsSync(expectedProfilePath)
    ? fs.realpathSync(expectedProfilePath)
    : path.resolve(expectedProfilePath);
  const actualResolvedPath = fs.existsSync(actualProfilePath)
    ? fs.realpathSync(actualProfilePath)
    : actualProfilePath;

  if (actualResolvedPath !== expectedResolvedPath) {
    console.warn(
      [
        `Chrome profile mismatch: expected ${expectedProfilePath}`,
        `Chrome profile mismatch: actual ${versionInfo.profilePath}`,
      ].join("\n"),
    );
  }
}

async function logVisibleCookieNames(page: any, url: string): Promise<void> {
  try {
    const cookies = await page.cookies(url);
    const names = cookies.map((cookie: { name: string }) => cookie.name).sort();
    console.log(
      `Chrome sees ${cookies.length} cookies for ${url}: ${names.join(", ") || "(none)"}`,
    );
  } catch {
    // Cookie diagnostics should not block auth.
  }
}

function extractBearerTokenFromHeaders(
  headers: Record<string, unknown>,
): string | null {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "authorization" || typeof value !== "string") {
      continue;
    }

    if (value.startsWith("Bearer ")) {
      return value.replace("Bearer ", "").trim();
    }
  }

  return null;
}

function isSunoUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "suno.com" || hostname.endsWith(".suno.com");
  } catch {
    return url.includes("suno.com");
  }
}

async function visitSunoRoutesUntilToken(
  page: Page,
  getCapturedToken: () => string | null,
): Promise<void> {
  const routes = [
    "https://suno.com",
    "https://suno.com/create",
    "https://suno.com/library",
    "https://suno.com/me",
  ];

  for (const route of routes) {
    if (getCapturedToken() || page.isClosed()) return;
    console.log(`Opening ${route}...`);
    await page.goto(route, { waitUntil: "networkidle2" });
    if (route === "https://suno.com") {
      await logVisibleCookieNames(page, "https://suno.com");
      await logVisibleCookieNames(page, "https://auth.suno.com");
    }
    await sleep(3000);
  }
}

async function waitForBrowserConnection(
  port: number,
  getChromeExit: () => string | undefined,
): Promise<Browser> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 30000) {
    const chromeExit = getChromeExit();
    if (chromeExit) {
      throw new Error(`Chrome exited before DevTools became available: ${chromeExit}`);
    }

    try {
      return await puppeteer.connect({
        defaultViewport: null,
        browserURL: `http://127.0.0.1:${port}`,
      });
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Timed out waiting for Chrome DevTools at http://127.0.0.1:${port} (${message})`,
  );
}

async function launchLocalDebugBrowser(
  browserUrl?: string,
  options: BrowserLaunchOptions = {},
): Promise<Browser> {
  const port = getBrowserDebugPort(browserUrl);
  const launchPaths = resolveBrowserProfileLaunchPaths(
    options.userDataDir,
    options.profileDirectory,
  );
  assertRemoteDebuggableUserDataDir(launchPaths.userDataDir);
  forceCleanExit(launchPaths.preferencesDir);
  const executablePath = getPlatformChromeExecutablePath();
  if (!executablePath) {
    throw new Error(
      "Could not find a suitable Chrome/Chromium executable. Please install one or use --browser to connect to an existing instance.",
    );
  }
  await assertDebugPortAvailable(port);
  warnIfProfileRootLooksIncomplete(launchPaths);
  console.log(`Launching local browser with remote debug port ${port}...`);
  const args = [
    `--user-data-dir=${launchPaths.userDataDir}`,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (launchPaths.profileDirectory) {
    args.push(`--profile-directory=${launchPaths.profileDirectory}`);
  }

  console.log(`Using browser user data directory: ${launchPaths.userDataDir}`);
  if (launchPaths.profileDirectory) {
    console.log(`Using Chrome profile directory: ${launchPaths.profileDirectory}`);
  }
  try {
    let chromeExit: string | undefined;
    const child = spawn(executablePath, args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("exit", (code, signal) => {
      chromeExit = `code ${code ?? "null"}, signal ${signal ?? "null"}`;
    });
    child.unref();

    const browser = await waitForBrowserConnection(port, () => chromeExit);
    await warnIfChromeProfilePathDiffers(browser, launchPaths);
    return browser;
  } catch (error) {
    throw buildBrowserLaunchError(error, launchPaths.userDataDir);
  }
}

export async function connectOrLaunchBrowser(browserUrl?: string): Promise<{
  browser: Browser;
  isRemoteBrowser: boolean;
}>;
export async function connectOrLaunchBrowser(
  browserUrl?: string,
  options?: BrowserLaunchOptions,
): Promise<{
  browser: Browser;
  isRemoteBrowser: boolean;
}>;
export async function connectOrLaunchBrowser(
  browserUrl?: string,
  options?: BrowserLaunchOptions,
): Promise<{
  browser: Browser;
  isRemoteBrowser: boolean;
}> {
  if (options?.userDataDir) {
    const browser = await launchLocalDebugBrowser(browserUrl, options);
    return { browser, isRemoteBrowser: false };
  }

  if (browserUrl) {
    try {
      console.log(`Connecting to existing browser at ${browserUrl}...`);
      const browser = await puppeteer.connect({ browserURL: browserUrl });
      return { browser, isRemoteBrowser: true };
    } catch (error: any) {
      console.warn(
        `Browser session at ${browserUrl} is unavailable (${error?.message || error}). Falling back to local launch.`,
      );
      const browser = await launchLocalDebugBrowser(browserUrl, options);
      return { browser, isRemoteBrowser: false };
    }
  }

  const browser = await launchLocalDebugBrowser(undefined, options);
  return { browser, isRemoteBrowser: false };
}

export async function extractTokenFromBrowser(
  browserUrl?: string,
  options?: BrowserLaunchOptions,
): Promise<string> {
  const { browser, isRemoteBrowser } = await connectOrLaunchBrowser(
    browserUrl,
    options,
  );

  const page = await browser.newPage();

  let capturedToken: string | null = null;
  let loggedApiRequestCount = 0;

  const captureTokenFromHeaders = (
    url: string,
    headers: Record<string, unknown>,
    source: string,
  ): void => {
    if (!isSunoUrl(url)) return;

    const token = extractBearerTokenFromHeaders(headers);
    if (token) {
      capturedToken = token;
      console.log(`Token captured from ${source}!`);
      return;
    }

    if (loggedApiRequestCount < 12 && url.includes("api")) {
      loggedApiRequestCount += 1;
      console.log(`Saw Suno API request without bearer token: ${url}`);
    }
  };

  await page.setRequestInterception(true);

  page.on("request", (request: HTTPRequest) => {
    const url = request.url();
    captureTokenFromHeaders(url, request.headers(), "request interception");

    request.continue();
  });

  const cdpSession = await page.target().createCDPSession();
  await cdpSession.send("Network.enable");
  cdpSession.on("Network.requestWillBeSent", (event) => {
    captureTokenFromHeaders(
      event.request.url,
      event.request.headers as Record<string, unknown>,
      "Chrome network events",
    );
  });

  console.log("Please log in to Suno.com in the browser window...");
  console.log("Waiting for authentication token...");
  await visitSunoRoutesUntilToken(page, () => capturedToken);

  while (!capturedToken) {
    await sleep(1000);
    if (page.isClosed()) {
      throw new Error(
        "Browser page was closed before authentication token was captured",
      );
    }
  }

  console.log("Authentication complete! You can continue using the browser.");

  if (isRemoteBrowser) {
    await browser.disconnect();
  } else {
    registerBrowserForProcessExit(browser);
  }

  if (!capturedToken) {
    throw new Error("Failed to capture authentication token");
  }

  return capturedToken;
}
