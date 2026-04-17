import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import puppeteer, { type Browser } from 'puppeteer';

const browsersToCloseOnExit = new Set<Browser>();
let browserExitHooksRegistered = false;

export type BrowserLaunchOptions = {
  userDataDir?: string;
};

const CHROME_PROFILE_COPY_SKIP_NAMES = new Set([
  'BrowserMetrics',
  'Cache',
  'Code Cache',
  'Crash Reports',
  'Crashpad',
  'DawnCache',
  'DevToolsActivePort',
  'GrShaderCache',
  'GPUCache',
  'Media Cache',
  'ShaderCache',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
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

  process.once('beforeExit', () => {
    void closeTrackedBrowsers();
  });
  process.once('SIGINT', () => {
    void closeTrackedBrowsers().finally(() => process.exit(130));
  });
  process.once('SIGTERM', () => {
    void closeTrackedBrowsers().finally(() => process.exit(143));
  });
}

function getBrowserDebugPort(browserUrl?: string): number {
  if (!browserUrl) return 9222;
  try {
    const parsed = new URL(browserUrl);
    const port = Number(parsed.port || '9222');
    return Number.isFinite(port) && port > 0 ? port : 9222;
  } catch {
    return 9222;
  }
}

function getPlatformChromeExecutablePath(): string | undefined {
  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else if (process.platform === 'linux') {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    );
  } else if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
    );
  }

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getDefaultChromeUserDataDir(): string | undefined {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  }

  if (process.platform === 'linux') {
    return path.join(os.homedir(), '.config/google-chrome');
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData ? path.join(localAppData, 'Google/Chrome/User Data') : undefined;
  }

  return undefined;
}

function isSamePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === 'win32'
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
      `Chrome remote debugging cannot use the default Chrome profile directory: ${userDataDir}`,
      "Chrome 136+ ignores --remote-debugging-port for the default data directory, even when Chrome is closed.",
      "Use a dedicated profile directory instead, for example:",
      `  --browser-profile "${path.join(os.homedir(), '.suno-export/chrome-profile')}"`,
      "Or launch Chrome yourself with a non-default --user-data-dir and connect with --browser http://localhost:9222.",
    ].join("\n"),
  );
}

function shouldSkipProfileCopyEntry(sourcePath: string): boolean {
  return CHROME_PROFILE_COPY_SKIP_NAMES.has(path.basename(sourcePath));
}

function copyChromeProfileEntry(sourcePath: string, targetPath: string): void {
  if (shouldSkipProfileCopyEntry(sourcePath)) return;

  const stat = fs.lstatSync(sourcePath);
  if (stat.isSymbolicLink()) {
    try {
      fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
    } catch {
      // Chrome lock symlinks and other volatile entries can disappear during copy.
    }
    return;
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      copyChromeProfileEntry(path.join(sourcePath, entry), path.join(targetPath, entry));
    }
    return;
  }

  if (!stat.isFile()) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  try {
    fs.copyFileSync(sourcePath, targetPath);
  } catch {
    // Ignore volatile files that Chrome or the OS removes while the clone is being prepared.
  }
}

function cloneChromeUserDataDir(sourceUserDataDir: string): string {
  const source = path.resolve(sourceUserDataDir);
  if (!fs.existsSync(source)) {
    throw new Error(`Chrome profile directory does not exist: ${source}`);
  }

  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-export-chrome-'));
  console.log(`Copying Chrome profile from ${source} to ${target}...`);
  copyChromeProfileEntry(source, target);
  return target;
}

function resolveLaunchUserDataDir(userDataDir?: string): string {
  if (!userDataDir) {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'suno-export-chrome-'));
  }

  const sourceUserDataDir = path.resolve(userDataDir);
  const defaultChromeUserDataDir = getDefaultChromeUserDataDir();
  if (defaultChromeUserDataDir && isSamePath(sourceUserDataDir, defaultChromeUserDataDir)) {
    return cloneChromeUserDataDir(sourceUserDataDir);
  }

  fs.mkdirSync(sourceUserDataDir, { recursive: true });
  return sourceUserDataDir;
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

async function launchLocalDebugBrowser(
  browserUrl?: string,
  options: BrowserLaunchOptions = {},
): Promise<Browser> {
  const port = getBrowserDebugPort(browserUrl);
  const userDataDir = resolveLaunchUserDataDir(options.userDataDir);
  const executablePath = getPlatformChromeExecutablePath();

  assertRemoteDebuggableUserDataDir(userDataDir);

  console.log(`Launching local browser with remote debug port ${port}...`);
  console.log(`Using browser profile directory: ${userDataDir}`);
  try {
    return await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      executablePath,
      userDataDir,
      args: [
        `--remote-debugging-port=${port}`,
      ],
    });
  } catch (error) {
    throw buildBrowserLaunchError(error, userDataDir);
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
  const { browser, isRemoteBrowser } = await connectOrLaunchBrowser(browserUrl, options);

  const page = await browser.newPage();

  let capturedToken: string | null = null;

  await page.setRequestInterception(true);
  
  page.on('request', (request) => {
    const url = request.url();
    const headers = request.headers();

    if (url.includes('studio-api.prod.suno.com') && headers['authorization']) {
      const authHeader = headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        capturedToken = authHeader.replace('Bearer ', '').trim();
        console.log('Token captured!');
      }
    }

    request.continue();
  });

  console.log('Please log in to Suno.com in the browser window...');
  await page.goto('https://suno.com', { waitUntil: 'networkidle2' });

  console.log('Waiting for authentication token...');
  
  while (!capturedToken) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (page.isClosed()) {
      throw new Error('Browser page was closed before authentication token was captured');
    }
  }

  console.log('Authentication complete! You can continue using the browser.');

  if (isRemoteBrowser) {
    await browser.disconnect();
  } else {
    registerBrowserForProcessExit(browser);
  }

  if (!capturedToken) {
    throw new Error('Failed to capture authentication token');
  }

  return capturedToken;
}
