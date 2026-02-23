import * as path from "path";
import * as fs from "fs";
import * as puppeteer from "puppeteer";
import { AppConfig } from "./ConfigHandler.js";
import { ISongData } from "./ISongData.js";
import { MetadataProcessor } from "./MetadataHandler.js";
import * as readlinePs from "readline/promises";
import { GlobalPageMethods } from "./pagemethods.js";
import { Converter } from "./FileHandler.js";
export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));
export class Scraper {
  constructor() {}
  page!: puppeteer.Page;
  async Initialize() {
    const tmpDir = path.parse(AppConfig.chromeTempUserDataDirPath).dir;
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    if (!this.browser) {
      console.log("Connecting to the browser...");
      this.browser = await puppeteer.launch({
        headless: false, // Set to true for headless mode, false for visible browser
        executablePath: AppConfig.chromeExecutablePath,
        args: ["--remote-debugging-port=9222", `--user-data-dir=${tmpDir}`],
        defaultViewport: {
          width: 1280,
          height: 720,
        },
        timeout: 60000,
      });

      this.page = await this.browser.newPage();
      await this.page.goto("https://suno.com/me");
    } else {
      let pgTmp = (await this.browser.pages()).find((p) =>
        p.url().includes("suno.com")
      );
      if (pgTmp) {
        this.page = pgTmp;
      } else {
        this.page = await this.browser.newPage();
        await this.page.goto("https://suno.com/me");
      }
    }
    if (!this.page) {
      console.error("Could not find the target this.page.");
      throw new Error("Could not find the target this.page.");
    } else {
      console.log("Scraper initialized");
    }
    this.page.on("framenavigated", (frame: puppeteer.Frame) => {
      const url = frame.url(); // the new url
      if (url.includes("suno") && url.includes("song")) {
        console.log(url);
        this.page.goBack();
      }

      // do something here...
    });
  }

  browser!: puppeteer.Browser;
  session!: puppeteer.CDPSession;
  async scrapeAndDownload() {
    try {
      await this.sessionStarter();
      console.log(`Successfully connected to page: ${this.page.url()}`);
      if (this.page.url().includes("accounts.suno.com")) {
        const rl = readlinePs.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        await rl.question(
          "Login required. Please login on chrome and press enter when logged in "
        );
        rl.close();
        await this.page.goto("https://suno.com/me");
        console.log(`Successfully connected to page: ${this.page.url()}`);
      }
      await this.getDataFromPage(this.session);
      console.log("Scrape and download process completed.");
    } catch (error) {
      console.error("A critical error occurred:", error);
    } finally {
      if (this.browser) {
        await this.browser.disconnect();
        console.log("Disconnected from the browser.");
      }
    }
  }
  currentScrollContainer!: puppeteer.ElementHandle<Element>;
  async findScrollContainer() {
    const scrollContainerSelector = 'div[id*="tabpanel-songs"]';
    await this.page.waitForSelector(scrollContainerSelector, {
      timeout: 40000,
    });
    //@ts-ignore
    const scrollContainers = await this.page.$$<HTMLDivElement>(
      scrollContainerSelector
    );
    const scrollContainer = scrollContainers?.[1];
    if (!scrollContainer)
      throw new Error("Could not find the song list's scrollable container.");
    console.log("Successfully identified the nested scroll container.");
    this.currentScrollContainer = scrollContainer;
    return;
  }

