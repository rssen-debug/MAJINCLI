// Authorization and discovery for the OpenCode -> MAJIN V5 driver bridge.
// No grants are created here; all non-meta calls require the owner's persisted grants.
import { laneForSourceTool } from './host-bridge.js';

export const META_TOOLS = new Set(['driver_status', 'tools_search', 'skills_search', 'skills_read', 'procedures_search', 'procedures_read']);

export function requiredLane(entry) {
  const name = String(entry?.name || '');
  if (META_TOOLS.has(name)) return 'meta';
  if (name === 'documents_extract') return 'files';
  if (name.startsWith('jobs_')) return 'jobs';
  if (name.startsWith('browser_')) return 'browser';
  if (name.startsWith('fs_')) return 'files';
  // CodexDriver deliberately removes .source from published schemas; infer the
  // conservative lane from the exported tool name, never infer permission.
  const source = String(entry?.source || '').trim() || name.replace(/^([^_]+)_/, '$1.');
  return String(entry.lane || laneForSourceTool(source));
}

export function isAuthorized(entry, grantedLanes = []) {
  const lane = requiredLane(entry);
  if (lane === 'meta') return true;
  if (!Array.isArray(grantedLanes)) return false;
  if (grantedLanes.includes(lane)) return true;
  return (lane === 'web' && grantedLanes.includes('research'))
    || (lane === 'shelltools' && grantedLanes.includes('shell'))
    || (lane === 'shell' && grantedLanes.includes('shelltools'));
}

export function fingerprintGrants({ lanes = [], folders = [] } = {}) {
  return JSON.stringify({
    lanes: [...new Set(lanes)].sort(),
    folders: [...new Set(folders.map(x => String(x).toLowerCase()))].sort(),
  });
}

export function filterCatalog(catalog, lanes, query = '', limit = 30) {
  const q = String(query).trim().toLowerCase();
  const bounded = Math.max(1, Math.min(50, Number(limit) || 30));
  return catalog.filter(x => isAuthorized(x, lanes) &&
    (!q || [x.name, x.source, x.description, x.lane].some(s => String(s || '').toLowerCase().includes(q))))
    .slice(0, bounded)
    .map(x => ({
      name: x.name,
      description: String(x.description || '').slice(0, 180),
      source: x.source || null,
      lane: requiredLane(x),
    }));
}
