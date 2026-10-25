#!/usr/bin/env node
/** Fetch current JobTech ads with an explicit privacy/size field projection. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const JOBTECH_FIELDS = [
  'total{value}',
  'hits{id,webpage_url,headline,application_deadline,number_of_vacancies,description{text}',
  'employer{name,workplace},application_details{url},experience_required,driving_license_required,driving_license{label}',
  'occupation{label},workplace_address{municipality,city,country}',
  'must_have{skills{label},languages{label},work_experiences{label}}',
  'nice_to_have{skills{label},languages{label},work_experiences{label}}}',
].join(',');

export async function fetchJobTechLive({
  target = 500,
  query = '',
  output,
  endpoint = 'https://jobsearch.api.jobtechdev.se',
  fetchImpl = globalThis.fetch,
} = {}) {
  target = Math.max(1, Math.min(2000, Math.floor(Number(target) || 500)));
  const hits = [];
  const ids = new Set();
  const pages = [];
  let totalAvailable = null;
  for (let offset = 0; hits.length < target && offset < 2000; offset += 100) {
    const url = new URL(`${endpoint.replace(/\/$/, '')}/search`);
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', String(offset));
    if (query) url.searchParams.set('q', query);
    let lastError = null;
    let body = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          headers: { accept: 'application/json', 'x-fields': JOBTECH_FIELDS },
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`JobTech HTTP ${response.status}`);
        body = await response.json();
        if (!Array.isArray(body?.hits)) throw new Error('JobTech response has no hits array');
        break;
      } catch (err) {
        lastError = err;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
    if (!body) throw new Error(`JobTech fetch failed at offset ${offset}: ${lastError?.message || lastError}`);
    totalAvailable = Number(body?.total?.value) || totalAvailable;
    let newOnPage = 0;
    for (const hit of body.hits) {
      const id = String(hit?.id || '');
      if (!id || ids.has(id)) continue;
      ids.add(id);
      hits.push(hit);
      newOnPage += 1;
      if (hits.length >= target) break;
    }
    pages.push({ offset, received: body.hits.length, added: newOnPage });
    if (body.hits.length < 100 || newOnPage === 0) break;
  }
  if (hits.length < target) throw new Error(`Only ${hits.length}/${target} distinct current ads were available`);
  const snapshot = {
    schema: 'majin.v5.jobtech-live-snapshot/v1',
    fetchedAt: new Date().toISOString(),
    source: 'JobTech JobSearch / Platsbanken current ads',
    endpoint,
    query,
    target,
    totalAvailable,
    pages,
    fields: JOBTECH_FIELDS,
    hits: hits.slice(0, target),
  };
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.writeFileSync(output, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  }
  return snapshot;
}

export async function main(argv = process.argv.slice(2)) {
  const read = (flag, fallback = null) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
  };
  const target = Number(read('--target', '500'));
  const output = path.resolve(read('--output', path.join(process.cwd(), '.majin', 'v5', `jobtech-live-${target}.json`)));
  const snapshot = await fetchJobTechLive({
    target,
    query: read('--query', ''),
    output,
  });
  console.log(JSON.stringify({ ok: true, ads: snapshot.hits.length, totalAvailable: snapshot.totalAvailable, fetchedAt: snapshot.fetchedAt, output }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || err);
    process.exitCode = 1;
  });
}