  async sessionStarter() {
    this.session = await this.browser.target().createCDPSession();
    await this.session.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: AppConfig.downloadRootDirectoryPath,
      eventsEnabled: true,
    });
    this.session.removeAllListeners("Browser.downloadWillBegin");
    this.session.removeAllListeners("Browser.downloadProgress");
    this.session.on("Browser.downloadWillBegin", (event) => {
      console.log(
        `    -> Download will begin for browser guid ${event.guid} - ${event.suggestedFilename} from ${event.url}`
      );
    });

    // Listen for downloadProgress event
    this.session.on("Browser.downloadProgress", (event) => {
      if (event.state === "completed") {
        console.log(`    -> Download completed for browser guid ${event.guid}`);
      } else if (event.state === "canceled") {
        console.log(`    -> Download canceled for browser guid  ${event.guid}`);
      }
    });
    return this.session;
  }

  async getDataFromPage(session: puppeteer.CDPSession) {
    // --- LOAD AND PREPARE DATA ---
    console.log("Starting data loading...");
    MetadataProcessor.loadMainMetadataFile();

    // Scrape page for all songs to discover new ones

    while (true) {
      await this.discoverSongs();
      const songsToProcess = await this.buildProcessingQueue();
      await this.processSongs(songsToProcess);
      console.log("--- All songs have been processed on this this.page. ---");

      if (songsToProcess.length === 0) {
        if (this.rowsProcessed === 0) {
          console.log("No rows processed. Reattempting browser connection");
          this.pagesSearched = 0;
          await this.scrapeAndDownload();
          return;
        } else {
          if (!this.morePagesAvailable) {
            console.log(
              "All discovered songs have already been downloaded. Exiting."
            );
            return;
          }
        }
      }
    }
  }
  private async buildProcessingQueue(): Promise<ISongData[]> {
    // Create a queue of previously processed songs that need loading/downloading
    const songsToProcess = Array.from(
      MetadataProcessor.allSongs.values()
    ).filter(
      (song) =>
        (AppConfig.useSunoMp3FileIfAvailable &&
          AppConfig.audioFormats.includes("mp3") &&
          song.mp3Status !== "DOWNLOADED" &&
          song.mp3Status !== "CREATED") ||
        song.wavStatus !== "DOWNLOADED"
    );

    console.log(
      `Total songs: ${MetadataProcessor.allSongs.size}. Songs to process: ${songsToProcess.length}.`
    );
    MetadataProcessor.saveMainMetadataFile(); // Save the merged list right away
    return songsToProcess;
  }
  processSongCount: number = 0;
  private async processSongs(songsToProcess: ISongData[]) {
    for (const [index, song] of songsToProcess.entries()) {
      console.log(
        `\n--- [${index + 1}/${songsToProcess.length}] Processing: ${
          song.title
        } (${song.clipId}) ---`
      );
      const songObject = MetadataProcessor.allSongs.get(song.clipId)!;
      if (song.wavStatus==="FAILED" || song.wavStatus==="SKIPPED"){
        //back up one page before searching.
        await GlobalPageMethods.paginationOps(this.page,false,false);
      }
      const songRow = await GlobalPageMethods.scrollSongIntoView(
        this.page,
        songObject.clipId
      );
      if (!songRow) {
        console.error(
          `Skipping "${songObject.title}" as it could not be scrolled into view.`
        );
        songObject.mp3Status = "SKIPPED";
        songObject.wavStatus = "SKIPPED";
        songObject.flacStatus = "SKIPPED";
        songObject.alacStatus = "SKIPPED";
        MetadataProcessor.saveMainMetadataFile();
        continue;
      }

      // --- MP3 Download ---
      await this.downloadMp3(songObject);
      // --- WAV Download ---
      await this.downloadWav(songObject);
      MetadataProcessor.saveMainMetadataFile();
      this.processSongCount++;
      console.log(
        `--- Finished processing ${this.processSongCount} ${songObject.clipId} "${songObject.title}". Pausing... ---`
      );
    }
    return;
  }

  private async downloadWav(songObject: ISongData) {
    //don't do it if only mp3 is selected and use suno if available is selected
    let proceed: boolean = false;
    if (AppConfig.audioFormats.length > 1) {
      proceed = true;
    } else {
      if (AppConfig.audioFormats.includes("mp3")) {
        if (!AppConfig.useSunoMp3FileIfAvailable) {
          proceed = true;
        }
      } else {
        proceed = true;
      }
    }
    if (!proceed) {
      return;
    }
    if (songObject.wavStatus !== "DOWNLOADED") {
      try {
        console.log("  -> Downloading WAV...");
        const checkForExistDialog =
          "xpath///span[contains(text(), 'Download WAV Audio')]";
        let existDialog = await this.page.$(checkForExistDialog);
        if (existDialog) {
          const findModalCloseSearch =
            'button[aria-label="Close"]:not(.chakra-popover__close-btn)';
          let modalClose = await this.page.$(findModalCloseSearch);
          if (modalClose) {
            modalClose.click();
            console.log(`Closing stuck modal`);
          }
        }

        await GlobalPageMethods.scrollSongIntoView(
          this.page,
          songObject.clipId
        ); // Re-center element
        await this.page.keyboard.press("Escape");
        await delay(200);

        if (
          !(await GlobalPageMethods.clickVisibleMoreButton(
            this.page,
            songObject.clipId
          ))
        )
          throw new Error("More button not clickable for WAV");

        const downloadMenuItemWav = await this.page.waitForSelector(
          "xpath///button[.//span[text()='Download']]",
          { visible: true, timeout: 10000 }
        );
        if (downloadMenuItemWav) {
          await downloadMenuItemWav.hover();
        } else {
          throw `Could not find download download menu item - wav for ${songObject.clipId}`;
        }

        const wavButton = await this.page.waitForSelector(
          'button[aria-label="WAV Audio"]',
          { visible: true, timeout: 10000 }
        );
        if (wavButton) {
          await wavButton.click();
        } else {
          throw `Could not find download wav button for ${songObject.clipId}`;
        }

        const modalTitleXPath =
          "xpath///span[contains(text(), 'Download WAV Audio')]";
        await this.page.waitForSelector(modalTitleXPath, {
          visible: true,
          timeout: 15000,
        });
        console.log("  -> Waiting for file generation (up to 45 seconds)...");

        const downloadButtonXPath =
          "//button[.//span[contains(text(), 'Download File')]]";
        const readyDownloadButtonSelector = `xpath/${downloadButtonXPath}[not(@disabled)]`;
        const downloadButtonElement = await this.page.waitForSelector(
          readyDownloadButtonSelector,
          { timeout: 60000 }
        );
        if (downloadButtonElement) {
          await downloadButtonElement.click();
        } else {
          throw `Could not find download button element for ${songObject.clipId}`;
        }

        await GlobalPageMethods.waitUntilDownload(
          this.session,
          songObject.clipId
        );
        await this.page.waitForFunction(
          (xpath) =>
            !document.evaluate(
              xpath,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            ).singleNodeValue,
          {},
          modalTitleXPath.replace("xpath/", "")
        );

        songObject.wavStatus = "DOWNLOADED";
        console.log("  -> WAV download successful.");
        Converter.convertWav(songObject).then(() => {
          Converter.copyToOtherLocations(songObject);
        });
      } catch (e: any) {
        console.error(`  -> WAV download FAILED: ${e.message}`);
        songObject.wavStatus = "FAILED";
        await this.page.keyboard.press("Escape"); // Reset state
      }
    }
  }

  private async downloadMp3(songObject: ISongData) {
    if (
      !AppConfig.audioFormats.includes("mp3") ||
      !AppConfig.useSunoMp3FileIfAvailable
    ) {
      return;
    }
    if (songObject.mp3Status !== "DOWNLOADED") {
      try {
        console.log("  -> Downloading MP3...");
        await this.page.keyboard.press("Escape");
        await delay(200);
        if (
          !(await GlobalPageMethods.clickVisibleMoreButton(
            this.page,
            songObject.clipId
          ))
        )
          throw new Error("More button not clickable for MP3");
        const downloadMenuItem = await this.page.waitForSelector(
          "xpath///button[.//span[text()='Download']]",
          { visible: true, timeout: 5000 }
        );
        if (downloadMenuItem) {
          await downloadMenuItem.hover();
          const mp3Button = await this.page.waitForSelector(
            'button[aria-label="MP3 Audio"]',
            { visible: true, timeout: 5000 }
          );
          if (mp3Button) {
            await mp3Button.click();
            await this.page.waitForSelector('button[aria-label="MP3 Audio"]', {
              hidden: true,
              timeout: 10000,
            });
            songObject.mp3Status = "DOWNLOADED";
            console.log("  -> MP3 download successful.");
          } else {
            throw new Error("Could not find the mp3 button");
          }
        } else {
          throw new Error("Could not find the download menu item");
        }
      } catch (e: any) {
        console.error(`  -> MP3 download FAILED: ${e.message}`);
        songObject.mp3Status = "FAILED";
        await this.page.keyboard.press("Escape"); // Reset state
      }
      MetadataProcessor.saveMainMetadataFile(); // Save status immediately
      await delay(1000);
    }
    return;
  }
  rowsProcessed: number = 0;
  private async discoverSongs() {
    if (this.pagesSearched > 0) {
      console.log("Moving to next page");
      await GlobalPageMethods.paginationOps(this.page, true, false);
    } else {
      await this.findScrollContainer();
    }
    let rows = await this.page.$$(this.ROW_SELECTOR);
    if (!rows || rows.length === 0) {
      console.log(`Waiting for rows`);
      while (!rows) {
        console.log(`...continuing to wait for rows`);
        rows = await this.page.$$(this.ROW_SELECTOR);
      }
    }
    const discoveredSongs: ISongData[] = [];
    let foundIds = new Set<string>();
    Array.from(MetadataProcessor.allSongs.keys()).map((id: string) => {
      foundIds.add(id);
    });
    let firstRowProcessed: boolean = false;

    for (const row of rows) {
      try {
        this.rowsProcessed++;
        // --- Row-level extraction ---
        const clipId =
          (await row.evaluate((r) => r.getAttribute("data-clip-id"))) ?? "";

        if (!clipId) continue;
        if (foundIds.has(clipId)) {
          console.log(` -> Already processed clipId: ${clipId}. Skipping.`);
          continue;
        }
        console.log(` -> Examining row for clipId: ${clipId}`);
        const rowXpath = `//div[@data-react-aria-pressable='true' and @data-key='${clipId}']`;
        const rowSpecs = await this.page.$$(`::-p-xpath(${rowXpath})`);
        let rowSpec: puppeteer.ElementHandle<Element> | null = null;
        //rows per song are doubled for who knows what reason, try to click each until one works. silently fail the rest
        for (const rowSpecTest of rowSpecs) {
          try {
            await rowSpecTest.scrollIntoView();
            await delay(500);
            await rowSpecTest
              .clickablePoint({
                x: 307,
                y: 21.75,
              })
              .catch((err) => {
                throw err;
              });
            if (!firstRowProcessed) {
              rowSpecTest.click();
            }
            rowSpec = rowSpecTest;
            foundIds.add(clipId);
          } catch (err) {
            //console.log(err);
            continue;
          }
        }
        //we found the good one, process it. keyboard actions work better than mouse for some reason
        await delay(500);
        if (rowSpec !== null) {
          if (!firstRowProcessed) {
            //first row needs special handling to get focus right
            firstRowProcessed = true;
            await this.page.keyboard.press("ArrowDown");
            await this.page.keyboard.press("ArrowUp");
          }
          await this.page.keyboard.press("Escape");
          //await this.page.keyboard.press("Enter");
          await delay(500);
          console.log(` -> Processing data for clipId: ${clipId}`);
          //these are all from the row itself
          const title =
            (await this.rowQueryTextOrNull(row, "span[title] a span")) ??
            "Untitled";
          const style =
            (await this.rowGetAttrOrNull(
              row,
              "div.flex.flex-row > div[title]",
              "title"
            )) ?? null;
          let thumbnail =
            (await this.rowGetAttrOrNull(
              row,
              'img[alt="Song Image"]',
              "data-src"
            )) ||
            (await this.rowGetAttrOrNull(
              row,
              'img[alt="Song Image"]',
              "src"
            )) ||
            null;
          const duration =
            (await this.rowQueryTextOrNull(
              row,
              'div[aria-label="Play Song"] span.absolute'
            )) ?? null;

          const model = await row.evaluate((el: Element) => {
            const spans = Array.from(el.querySelectorAll("span"));
            const found = spans.find((s) =>
              s.textContent?.trim().startsWith("v")
            );
            return found?.textContent?.trim() ?? null;
          }, row);

          const liked = await row.evaluate((el: Element) => {
            const btn = el.querySelector('button[aria-label="Playbar: Like"]');
            return btn
              ? btn.classList.contains("text-foreground-primary")
              : false;
          }, row);

          const songUrl = `https://suno.com/song/${clipId}`;
          //these are from the detail panel
          // --- Detail panel extraction ---
          const artistName =
            await GlobalPageMethods.getValueFromElementByXpathByPage(
              this.page,
              this.ARTIST_XPATH,
              "Unknown Artist",
              "title"
            );

          const lyrics =
            await GlobalPageMethods.getValueFromElementByXpathByPage(
              this.page,
              this.LYRICS_XPATH,
              "[Instrumental]"
            );

          const creationDateStr =
            await GlobalPageMethods.getValueFromElementByXpathByPage(
              this.page,
              this.CREATION_DATE_XPATH,
              "January 1 1970 at 12:00AM"
            );
          const [datePart, timePart] = creationDateStr.split(" at ");

          const creationDate = new Date(`${datePart} ${timePart}`);

          //we're only getting the id for the any remix parent, as otherwise we'd have to load that page too which is overkill here
          // (or parse the entire library first, if it's even a remix of your song)
          const remixParentHref =
            await GlobalPageMethods.getValueFromElementByXpathByPage(
              this.page,
              this.REMIX_PARENT_XPATH,
              "",
              "href"
            );
          const remixParent = remixParentHref?.split("/")[2] ?? undefined;
          //control setting values are a little more complex
          const controlVals = new Map<string, string>();
          for (let i = 1; i <= 3; i++) {
            const nameXpath = `${this.CONTROL_NAME_PREFIX}[${i}]/span[1]/text()[1]`;
            const valueXpath = `${this.CONTROL_NAME_PREFIX}[${i}]/span[2]`;
            const key =
              await GlobalPageMethods.getValueFromElementByXpathByPage(
                this.page,
                nameXpath,
                ""
              );
            const val =
              await GlobalPageMethods.getValueFromElementByXpathByPage(
                this.page,
                valueXpath,
                ""
              );
            if (key && val) controlVals.set(key, val);
          }
          const weirdness = this.parsePercentDefault(
            controlVals.get("Weirdness"),
            50
          );
          const styleStrength = this.parsePercentDefault(
            controlVals.get("Style Strength"),
            50
          );
          const audioStrength = this.parsePercentDefault(
            controlVals.get("Audio Strength"),
            25
          );

          // tags are also a bit more complex and sometimes inconsistent
          let tags: string[] = [];
          const tagsElementHandle =
            await GlobalPageMethods.getElementByXpathFromPage(
              this.page,
              this.TAGS_XPATH
            );
          if (
            tagsElementHandle &&
            typeof tagsElementHandle.evaluate === "function"
          ) {
            tags = await tagsElementHandle.evaluate(
              (el: Element) =>
                Array.from(el.querySelectorAll("div, span, a"))
                  .map((x) => x.textContent?.trim())
                  .filter(Boolean) as string[]
            );
          }
          if (thumbnail?.includes("default")||thumbnail?.includes("defualt")){
            //check for mispelling too
            //these default images are locked, can't use them
            console.log(`Found default images for ${clipId}. Skipping image.`);
            thumbnail="";
          }
          discoveredSongs.push({
            title,
            clipId,
            songUrl,
            style,
            thumbnail,
            model,
            duration,
            liked,
            mp3Status: "PENDING",
            wavStatus: "PENDING",
            alacStatus: "PENDING",
            flacStatus: "PENDING",
            artistName,
            lyrics,
            creationDate,
            weirdness,
            styleStrength,
            audioStrength,
            remixParent,
            tags,
          });

          await delay(45);
        }
      } catch (err) {
        console.warn(`Failed to extract row  — skipping. Error:`, err);
        continue;
      } finally {
        await this.page.keyboard.press("ArrowDown");
      }
    }

    // Merge discovered songs with existing data
    let foundThisPass: number = 0;
    for (const song of discoveredSongs) {
      if (!MetadataProcessor.allSongs.has(song.clipId)) {
        MetadataProcessor.allSongs.set(song.clipId, song);
        foundThisPass++;
        await MetadataProcessor.saveSongMetadata(song);
      }
    }
    this.pagesSearched++;
    this.totalDiscoveredSongs = foundThisPass + this.totalDiscoveredSongs;
    console.log(
      `Discovered ${foundThisPass} new songs on page ${GlobalPageMethods.currentPage}, ${this.totalDiscoveredSongs} total so far.`
    );
    MetadataProcessor.saveMainMetadataFile();
    this.morePagesAvailable = await GlobalPageMethods.paginationOps(
      this.page,
      true,
      true
    );
    if (!this.morePagesAvailable) {
      console.log(
        `Discovery complete. Total songs discovered: ${MetadataProcessor.allSongs.size}.`
      );
    }
  }

  // --- Row helpers ---
  private async rowQueryTextOrNull(
    row: puppeteer.ElementHandle<Element>,
    selector: string
  ) {
    try {
      return await row.$eval(selector, (el) => el.textContent?.trim() ?? null);
    } catch {
      return null;
    }
  }

  private async rowGetAttrOrNull(
    row: puppeteer.ElementHandle<Element>,
    selector: string,
    attrName: string
  ) {
    try {
      return await row.$eval(
        selector,
        (el, attr) => el.getAttribute(attr),
        attrName
      );
    } catch {
      return null;
    }
  }

  private parsePercentDefault(
    input: string | undefined | null,
    def: number
  ): number {
    if (!input) return def;
    const parsed = parseInt(input.replace("%", ""), 10);
    return Number.isNaN(parsed) ? def : parsed;
  }

  totalDiscoveredSongs: number = 0;
  morePagesAvailable: boolean = true;
  pagesSearched: number = 0;
  // Configuration / constants
  ROW_SELECTOR = 'div[data-testid="song-row"]';
  CLICK_ROW_XPATH =
    '::-p-xpath(//*[@data-testid="song-row"]/div/div/div[2]/div[1]/div[1])';
  DETAIL_PANEL_ANCHOR_XPATH = `/html/body/div[2]/div[1]/div[2]/div[1]/div/div[3]/div/div/div[1]/div[2]`; // root of detail panel
  ARTIST_XPATH = `/html/body/div[2]/div[1]/div[2]/div[1]/div/div[3]/div/div/div[1]/div[2]/div[2]/div[1]/div/a`;
  LYRICS_XPATH = `/html/body/div[2]/div[1]/div[2]/div[1]/div/div[3]/div/div/div[1]/div[2]/span[1]`;
  CREATION_DATE_XPATH = `/html/body/div[2]/div[1]/div[2]/div[1]/div/div[3]/div/div/div[1]/div[2]/span[2]`;
  REMIX_PARENT_XPATH = `/html/body/div[2]/div[1]/div[2]/div[1]/div/div[3]/div/div/div[1]/div[2]/div[4]/div/div/div/div[2]/div/div[2]/a`;
  CONTROL_NAME_PREFIX = `/html/body/div[2]/div[1]/div[2]/div[1]/div/div[3]/div/div/div[1]/div[2]/div[3]/ul/li`;
  TAGS_XPATH = `/html/body/div[2]/div[1]/div[2]/div[1]/div/div[3]/div/div/div[1]/div[2]/div[2]/div[2]/div`;

  CLICK_RETRIES = 3;
  CLICK_RETRY_DELAY_MS = 300;
  DETAIL_WAIT_TIMEOUT_MS = 3000;
  ROW_SCROLL_MARGIN = {
    behavior: "auto",
    block: "center",
    inline: "center",
  };
}

export let Importer = new Scraper();
