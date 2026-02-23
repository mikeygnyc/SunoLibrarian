import path from "path";
import { delay, Importer } from "./scraper";
import * as puppeteer from "puppeteer";
import fs from "fs";
import { AppConfig } from "./ConfigHandler";
export class PageMethods {
  constructor() {}
  async isSongOnPage(clipId: string) {
    let rows = await Importer.page.$$(Importer.ROW_SELECTOR);

    // // Wait until rows exist
    // if (!rows || rows.length === 0) {
    //   console.log(`Waiting for rows`);
    //   while (!rows) {
    //     console.log(`...continuing to wait for rows`);
    //     rows = await Importer.page.$$(Importer.ROW_SELECTOR);
    //   }
    // }
    const foundRow = await this.asyncFind(rows, (row) =>
      this.rowExists(clipId, row)
    );

    if (foundRow) {
      console.log(`Found row for clipId ${clipId}`);
      return true;
    }

    console.log(`ClipId ${clipId} not found`);
    return false;
  }
  rowExists(clipId: string, row: puppeteer.ElementHandle): Promise<boolean> {
    return row
      .evaluate((r) => r.getAttribute("data-clip-id"))
      .then(
        (idFoundStr: string | null) => {
          return idFoundStr === clipId;
        },
        (reason: any) => {
          return false;
        }
      );
  }
  async asyncFind<T>(
    array: T[],
    predicate: (item: T) => Promise<boolean>
  ): Promise<T | undefined> {
    for (const item of array) {
      if (await predicate(item)) {
        return item; // Return the first item that satisfies the async predicate
      }
    }
    return undefined; // No item found
  }

