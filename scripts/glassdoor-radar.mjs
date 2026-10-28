import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { JobStore, loadProfiles } from '../src/v6/jobs/store.js';

const home = process.env.MAJIN_V6_HOME || 'C:/Users/Ghost/AppData/Local/MAJIN/v6-merged479-state';
const outFile = 'C:/Users/Ghost/Desktop/Jobbradar-Lavinia-glassdoor-live.json';
const url = process.env.GLASSDOOR_URL || 'https://www.glassdoor.com/Job/copenhagen-content-creator-jobs-SRCH_IL.0,10_IC2218704_KO11,26.htm';
const good = /(content|social|marketing|brand|kommunik|communication|copywrit|creator|video|design|e-commerce|ecommerce|seo|influencer|ugc|community|\bpr\b)/i;
const bad = /(senior|lead\b|manager|director|head\b|student|studentermedhj|praktik|intern\b|trainee|store manager|assistant store|massage|cleaner|driver|sales advisor|chef|therapist|warehouse|tour guide|travel counselor|nurse|teacher|accountant|engineer|developer|technician|receptionist|waiter|barista|security|logistics|pick|pack|caregiver|fisioterap|physio|optician|dentist|pharmac|lawyer|jurist|økonom|relocate|greece|abroad)/i;

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({
  locale: 'en-US',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});
let response;
try {
  response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
  await browser.close();
  process.exit(1);
}
const status = response?.status() || null;
const cards = await page.locator('li[data-jobid]').count();
const jobs = [];
if (cards > 0) {
  for (const card of await page.locator('li[data-jobid]').all()) {
    const id = await card.getAttribute('data-jobid');
    const title = await card.locator('a[data-test="job-title"]').first().innerText().catch(() => '');
    const href = await card.locator('a[data-test="job-title"]').first().getAttribute('href').catch(() => null);
    const company = await card.locator('[class*="compactEmployerName"]').first().innerText().catch(() => '');
    const city = await card.locator('[data-test="emp-location"]').first().innerText().catch(() => '');
    const snippet = await card.locator('[data-test="descSnippet"]').first().innerText().catch(() => '');
    if (!title || !href) continue;
    if (!good.test(title) || bad.test(title)) continue;
    jobs.push({
      site: 'glassdoor',
      siteId: String(id || href),
      title: title.trim(),
      company: company.trim() || 'Glassdoor employer',
      city: city.trim() || 'Copenhagen',
      country: 'DK',
      url: href.startsWith('http') ? href : new URL(href, 'https://www.glassdoor.com').href,
      apply: { url: href.startsWith('http') ? href : new URL(href, 'https://www.glassdoor.com').href },
      description: snippet.replace(/…|&hellip;/g, '').trim(),
      deadline: null,
      published: null,
      mustHave: [],
      niceToHave: [],
      source: 'glassdoor',
    });
  }
}
await browser.close();

const profiles = loadProfiles(path.join(home, 'jobs', 'profiles.json'));
if (!profiles.ok) throw new Error(profiles.error.reason);
const store = new JobStore({ file: path.join(home, 'jobs', 'applications.json') });
let created = 0;
let existing = 0;
for (const job of jobs) {
  const result = await store.upsertDiscovered(job, 'lavinia');
  if (result.created) created += 1; else existing += 1;
}
const payload = { generatedAt: new Date().toISOString(), status, url, cards, matched: jobs.length, imported: created, existing, jobs };
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
console.log(JSON.stringify({ ok: status === 200 && cards > 0, status, cards, matched: jobs.length, imported: created, existing, outFile, sample: jobs.slice(0, 8) }, null, 2));
