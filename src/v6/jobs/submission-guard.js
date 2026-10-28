import fs from 'node:fs';
import { canonicalUrl } from './store.js';

const effectStates = new Set(['started', 'sent', 'waiting', 'verified', 'SUBMITTING', 'UNCERTAIN', 'SUBMITTED_UNCONFIRMED', 'EMAIL_VERIFICATION_PENDING', 'CONFIRMED_RECEIVED']);
const words = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\([^)]*\)/g, '').replace(/\b(ab|aps|a\/s|ltd|inc)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function applicationUrl(value) {
  try {
    const canonical = canonicalUrl(value);
    if (!canonical) return '';
    const u = new URL(canonical);
    u.pathname = u.pathname.replace(/\/applications\/new\/?$/, '').replace(/\/$/, '') || '/';
    return u.toString();
  } catch { return ''; }
}
export function priorApplication(application, entries) {
  const job = application.job || application;
  const urls = [job.url, job.apply?.url].map(applicationUrl).filter(Boolean);
  const title = new Set(words(job.title).split(' ').filter(Boolean));
  return entries.find(entry => {
    if ((application.id && entry.id === application.id) || (entry.candidateId || entry.profile) !== application.candidateId || !effectStates.has(entry.state || entry.status)) return false;
    const old = entry.job || entry;
    if ([old.url, old.apply?.url].map(applicationUrl).some(u => u && urls.includes(u))) return true;
    const company = words(job.company || job.employer);
    const oldCompany = words(old.company || old.employer);
    if (!company || !oldCompany) return false;
    if (company !== oldCompany) {
      const currentWords = new Set(company.split(' '));
      const priorWords = new Set(oldCompany.split(' '));
      const shared = [...currentWords].filter(word => priorWords.has(word)).length;
      if (shared < 2 || shared / Math.min(currentWords.size, priorWords.size) < 0.75) return false;
    }
    const oldTitle = new Set(words(old.title).split(' ').filter(Boolean));
    const common = [...title].filter(word => oldTitle.has(word)).length;
    return common > 0 && common / Math.min(title.size, oldTitle.size) >= 0.6;
  });
}
export function readPriorLedger(file) {
  if (!file) throw new Error('No candidate-specific application ledger configured');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Array.isArray(data) ? data : data.applications;
  if (!Array.isArray(entries)) throw new Error('Invalid prior application ledger');
  return entries;
}