  async scrollSongIntoView(
    page: puppeteer.Page,
    clipId: string
  ): Promise<puppeteer.ElementHandle | null> {
    while (true) {
    
      if (await this.isSongOnPage(clipId)) {
        const songSelector = `div[data-clip-id="${clipId}"]`;
        let songRow = await Importer.currentScrollContainer.$(songSelector);

        if (songRow) {
          await songRow.evaluate((el) =>
            el.scrollIntoView({ block: "center" })
          );
          await delay(250);
          return songRow;
        }

        console.log(`  -> Song ${clipId} not visible. Scrolling to find...`);
        let stallCount = 0;
        while (stallCount < 2) {
          await Importer.currentScrollContainer.evaluate((el) => {
            el.scrollTop += el.clientHeight * 0.8;
          });
          await delay(1500);

          songRow = await Importer.currentScrollContainer.$(songSelector);
          if (songRow) {
            await songRow.evaluate((el) =>
              el.scrollIntoView({ block: "center" })
            );
            await delay(250);
            console.log(`  -> Found ${clipId} after scrolling.`);
            return songRow;
          }

          const isAtBottom = await Importer.currentScrollContainer.evaluate(
            (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 20
          );

          if (isAtBottom) {
            console.log(
              "  -> Reached bottom. Resetting to top for another pass."
            );
            await Importer.currentScrollContainer.evaluate((el) =>
              el.scrollTo(0, 0)
            );
            stallCount++;
            await delay(700);
          }
        }

        console.error(`  -> Could not find song ${clipId} after scrolling.`);
        return null;
      } else {
        if (Importer.morePagesAvailable) {
          console.log("  -> Reached bottom again. Going to next page.");
          const navigated = await this.paginationOps(page, true, false);
        } else {
          console.error(
            `  -> Could not find song ${clipId} after searching pages.`
          );
          return null;
        }
      }
    }
   
  }
  async clickVisibleMoreButton(
    page: puppeteer.Page,
    clipId: string
  ): Promise<boolean> {
    const moreButtonSelector = `div[data-clip-id="${clipId}"] button[aria-label="More menu contents"]`;
    const buttons = await page.$$(moreButtonSelector);
    if (buttons.length === 0) return false;

    for (const button of buttons) {
      if (await button.isIntersectingViewport()) {
        await button.click();
        return true;
      }
    }
    return false;
  }

  async clickNextPageButton(
    page: puppeteer.Page | undefined,
    checkOnly: boolean = false
  ): Promise<boolean> {
    if (!page) {
      return false;
    }
    //for whatever reason next does not have an aria label but previous does
    const nextButton = puppeteer.Locator.race([
      page.locator(
        "div.md\\:flex > div > div.flex-col > div button:nth-of-type(2) > svg"
      ),
      page.locator(
        '::-p-xpath(//*[@id=\\"main-container\\"]/div[2]/div/div[2]/div/div[2]/div/div/div[2]/div/button[2]/svg)'
      ),
      page.locator(
        ":scope >>> div.md\\:flex > div > div.flex-col > div button:nth-of-type(2) > svg"
      ),
    ]).setTimeout(5000);
    if (checkOnly) {
      return nextButton !== null;
    }
    if (nextButton) {
      await nextButton.click();
      return true;
    }
    return false;
    //returns false if not found
  }

  async clickPreviousPageButton(
    page: puppeteer.Page,
    checkOnly: boolean
  ): Promise<boolean> {
    const prevButton = puppeteer.Locator.race([
      page.locator(
        '::-p-aria(Previous Page) >>>> ::-p-aria([role=\\"image\\"])'
      ),
      page.locator(
        "div.md\\:flex > div > div.flex-col > div button:nth-of-type(1) > svg"
      ),
      page.locator(
        '::-p-xpath(//*[@id=\\"main-container\\"]/div[2]/div/div[2]/div/div[2]/div/div/div[2]/div/button[1]/svg)'
      ),
      page.locator(
        ":scope >>> div.md\\:flex > div > div.flex-col > div button:nth-of-type(1) > svg"
      ),
    ]).setTimeout(5000);
    if (checkOnly) {
      return prevButton !== null;
    }
    if (prevButton) {
      await prevButton.click();
      return true;
    }
    return false;
  }
  getElementByXpath(document: Document, xpath: string): Element | null {
    let temp = document.querySelector(`::-p-xpath(${xpath})`);
    return temp;
  }
  async getElementByXpathFromPage(
    page: puppeteer.Page,
    xpath: string
  ): Promise<puppeteer.ElementHandle<Element> | null> {
    return await page.$(`::-p-xpath(${xpath})`);
  }

  async getValueFromElementByXpathByPage(
    page: puppeteer.Page,
    xpath: string,
    defaultValue: string,
    valueKey?: string
  ): Promise<string> {
    let evalFunc: any;
    if (!valueKey) {
      evalFunc = (el: Element) => el.textContent;
    } else {
      evalFunc = (el: Element, key: string) => el.getAttribute(key!);
    }
    const FullElement = await this.getElementByXpathFromPage(page, xpath);
    const retValue =
      (await FullElement?.evaluate(evalFunc, valueKey)) || defaultValue;
    return retValue;
  }

  getValueFromElementByXpath(
    document: Document,
    xpath: string,
    defaultValue: string,
    valueKey?: string
  ): string {
    let evalParm: any;
    if (!valueKey) {
      evalParm = (el: Element) => el.textContent;
    } else {
      evalParm = (el: Element) => el.getAttribute(valueKey);
    }
    let retValue = defaultValue;
    const FullElement = this.getElementByXpath(document, xpath);
    if (!valueKey) {
      retValue = FullElement?.textContent || defaultValue;
    } else {
      retValue = FullElement?.getAttribute(valueKey) || defaultValue;
    }
    return retValue;
  }
  async getCurrentPageNumber(page: puppeteer.Page): Promise<number> {
    const pageNumXpath = `/html/body/div[1]/div[1]/div[2]/div[1]/div/div[1]/div[2]/div/div[2]/div/div[2]/div/div/div[2]/div/div/span`;
    const scrollContainerSelector = 'div[id*="tabpanel-songs"]';
    await page.waitForSelector(scrollContainerSelector, { timeout: 30000 });

    const pageNumberText = await this.getValueFromElementByXpathByPage(
      page,
      pageNumXpath,
      "1"
    );
    if (pageNumberText) {
      const pageNumber = parseInt(pageNumberText.trim());
      if (!isNaN(pageNumber)) {
        return pageNumber;
      }
      return pageNumber;
    }
    return 1;
  }
  currentPage: number = 1;

  async paginationOps(
    page: puppeteer.Page,
    goToNext: boolean,
    checkOnly: boolean
  ): Promise<boolean> {
    let success: boolean = false;

    if (goToNext) {
      success = await this.clickNextPageButton(page, checkOnly);
      if (success) {
        console.log(
          checkOnly
            ? "  -> More pages available."
            : "  -> Navigated to next page."
        );
      } else {
        console.log(
          checkOnly
            ? "  -> No more pages available."
            : "  -> Next page button not found."
        );
      }
    } else {
      success = await this.clickPreviousPageButton(page, checkOnly);
      if (success) {
        console.log(
          checkOnly
            ? "  -> Previous page available."
            : "  -> Navigated to previous page."
        );
      } else {
        console.log(
          checkOnly
            ? "  -> This is the first page available."
            : "  -> Previous page button not found."
        );
      }
    }
    Importer.session.detach();
    page.mainFrame();
    Importer.session = await Importer.sessionStarter();
    await Importer.findScrollContainer();
    this.currentPage = await this.getCurrentPageNumber(page);
    await delay(1500);//TODO this should be dynamic

    console.log(`  -> Current page is now ${this.currentPage}`);
    return success;
  }

  async waitUntilDownload(
    session: puppeteer.CDPSession,
    fileName: string = ""
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const handler = (e: puppeteer.Protocol.Browser.DownloadProgressEvent) => {
        if (e.state === "completed") {
          // Remove listener before resolving
          session.off("Browser.downloadProgress", handler);

          const downloadPath = path.resolve(
            AppConfig.downloadRootDirectoryPath,
            "wav"
          );
          if (e.filePath) {
            const originalFileName = e.filePath;
            const newFileName = `${fileName}.wav`;
            const newFilePath = path.join(downloadPath, newFileName);
            fs.renameSync(originalFileName, newFilePath);
            console.log(`    ->File renamed from ${e.guid} to ${newFileName}`);
          }

          resolve(fileName);
        } else if (e.state === "canceled") {
          // Remove listener before rejecting
          session.off("Browser.downloadProgress", handler);
          reject(new Error("Download was canceled"));
        }
      };

      // Attach listener
      session.on("Browser.downloadProgress", handler);
    });
  }
}

export let GlobalPageMethods = new PageMethods();
