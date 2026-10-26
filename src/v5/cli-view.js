import { stripVTControlCharacters } from 'node:util';

export const cleanTerminalText = value => stripVTControlCharacters(String(value ?? ''))
  .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
const singleLine = value => cleanTerminalText(value).replace(/\s+/g, ' ').trim();
const statuses = { COMPLETED: 'KLART · verifierat', PARTIAL: 'DELVIS KLART · inte slutverifierat',
  BLOCKED: 'BLOCKERAD', WAITING_USER: 'VÄNTAR PÅ DIG', PAUSED: 'PAUSAD', CANCELLED: 'AVBRUTEN', FAILED: 'MISSLYCKADES' };

export function compactHeader({ version, model, goal, color = false }) {
  const brand = color ? '\x1b[1;36mMAJIN\x1b[0m' : 'MAJIN';
  return `\n${brand}  ${singleLine(version)}\n${singleLine(model || 'Välj modell med /model')}\n`
    + (goal ? `Sparat: ${statuses[goal.status] || singleLine(goal.status)} · ${singleLine(goal.objective).slice(0, 140)}\n` : '')
    + '\nSkriv vad du vill göra. /help hjälp · /status status · /logs detaljer\n'
    + (goal && ['PAUSED', 'BLOCKED', 'WAITING_USER'].includes(goal.status) ? '/resume fortsätter · /new <uppgift> börjar nytt\n' : '');
}

export function compactEvent(event) {
  const labels = { browser_open: 'Öppnar sida', browser_inspect: 'Läser sidan', browser_click: 'Klickar',
    browser_fill: 'Fyller i', browser_upload: 'Bifogar fil', browser_shot: 'Sparar skärmbild',
    browser_verify: 'Kontrollerar sidan', fs_find: 'Letar efter fil', fs_read: 'Läser fil',
    fs_write: 'Skriver fil', documents_extract: 'Läser dokument', web_search: 'Söker på webben' };
  switch (event.type) {
    case 'model_round_started': return event.round === 0 ? '  Tänker…' : null;
    case 'tool_call_started': return `  › ${labels[event.tool] || singleLine(event.tool)}${event.args ? ' · ' + singleLine(event.args) : ''}`;
    case 'tool_call_finished': return event.ok ? null : `  ! ${singleLine(event.tool)} · ${singleLine(event.errorCode || 'Fel')}${event.blocker ? ' — ' + singleLine(event.blocker) : ''}`;
    case 'verification_started': return '  Kontrollerar resultatet…';
    case 'verification_failed': return `  ! Kontrollen misslyckades · ${singleLine(event.failure?.error || event.failure?.label)}`;
    case 'repair_requested': return '  Försöker rätta resultatet…';
    case 'model_stream_retry': return '  Anslutningen försöker igen…';
    case 'waiting_user': return `  ! Behöver din hjälp · ${singleLine(event.kind)} ${singleLine(event.origin || event.url)}`;
    case 'owner_steering_applied': return '  Din nya instruktion är mottagen.';
    case 'delegate_batch_started': return `  Arbetar med ${event.tasks?.length || 0} deluppgifter…`;
    default: return null;
  }
}

export function compactResult(goal) {
  const rows = goal.tool_results || [];
  const evidence = goal.verification_evidence || [];
  const summary = cleanTerminalText(goal.model_reply || goal.summaryText || '').trim();
  const parts = [`\n${statuses[goal.status] || singleLine(goal.status || 'OKÄND STATUS')}`, summary];
  if (goal.blocker && !summary.includes(goal.blocker)) parts.push(`Hinder: ${cleanTerminalText(goal.blocker)}`);
  const failed = rows.filter(row => !row.ok);
  parts.push(`${rows.length} verktygsanrop · ${evidence.length} verifieringsbevis${failed.length ? ` · ${failed.length} fel under körningen` : ''}`);
  if (goal.cost) parts.push(`${goal.cost.modelCalls || 0} modellrundor · ${(goal.cost.inputTokens || 0).toLocaleString('sv-SE')} in / ${(goal.cost.outputTokens || 0).toLocaleString('sv-SE')} ut tokens`);
  if (goal.learning) parts.push(`Inlärning: ${goal.learning.status === 'saved' ? 'sparad' : goal.learning.status === 'pending' ? 'väntar på lagring' : 'ingen ny metod'}`);
  if (goal.browser_handoff?.action) parts.push(`Nästa steg: ${cleanTerminalText(goal.browser_handoff.action)}`);
  else if (['PAUSED', 'BLOCKED', 'WAITING_USER'].includes(goal.status)) parts.push('/resume fortsätter från sparat läge · /logs visar fel och bevis');
  else parts.push('/logs visar verktyg, fel och verifieringsdetaljer');
  return parts.filter(Boolean).join('\n\n') + '\n';
}
