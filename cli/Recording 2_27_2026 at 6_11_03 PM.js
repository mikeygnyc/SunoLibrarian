const puppeteer = require('puppeteer'); // v23.0.0 or later

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    const timeout = 5000;
    page.setDefaultTimeout(timeout);

    {
        const targetPage = page;
        await targetPage.setViewport({
            width: 1155,
            height: 981
        })
    }
    {
        const targetPage = page;
        await targetPage.goto('https://suno.com/song/0a0bd19c-5c5e-4b9a-b412-f2b2d65b0be4');
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Edit Song Details) >>>> ::-p-aria([role=\\"generic\\"])'),
            targetPage.locator('div.aspect-2\\/3 span'),
            targetPage.locator('::-p-xpath(//*[@id=\\"main-container\\"]/div/div/div[1]/div[1]/button/span)'),
            targetPage.locator(':scope >>> div.aspect-2\\/3 span')
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 39.66796875,
                y: 12,
              },
            });
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Generate Cover Art) >>>> ::-p-aria([role=\\"generic\\"])'),
            targetPage.locator('div.min-w-40 > div.flex > button:nth-of-type(1) > span'),
            targetPage.locator('::-p-xpath(//*[@id=\\"chakra-modal-_r_hd_\\"]/div/div[1]/div/div[1]/div[2]/div[1]/div[2]/button[1]/span)'),
            targetPage.locator(':scope >>> div.min-w-40 > div.flex > button:nth-of-type(1) > span'),
            targetPage.locator('::-p-text(Generate Cover)')
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 69.5,
                y: 14.5,
              },
            });
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Text to Image)'),
            targetPage.locator('#radix-_r_hv_-trigger-image'),
            targetPage.locator('::-p-xpath(//*[@id=\\"radix-_r_hv_-trigger-image\\"])'),
            targetPage.locator(':scope >>> #radix-_r_hv_-trigger-image'),
            targetPage.locator('::-p-text(Text to Image)')
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 30.390625,
                y: 8.5,
              },
            });
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('div:nth-of-type(8) div.items-start svg'),
            targetPage.locator('::-p-xpath(//*[@id=\\"chakra-modal-_r_hd_\\"]/div/div[2]/div/div[4]/div[2]/div/div[2]/button/span/svg)'),
            targetPage.locator(':scope >>> div:nth-of-type(8) div.items-start svg')
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 13.5,
                y: 9.5,
              },
            });
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('div.gap-2 > div:nth-of-type(1) div.bg-\\(--color-overlay\\)'),
            targetPage.locator('::-p-xpath(//*[@id=\\"chakra-modal-_r_hd_\\"]/div/div[2]/div/div[4]/div[1]/div/div/div/div[2]/div[1]/div/article/div/div[2])'),
            targetPage.locator(':scope >>> div.gap-2 > div:nth-of-type(1) div.bg-\\(--color-overlay\\)')
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 82.5,
                y: 98.8984375,
              },
            });
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Save as Image Cover) >>>> ::-p-aria([role=\\"generic\\"])'),
            targetPage.locator('div.block > div > div.justify-end span'),
            targetPage.locator('::-p-xpath(//*[@id=\\"chakra-modal-_r_hd_\\"]/div/div[2]/div/div[3]/div[2]/div/button/span)'),
            targetPage.locator(':scope >>> div.block > div > div.justify-end span'),
            targetPage.locator('::-p-text(Save as Image)')
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 67.546875,
                y: 6,
              },
            });
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Close) >>>> ::-p-aria([role=\\"image\\"])'),
            targetPage.locator('body > div:nth-of-type(8) div:nth-of-type(1) > div.flex-row svg'),
            targetPage.locator('::-p-xpath(//*[@id=\\"chakra-modal-_r_hd_\\"]/div/div[1]/div/div[1]/div[1]/div[3]/button/span/svg)'),
            targetPage.locator(':scope >>> body > div:nth-of-type(8) div:nth-of-type(1) > div.flex-row svg')
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 2.5,
                y: 11.5,
              },
            });
    }

    await browser.close();

})().catch(err => {
    console.error(err);
    process.exit(1);
});
