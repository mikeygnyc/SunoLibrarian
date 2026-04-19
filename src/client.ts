import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Page } from 'puppeteer';
import type { IRateLimitConfig, ITrack, IWorkspace, ITrackMetadata } from './lib/interfaces';
import { Storage } from './storage';
import { connectOrLaunchBrowser } from './auth';

export class SunoClient {
  private authToken: string;
  private deviceId: string;
  private browserUrl?: string;
  private browserUserDataDir?: string;
  private browserProfileDirectory?: string;
  private rateLimitConfig: IRateLimitConfig;
  private metadataCache: Map<string, ITrackMetadata>;
  private storage: Storage;

  constructor(
    authToken: string,
    deviceId?: string,
    browserUrl?: string,
    browserUserDataDir?: string,
    browserProfileDirectory?: string,
  ) {
    this.authToken = authToken;
    this.browserUrl = browserUrl;
    this.browserUserDataDir = browserUserDataDir;
    this.browserProfileDirectory = browserProfileDirectory;
    this.storage = new Storage();
    this.deviceId = deviceId || this.storage.getDeviceId() || this.generateUUID();
    if (!deviceId) {
      this.storage.setDeviceId(this.deviceId);
    }
    this.rateLimitConfig = {
      baseDelay: 300,
      workspaceDelay: 500,
      trackDelay: 300,
      metadataDelay: 500,
      maxRetries: 5,
      initialBackoff: 2000,
      maxBackoff: 30000,
      backoffMultiplier: 2,
      rateLimitDetected: false,
    };
    this.metadataCache = new Map();
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private generateBrowserToken(): string {
    const timestamp = Date.now();
    const token = Buffer.from(JSON.stringify({ timestamp })).toString('base64');
    return JSON.stringify({ token });
  }

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    context: string = '',
    retryCount: number = 0
  ): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      const isRateLimit =
        error.message &&
        (error.message.includes('429') ||
          error.message.includes('Too many requests') ||
          error.status === 429);

      if (isRateLimit && retryCount < this.rateLimitConfig.maxRetries) {
        const backoffDelay = Math.min(
          this.rateLimitConfig.initialBackoff *
            Math.pow(this.rateLimitConfig.backoffMultiplier, retryCount),
          this.rateLimitConfig.maxBackoff
        );

        const jitter = Math.random() * 1000;
        const delay = backoffDelay + jitter;

        if (retryCount === 0) {
          this.notifyRateLimit(context);
          this.rateLimitConfig.baseDelay = Math.min(this.rateLimitConfig.baseDelay * 2, 2000);
          this.rateLimitConfig.workspaceDelay = Math.min(this.rateLimitConfig.workspaceDelay * 2, 5000);
          this.rateLimitConfig.trackDelay = Math.min(this.rateLimitConfig.trackDelay * 2, 2000);
          this.rateLimitConfig.metadataDelay = Math.min(this.rateLimitConfig.metadataDelay * 2, 3000);
          this.rateLimitConfig.rateLimitDetected = true;
        }

        console.warn(
          `Retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${this.rateLimitConfig.maxRetries})...`
        );

        await this.delay(delay);
        return this.retryWithBackoff(fn, context, retryCount + 1);
      }

