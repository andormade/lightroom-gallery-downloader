#!/usr/bin/env node

import puppeteer from "puppeteer";
import {
  getViewportHeight,
  getVisibleImadeIds,
  scroll,
} from "./injectableUtils";
import { ensureDir } from "fs-extra";
import { promises as fs } from "fs";
import path from "path";

const delay = (delay: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delay));

async function waitForDownloadsToFinish(downloadPath: string): Promise<void> {
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const files = await fs.readdir(downloadPath);
      const hasCrdownloadFile = files.some(
        (file) => path.extname(file) === ".crdownload"
      );
      if (!hasCrdownloadFile) {
        resolve();
        clearInterval(interval);
      }
    }, 1000);
  });
}

function getDownloadLink(adobeShareId: string, assetId: string): string {
  return `https://dl.lightroom.adobe.com/spaces/${adobeShareId}/assets/${assetId}`;
}

async function collectImageIds(page: puppeteer.Page): Promise<string[]> {
  const imageIds = new Set<string>([]);
  let reachedTheEnd = false;
  const scrollSize = Math.ceil((await getViewportHeight(page)) / 2);

  while (!reachedTheEnd) {
    await delay(1000);
    const visibleImageIds = await getVisibleImadeIds(page);
    visibleImageIds.forEach((imageId) => {
      imageIds.add(imageId);
    });
    reachedTheEnd = await scroll(page, scrollSize);
  }

  return Array.from(imageIds);
}

(async function download() {
  const downloadPath = process.argv[2];
  const adobeShareId = process.argv[3];

  console.log("Launching puppeteer...");

  const browser = await puppeteer.launch({
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  const page = await browser.newPage();
  await page.goto(`https://lightroom.adobe.com/shares/${adobeShareId}`);
  await page.waitForSelector(".image");

  await delay(2000);

  console.log("Collecting images...");
  const images = await collectImageIds(page);
  console.log(`Found ${images.length} images.`);


  await ensureDir(downloadPath);
  
  // Note to my future self: this is an undocumented, internal API that can
  // and will actually break after updating puppeteer.
  // @ts-ignore
  await page._client.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath,
  });

  for (let i = 0; i < images.length; i++) {
    const imagePermalink = getDownloadLink(adobeShareId, images[i]);
    console.log("Started downloading image:", images[i]);
    await page.evaluate((link) => {
      // @ts-ignore
      location.href = link;
    }, imagePermalink);
    await delay(1000);
  }

  console.log("Waiting for downloads to finish...");
  await waitForDownloadsToFinish(downloadPath);

  await browser.close();
})();
