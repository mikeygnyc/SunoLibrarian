import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import puppeteer, { type Browser } from 'puppeteer';

const browsersToCloseOnExit = new Set<Browser>();
let browserExitHooksRegistered = false;

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

async function launchLocalDebugBrowser(browserUrl?: string): Promise<Browser> {
  const port = getBrowserDebugPort(browserUrl);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-export-chrome-'));
  const executablePath = getPlatformChromeExecutablePath();

  console.log(`Launching local browser with remote debug port ${port}...`);
  return puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath,
    args: [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
    ],
  });
}

export async function connectOrLaunchBrowser(browserUrl?: string): Promise<{
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
      const browser = await launchLocalDebugBrowser(browserUrl);
      return { browser, isRemoteBrowser: false };
    }
  }

  const browser = await launchLocalDebugBrowser();
  return { browser, isRemoteBrowser: false };
}

export async function extractTokenFromBrowser(browserUrl?: string): Promise<string> {
  const { browser, isRemoteBrowser } = await connectOrLaunchBrowser(browserUrl);

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
