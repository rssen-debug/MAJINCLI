/**
 * Fail-closed job application gate. Use BEFORE any form submission.
 * This module never submits a form and never grants approval itself.
 */
export const BANNED_EMPLOYERS = Object.freeze(['atea','gigstep','poolia']);
const normalize = s => String(s || '').normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9åäö]+/g,' ').trim();
export function jobKey(job) {
  if (typeof job?.id === 'string' && job.id.trim()) return job.id.trim();
  if (typeof job?.url === 'string' && /^https?:\/\//i.test(job.url)) return job.url.split('#')[0];
  throw new Error('A stable job ID or URL is required; match scores are not identifiers');
}
export function applicationDecision(job,{excludedJobIds=[],approvedJobIds=[],confirmedJobIds=[],blockedEmployers=BANNED_EMPLOYERS}={}) {
  const id=jobKey(job);
  const employer=normalize(job.employer);
  const reasons=[];
  if (blockedEmployers.some(name => {
    const target=normalize(name);
    return target && new RegExp('(?:^| )'+target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?: |$)').test(employer);
  })) reasons.push('blocked_employer');
  if (excludedJobIds.includes(id)) reasons.push('owner_excluded_job');
  if (confirmedJobIds.includes(id)) reasons.push('already_submitted');
  if (!approvedJobIds.includes(id)) reasons.push('missing_explicit_job_approval');
  return {jobId:id,allowed:reasons.length===0,reasons};
}
export function receiptStatus({submitted=false,confirmationText='',confirmationId='',emailVerified=false}={}) {
  if (!submitted) return 'not_submitted';
  const accepted = /(?:tack för din ansökan|vi har tagit emot din ansökan|thank you for (?:your application|applying)|application submitted)/i.test(confirmationText);
  if (accepted || (typeof confirmationId==='string' && confirmationId.trim())) return 'confirmed_received';
  if (!emailVerified) return 'pending_verification';
  return 'submitted_unconfirmed';
}
