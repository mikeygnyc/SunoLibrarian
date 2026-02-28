import puppeteer from 'puppeteer';

export async function extractTokenFromBrowser(browserUrl?: string): Promise<string> {
  console.log(browserUrl ? 'Connecting to existing browser...' : 'Launching browser...');
  const isRemoteBrowser = Boolean(browserUrl);
  const browser = browserUrl
    ? await puppeteer.connect({ browserURL: browserUrl })
    : await puppeteer.launch({
        headless: false,
        defaultViewport: null,
      });

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
    
    if (page.url().includes('suno.com') && !capturedToken) {
      try {
        await page.goto('https://suno.com/?wid=default', { 
          waitUntil: 'networkidle2',
          timeout: 5000 
        });
      } catch (error) {
        // Continue waiting
      }
    }
  }

  console.log('Authentication complete! You can continue using the browser.');

  if (isRemoteBrowser) {
    await browser.disconnect();
  } else {
    await browser.close();
  }

  if (!capturedToken) {
    throw new Error('Failed to capture authentication token');
  }

  return capturedToken;
}