      throw error;
    }
  }

  private async makeRequest(url: string, options: any = {}) {
    const browserToken = this.generateBrowserToken();

    const response = await fetch(url, {
      ...options,
      headers: {
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.8',
        authorization: `Bearer ${this.authToken}`,
        'browser-token': browserToken,
        'cache-control': 'no-cache',
        'device-id': this.deviceId,
        origin: 'https://suno.com',
        pragma: 'no-cache',
        referer: 'https://suno.com/',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error: any = new Error(`HTTP ${response.status}: ${await response.text()}`);
      error.status = response.status;
      throw error;
    }

    return response;
  }

  async fetchWorkspacesPage(page: number = 1): Promise<any> {
    return this.retryWithBackoff(async () => {
      const response = await this.makeRequest(
        `https://studio-api.prod.suno.com/api/project/me?page=${page}&sort=created_at&show_trashed=false`
      );
      return await response.json();
    }, `workspace page ${page}`);
  }

  async getWorkspaces(): Promise<IWorkspace[]> {
    const allWorkspaces: IWorkspace[] = [];
    let page = 1;
    let hasMore = true;
    const pageSize = 20;

    while (hasMore) {
      try {
        const data = await this.fetchWorkspacesPage(page);
        const projects = data.projects || [];
        const receivedCount = projects.length;

        if (receivedCount === 0) {
          hasMore = false;
        } else {
          allWorkspaces.push(...projects);

          if (data.has_more === true) {
            hasMore = true;
          } else if (data.has_more === false) {
            hasMore = false;
          } else if (data.total_pages !== undefined) {
            hasMore = page < data.total_pages;
          } else if (data.next_page !== null && data.next_page !== undefined) {
            hasMore = true;
          } else {
            hasMore = receivedCount >= pageSize;
          }

          if (hasMore) {
            await this.delay(this.rateLimitConfig.baseDelay);
            page++;
          } else {
            break;
          }
        }
      } catch (error: any) {
        if (page === 1) {
          throw error;
        }
        console.error(`Error fetching workspace page ${page}:`, error.message);
        break;
      }
    }

    return allWorkspaces;
  }

  async fetchTracks(
    cursor: string | null = null,
    limit: number = 100,
    workspaceId: string = 'default'
  ): Promise<any> {
    return this.retryWithBackoff(async () => {
      const response = await this.makeRequest(
        'https://studio-api.prod.suno.com/api/feed/v3',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            cursor: cursor,
            limit: limit,
            filters: {
              disliked: 'False',
              trashed: 'False',
              workspace: {
                presence: 'True',
                workspaceId: workspaceId,
              },
            },
          }),
        }
      );

      const data: any = await response.json();
      return data;
    }, `workspace ${workspaceId}`);
  }

  async getTracks(workspaceId: string = 'default'): Promise<ITrack[]> {
    const allTracks: ITrack[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const data = await this.fetchTracks(cursor, 100, workspaceId);
      const clips = data.clips || [];
      allTracks.push(...clips);

      hasMore = data.has_more === true || (clips.length === 100 && data.next_cursor);
      cursor = data.next_cursor;
      console.log(`Fetched ${clips.length} tracks for workspace ${workspaceId} (total so far: ${allTracks.length})`);
      if (hasMore) {
        await this.delay(this.rateLimitConfig.trackDelay);
      }
    }

    return allTracks;
  }

  async refreshWorkspaceTracks(workspaceId: string): Promise<ITrack[]> {
    const allTracks: ITrack[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      try {
        const response = await this.fetchTracks(cursor, 100, workspaceId);
        const clips = response.clips || [];
        allTracks.push(...clips);

        hasMore =
          response.has_more === true || (clips.length === 100 && response.next_cursor);
        cursor = response.next_cursor;

        if (hasMore) {
          await this.delay(this.rateLimitConfig.trackDelay);
        }
      } catch (error: any) {
        const isRateLimit =
          error.message &&
          (error.message.includes('429') ||
            error.message.includes('Too many requests') ||
            error.status === 429);

        if (isRateLimit) {
          console.error(
            `Rate limit error fetching tracks for workspace ${workspaceId}. Continuing with ${allTracks.length} tracks.`
          );
          break;
        } else {
          throw error;
        }
      }
    }

    return allTracks;
  }

  async fetchTrackMetadata(clipId: string, forceRefresh: boolean = false): Promise<ITrackMetadata> {
    if (!forceRefresh) {
      const cached = this.storage.getCachedMetadata(clipId);
      if (cached) {
        return cached;
      }

      if (this.metadataCache.has(clipId)) {
        return this.metadataCache.get(clipId)!;
      }
    }

    return this.retryWithBackoff(async () => {
      const response = await this.makeRequest(
        `https://studio-api.prod.suno.com/api/feed/?ids=${clipId}`
      );

      const data: any = await response.json();

      let track = null;
      if (Array.isArray(data)) {
        track = data[0] || data;
      } else if (data.clips && Array.isArray(data.clips)) {
        track = data.clips[0];
      } else if (data.id) {
        track = data;
      } else {
        track = data;
      }

      if (!track) {
        throw new Error('No track data found in API response');
      }

      const metadata: ITrackMetadata = {
        title: track.title || null,
        id: track.id || clipId,
        lyrics:
          track.metadata?.infill_lyrics ||
          track.lyrics ||
          track.metadata?.lyrics ||
          track.lyric ||
          track.metadata?.prompt ||
          null,
        bpm:
          track.bpm ||
          track.metadata?.bpm ||
          track.metadata?.tempo ||
          track.tempo ||
          null,
        key:
          track.key ||
          track.metadata?.key ||
          track.metadata?.musical_key ||
          track.musical_key ||
          null,
        prompt:
          track.metadata?.gpt_description_prompt ||
          track.metadata?.prompt ||
          track.prompt ||
          track.metadata?.tags ||
          null,
        coverArt: this.getPreferredCoverArt(track),
        duration: track.metadata?.duration || track.duration || null,
        tags: track.metadata?.tags || track.tags || null,
        genre: track.metadata?.genre || track.genre || null,
        artist:
          track.metadata?.artist || track.artist || track.display_name || null,
        fullData: track,
      };

      if (!metadata.title && metadata.lyrics && metadata.prompt === metadata.lyrics) {
        metadata.prompt = "";
        const lines = metadata.lyrics.split('\n');
        let titleText = '';
        for (const line of lines) {
          const cleaned = line.replace(/\[.*?\]|\(.*?\)/g, '').trim();
          if (cleaned && !line.match(/^\[.*\]$/)) {
            titleText = cleaned;
            break;
          }
        }
        metadata.title = titleText.substring(0, 100).trim() || 'Untitled';
      }
     
      this.metadataCache.set(clipId, metadata);
      this.storage.cacheMetadata(clipId, metadata);
      return metadata;
    }, `track metadata ${clipId}`);
  }

  async fetchAllTracksMetadata(
    trackIds: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<{ successCount: number; failedCount: number }> {
    let successCount = 0;
    let failedCount = 0;
    const total = trackIds.length;

    console.log(`Starting metadata fetch for ${total} tracks...`);

    for (let i = 0; i < total; i++) {
      const trackId = trackIds[i];
      try {
        const cached = this.storage.getCachedMetadata(trackId);
        if (!cached) {
          await this.fetchTrackMetadata(trackId);
          await this.delay(this.rateLimitConfig.metadataDelay);
        }
        successCount++;
      } catch (error) {
        console.error(`Failed to fetch metadata for ${trackId}:`, error);
        failedCount++;
      }

      if (onProgress) {
        onProgress(i + 1, total);
      }
    }

    console.log(`Metadata fetch complete. Success: ${successCount}, Failed: ${failedCount}`);
    return { successCount, failedCount };
  }

  async refreshAllWorkspaces(): Promise<IWorkspace[]> {
    const workspaces = await this.getWorkspaces();

    for (let i = 0; i < workspaces.length; i++) {
      const workspace = workspaces[i];
      try {
        const tracks = await this.refreshWorkspaceTracks(workspace.id);
        this.storage.cacheTracks(workspace.id, tracks);
        
        if (i < workspaces.length - 1) {
          await this.delay(this.rateLimitConfig.workspaceDelay);
        }
      } catch (error: any) {
        console.error(
          `Error refreshing workspace ${workspace.name || workspace.id}:`,
          error.message
        );
        if (i < workspaces.length - 1) {
          await this.delay(this.rateLimitConfig.workspaceDelay);
        }
      }
    }

    return workspaces;
  }

  getCachedTracks(workspaceId: string): { tracks: any[]; timestamp: number } | null {
    return this.storage.getCachedTracks(workspaceId);
  }

  getCacheTimestamp(workspaceId: string): number | null {
    return this.storage.getCacheTimestamp(workspaceId);
  }

  generateSidecarFile(metadata: ITrackMetadata, filename: string): string {
    const lines: string[] = [];
    lines.push(`Metadata for: ${filename}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('--- Track Information ---');

    if (metadata.title) lines.push(`Title: ${metadata.title}`);
    if (metadata.artist) lines.push(`Artist: ${metadata.artist}`);
    if (metadata.genre) lines.push(`Genre: ${metadata.genre}`);

    lines.push('');
    lines.push('--- Musical Information ---');
    if (metadata.bpm) lines.push(`BPM: ${metadata.bpm}`);
    if (metadata.key) lines.push(`Key: ${metadata.key}`);

    lines.push('');
    lines.push('--- Creation Details ---');
    if (metadata.prompt) lines.push(`Prompt: ${metadata.prompt}`);
    if (metadata.id) lines.push(`Track ID: ${metadata.id}`);

    lines.push('');
    if (metadata.lyrics) {
      lines.push('--- Lyrics ---');
      lines.push(metadata.lyrics);
    }

    if (metadata.coverArt) {
      lines.push('');
      lines.push(`Cover Art URL: ${metadata.coverArt}`);
    }

    if (metadata.fullData) {
      lines.push('');
      lines.push('--- Raw API Response ---');
      try {
        lines.push(JSON.stringify(metadata.fullData, null, 2));
      } catch (e) {
        lines.push('(Error serializing raw data)');
      }
    }

    return lines.join('\n');
  }

  async downloadMp3(url: string, filepath: string, clipId?: string, withMetadata: boolean = true): Promise<void> {
    if (withMetadata && clipId) {
      return this.downloadFileWithMetadataFromBillingEndpoint(clipId, filepath, 'mp3', url);
    }

    if (clipId) {
      try {
        await this.makeRequest(
          `https://studio-api.prod.suno.com/api/billing/clips/${clipId}/download/`,
          { method: 'POST' }
        );
      } catch (error) {
        console.warn('Billing endpoint call failed (non-critical)');
      }
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }

    const buffer = await response.buffer();
    fs.writeFileSync(filepath, buffer);
  }

  async downloadImage(imageUrl: string, filepath: string, clipId?: string): Promise<void> {
    try {
      await this.downloadImageFromUrl(imageUrl, filepath);
      return;
    } catch (error) {
      if (!clipId) {
        throw error;
      }
      const status = this.extractHttpStatus(error);
      const statusText = status ? `HTTP ${status}` : 'non-HTTP error';
      console.warn(`Image download failed for ${clipId} (${statusText}). Regenerating artwork from song page...`);
    }

    await this.regenerateArtworkForTrack(clipId);
    await this.delay(3000);
    const refreshed = await this.fetchTrackMetadata(clipId, true);
    const regeneratedCover = this.getPreferredCoverArt(refreshed.fullData || refreshed);
    if (!regeneratedCover) {
      throw new Error(`Artwork regeneration finished but no cover URL was found for ${clipId}`);
    }

    await this.downloadImageFromUrl(regeneratedCover, filepath);
  }

  private async downloadImageFromUrl(imageUrl: string, filepath: string): Promise<void> {
    const tempPath = `${filepath}.tmp`;
    
    return new Promise((resolve, reject) => {
      const https = require('https');
      const file = fs.createWriteStream(tempPath);
      
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://suno.com/',
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'cross-site'
        }
      };
      
      https.get(imageUrl, options, (response: any) => {
        if (response.statusCode !== 200) {
          file.close();
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          fs.renameSync(tempPath, filepath);
          resolve();
        });
        file.on('error', (err: any) => {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          reject(err);
        });
      }).on('error', (err: any) => {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        reject(err);
      });
    });
  }

  private extractHttpStatus(error: unknown): number | null {
    if (!(error instanceof Error)) return null;
    const match = error.message.match(/HTTP\s+(\d{3})/i);
    if (!match) return null;
    return Number(match[1]);
  }

  private getPreferredCoverArt(track: any): string | null {
    if (!track) return null;
    return (
      track.image_large_url ||
      track.metadata?.image_large_url ||
      track.image_url ||
      track.cover_url ||
      track.metadata?.image_url ||
      track.metadata?.cover_url ||
      track.image ||
      track.cover_image ||
      null
    );
  }

  private async regenerateArtworkForTrack(clipId: string): Promise<void> {
    const songUrl = `https://suno.com/song/${clipId}`;
    console.log(`[artwork] Opening song page for ${clipId}: ${songUrl}`);
    const { browser, isRemoteBrowser } = await connectOrLaunchBrowser(this.browserUrl, {
      userDataDir: this.browserUserDataDir,
      profileDirectory: this.browserProfileDirectory,
    });
    let page: Page | null = null;

    try {
      page = await browser.newPage();
      await page.setDefaultTimeout(20000);
      await page.goto(songUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      console.log(`[artwork] Loaded song page for ${clipId}`);

      console.log(`[artwork] Opening Edit Song Details for ${clipId}`);
      const clickedEdit =
        (await this.clickSelectorIfPresent(page, 'button[aria-label="Edit Song Details"]', 12000)) ||
        (await this.clickElementContainingText(page, ['edit song details'], 12000));

      if (!clickedEdit) {
        console.log(`[artwork] Failed to open Edit Song Details for ${clipId}`);
        throw new Error('Could not open song details editor');
      }
      console.log(`[artwork] Edit Song Details opened for ${clipId}`);

      console.log(`[artwork] Clicking Generate Cover Art for ${clipId}`);
      const clickedGenerate =
        (await this.clickAnySelector(
          page,
          [
            'button[aria-label="Generate Cover Art"]',
            'div.min-w-40 > div.flex > button:nth-of-type(1)',
            'div.min-w-40 button:nth-of-type(1)',
          ],
          15000
        )) ||
        (await this.clickElementContainingText(page, ['generate cover art', 'generate cover'], 15000));
      if (!clickedGenerate) {
        console.log(`[artwork] Failed to click Generate Cover Art for ${clipId}`);
        throw new Error('Could not find "Generate Cover" action');
      }
      console.log(`[artwork] Generate Cover Art clicked for ${clipId}`);

      console.log(`[artwork] Selecting Text to Image mode for ${clipId}`);
      await this.clickElementContainingText(page, ['text to image'], 5000);

      console.log(`[artwork] Clicking prompt Generate button for ${clipId}`);
      const clickedPromptGenerate =
        (await this.clickAnySelector(
          page,
          [
            '[role="dialog"] button[aria-label="Generate"]',
            'button[aria-label="Generate"]',
          ],
          15000
        )) ||
        (await this.clickDialogButtonByText(page, ['generate'], ['cover'], 15000));
      if (!clickedPromptGenerate) {
        console.log(`[artwork] Failed to click prompt Generate for ${clipId}`);
        throw new Error('Could not click prompt Generate button');
      }
      console.log(`[artwork] Waiting for text Generate button to appear for ${clipId}`);
      const generateTextAppeared = await this.waitForDialogExactTextButton(page, 'generate', 30000);
      if (!generateTextAppeared) {
        console.log(`[artwork] Text Generate button did not appear for ${clipId}`);
        throw new Error('Timed out waiting for text Generate button');
      }

      console.log(`[artwork] Clicking image Generate button for ${clipId}`);
      const clickedImageGenerate = await this.clickDialogExactTextButton(page, 'generate', 45000);
      if (!clickedImageGenerate) {
        console.log(`[artwork] Failed to click image Generate for ${clipId}`);
        throw new Error('Could not click image Generate button');
      }

      console.log(`[artwork] Waiting for generated images for ${clipId}`);
      const imagesReady = await this.waitForVisibleSelector(page, '[role="dialog"] article', 45000);
      if (!imagesReady) {
        console.log(`[artwork] Generated images did not appear for ${clipId}`);
        throw new Error('Timed out waiting for generated images');
      }
      console.log(`[artwork] Selecting first generated option for ${clipId}`);
      await this.clickSelectorIfPresent(page, '[role="dialog"] article', 5000);

      console.log(`[artwork] Saving generated image cover for ${clipId}`);
      const clickedSave = await this.clickElementContainingText(
        page,
        ['save as image cover', 'save as image'],
        30000
      );
      if (!clickedSave) {
        console.log(`[artwork] Failed to save generated image cover for ${clipId}`);
        throw new Error('Could not save generated cover artwork');
      }
      console.log(`[artwork] Save as Image clicked for ${clipId}`);

      await this.delay(4000);
      console.log(`[artwork] Artwork regeneration finished for ${clipId}`);
    } finally {
      if (page) {
        try {
          await page.close({ runBeforeUnload: false });
          console.log(`[artwork] Closed song page tab for ${clipId}`);
        } catch {
          // no-op
        }
      }
      if (isRemoteBrowser) {
        await browser.disconnect();
      } else {
        await browser.close();
      }
    }
  }

  private async clickSelectorIfPresent(
    page: Page,
    selector: string,
    timeoutMs: number
  ): Promise<boolean> {
    try {
      await page.waitForSelector(selector, { visible: true, timeout: timeoutMs });
      await page.click(selector);
      return true;
    } catch {
      return false;
    }
  }

  private async clickAnySelector(
    page: Page,
    selectors: string[],
    timeoutMs: number
  ): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      for (const selector of selectors) {
        const elements = await page.$$(selector);
        for (const el of elements) {
          const visible = await el.isVisible().catch(() => false);
          if (!visible) continue;
          try {
            await el.evaluate((node: any) => node.scrollIntoView({ block: 'center', inline: 'center' }));
            await el.click({ delay: 30 });
            return true;
          } catch {
            continue;
          }
        }
      }
      await this.delay(250);
    }
    return false;
  }

  private async clickElementContainingText(
    page: Page,
    textCandidates: string[],
    timeoutMs: number
  ): Promise<boolean> {
    const needles = textCandidates.map((text) => text.toLowerCase());
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const candidates = await page.$$('button, [role="button"], a');
      for (const el of candidates) {
        const text = await el.evaluate((node: any) => ((node.textContent || '') as string).trim().toLowerCase());
        if (!text) continue;
        if (!needles.some((term) => text.includes(term))) continue;
        const visible = await el.isVisible().catch(() => false);
        if (!visible) continue;
        try {
          await el.evaluate((node: any) => node.scrollIntoView({ block: 'center', inline: 'center' }));
          await el.click({ delay: 30 });
          return true;
        } catch {
          continue;
        }
      }

      await this.delay(250);
    }

    return false;
  }

  private async clickDialogButtonByText(
    page: Page,
    includeTerms: string[],
    excludeTerms: string[],
    timeoutMs: number
  ): Promise<boolean> {
    const include = includeTerms.map((t) => t.toLowerCase());
    const exclude = excludeTerms.map((t) => t.toLowerCase());
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const candidates = await page.$$('[role="dialog"] button, [role="dialog"] [role="button"]');
      for (const el of candidates) {
        const text = await el.evaluate((node: any) => ((node.textContent || '') as string).trim().toLowerCase());
        if (!text) continue;
        if (!include.every((term) => text.includes(term))) continue;
        if (exclude.some((term) => text.includes(term))) continue;
        const visible = await el.isVisible().catch(() => false);
        if (!visible) continue;
        try {
          await el.evaluate((node: any) => node.scrollIntoView({ block: 'center', inline: 'center' }));
          await el.click({ delay: 30 });
          return true;
        } catch {
          continue;
        }
      }

      await this.delay(250);
    }

    return false;
  }

  private async clickDialogExactTextButton(
    page: Page,
    exactText: string,
    timeoutMs: number
  ): Promise<boolean> {
    const needle = exactText.trim().toLowerCase();
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const clicked = await page.evaluate((expected) => {
        const d: any = (globalThis as any).document;
        const w: any = (globalThis as any).window;
        const dialog = d?.querySelector?.('[role="dialog"]');
        if (!dialog) return false;

        const nodes = Array.from(dialog.querySelectorAll('button, [role="button"]')) as any[];
        for (const node of nodes) {
          const text = (node.textContent || '').trim().toLowerCase();
          if (text !== expected) continue;
          const el: any = node;
          const disabled =
            Boolean(el.disabled) ||
            el.getAttribute('aria-disabled') === 'true' ||
            el.getAttribute('disabled') !== null;
          if (disabled) continue;

          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const style = w.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;

          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.click();
          return true;
        }
        return false;
      }, needle);

      if (clicked) return true;
      await this.delay(250);
    }

    return false;
  }

  private async waitForDialogExactTextButton(
    page: Page,
    exactText: string,
    timeoutMs: number
  ): Promise<boolean> {
    const needle = exactText.trim().toLowerCase();
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const existsAndEnabled = await page.evaluate((expected) => {
        const d: any = (globalThis as any).document;
        const w: any = (globalThis as any).window;
        const dialog = d?.querySelector?.('[role="dialog"]');
        if (!dialog) return false;

        const nodes = Array.from(dialog.querySelectorAll('button, [role="button"]')) as any[];
        for (const node of nodes) {
          const text = (node.textContent || '').trim().toLowerCase();
          if (text !== expected) continue;
          const disabled =
            Boolean(node.disabled) ||
            node.getAttribute('aria-disabled') === 'true' ||
            node.getAttribute('disabled') !== null;
          if (disabled) continue;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const style = w.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          return true;
        }
        return false;
      }, needle);

      if (existsAndEnabled) return true;
      await this.delay(250);
    }

    return false;
  }

  private async waitForVisibleSelector(
    page: Page,
    selector: string,
    timeoutMs: number
  ): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const elements = await page.$$(selector);
      for (const el of elements) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) return true;
      }
      await this.delay(250);
    }
    return false;
  }

  async initiateWavConversion(clipId: string): Promise<void> {
    const response = await this.makeRequest(
      `https://studio-api.prod.suno.com/api/gen/${clipId}/convert_wav/`,
      { method: 'POST' }
    );

    if (response.status !== 204 && !response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
  }

  async pollWavFile(clipId: string, maxAttempts: number = 60, interval: number = 2000): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.makeRequest(
          `https://studio-api.prod.suno.com/api/gen/${clipId}/wav_file/`
        );

        const data: any = await response.json();
        if (data.wav_file_url) {
          return data.wav_file_url;
        }
      } catch (error: any) {
        if (error.message && error.message.includes('404')) {
          await this.delay(interval);
          continue;
        }
        throw error;
      }

      await this.delay(interval);
    }

    throw new Error(`WAV conversion timeout after ${maxAttempts} attempts`);
  }

  async downloadWav(clipId: string, filepath: string, withMetadata: boolean = true): Promise<void> {
    await this.initiateWavConversion(clipId);
    const wavUrl = await this.pollWavFile(clipId);

    if (withMetadata) {
      return this.downloadFileWithMetadataFromBillingEndpoint(clipId, filepath, 'wav', wavUrl);
    }

    const response = await fetch(wavUrl);
    if (!response.ok) {
      throw new Error(`Failed to download WAV: ${response.status}`);
    }

    const buffer = await response.buffer();
    fs.writeFileSync(filepath, buffer);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private notifyRateLimit(context?: string): void {
    const message = context
      ? `Rate limit detected while fetching ${context}. Increasing delays and retrying...`
      : 'Rate limit detected. Increasing delays between requests and retrying...';
    console.warn(message);
  }

  async downloadFileWithMetadataFromBillingEndpoint(
    clipId: string,
    filename: string,
    format: string = 'mp3',
    url: string | null = null
  ): Promise<void> {
    try {
      let audioUrl = url;

      if (!audioUrl && format === 'mp3') {
        try {
          await this.makeRequest(
            `https://studio-api.prod.suno.com/api/billing/clips/${clipId}/download/`,
            { method: 'POST' }
          );
        } catch (error) {
          console.warn('Billing endpoint call failed (non-critical):', error);
        }
      }

      const trackMetadata = await this.fetchTrackMetadata(clipId);

      if (!audioUrl) {
        audioUrl =
          trackMetadata.fullData?.audio_url || `https://cdn1.suno.ai/${clipId}.mp3`;
      }

      console.log(`Fetching audio from: ${audioUrl}`);
      const audioResponse = await fetch(audioUrl!);
      if (!audioResponse.ok) {
        throw new Error(`Failed to fetch audio file: ${audioResponse.status}`);
      }

      const buffer = await audioResponse.buffer();
      fs.writeFileSync(filename, buffer);

      const metadata = this.extractMetadataFromTrack(trackMetadata.fullData || trackMetadata);

      if (trackMetadata && Object.keys(metadata).length > 0) {
        const sidecarFilename = filename + '.txt';
        const sidecarContent = this.generateSidecarFile(metadata, path.basename(filename));
        fs.writeFileSync(sidecarFilename, sidecarContent);
      }
    } catch (error) {
      console.error('Error downloading with metadata:', error);
      throw error;
    }
  }

  private extractMetadataFromTrack(trackData: any): any {
    const metadata: any = {
      title: trackData.title || null,
      artist:
        trackData.metadata?.artist ||
        trackData.artist ||
        trackData.display_name ||
        'Suno AI' ||
        null,
      album: trackData.metadata?.album || trackData.album || null,
      genre: trackData.metadata?.genre || trackData.genre || null,
      year: trackData.created_at ? new Date(trackData.created_at).getFullYear() : null,
      lyrics:
        trackData.metadata?.infill_lyrics ||
        trackData.lyrics ||
        trackData.metadata?.lyrics ||
        trackData.lyric ||
        trackData.metadata?.prompt ||
        null,
      bpm:
        trackData.bpm ||
        trackData.metadata?.bpm ||
        trackData.metadata?.tempo ||
        trackData.tempo ||
        null,
      key:
        trackData.key ||
        trackData.metadata?.key ||
        trackData.metadata?.musical_key ||
        trackData.musical_key ||
        null,
      comment:
        trackData.metadata?.tags ||
        trackData.metadata?.gpt_description_prompt ||
        trackData.metadata?.prompt ||
        trackData.prompt ||
        null,
      coverArt: this.getPreferredCoverArt(trackData),
      trackNumber: null,
      albumArtist: 'Suno AI',
      fullData: trackData,
    };

    Object.keys(metadata).forEach((key) => {
      if (metadata[key] === null) {
        delete metadata[key];
      }
    });

    return metadata;
  }

  async downloadBlobAsDataUrl(
    audioBuffer: Buffer,
    filename: string,
    clipId: string,
    format: string,
    trackMetadata: ITrackMetadata | null = null,
    metadata: any = {}
  ): Promise<void> {
    const fileSize = audioBuffer.length;
    const maxDataUrlSize = 2 * 1024 * 1024;

    let downloadUrl: string;
    if (fileSize <= maxDataUrlSize) {
      try {
        const base64 = audioBuffer.toString('base64');
        const mimeType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
        downloadUrl = `data:${mimeType};base64,${base64}`;
      } catch (error) {
        console.warn('Failed to create data URL, using original URL:', error);
        if (!trackMetadata && clipId) {
          trackMetadata = await this.fetchTrackMetadata(clipId);
        }
        downloadUrl =
          trackMetadata?.fullData?.audio_url || `https://cdn1.suno.ai/${clipId}.mp3`;
      }
    } else {
      console.warn(`File too large (${fileSize} bytes) for data URL, using original URL.`);
      if (!trackMetadata && clipId) {
        trackMetadata = await this.fetchTrackMetadata(clipId);
      }
      downloadUrl =
        trackMetadata?.fullData?.audio_url || `https://cdn1.suno.ai/${clipId}.mp3`;
    }

    return this.downloadFromUrl(downloadUrl, filename, clipId, format, trackMetadata, metadata);
  }

  async downloadFromUrl(
    downloadUrl: string,
    filename: string,
    clipId: string,
    format: string,
    trackMetadata: ITrackMetadata | null = null,
    metadata: any = {}
  ): Promise<void> {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download from URL: ${response.status}`);
    }

    const buffer = await response.buffer();
    fs.writeFileSync(filename, buffer);

    if (trackMetadata && Object.keys(metadata).length > 0) {
      const sidecarFilename = filename + '.txt';
      const sidecarContent = this.generateSidecarFile(metadata, path.basename(filename));
      fs.writeFileSync(sidecarFilename, sidecarContent);
    }
  }

  async downloadFileWithMetadata(
    url: string,
    filename: string,
    clipId: string | null = null,
    format: string = 'mp3'
  ): Promise<void> {
    try {
      if (clipId) {
        try {
          return await this.downloadFileWithMetadataFromBillingEndpoint(
            clipId,
            filename,
            format,
            url
          );
        } catch (error) {
          console.warn('Metadata embedding failed, falling back to direct download:', error);
        }
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.status}`);
      }

      const buffer = await response.buffer();
      fs.writeFileSync(filename, buffer);
    } catch (error) {
      throw error;
    }
  }
}
