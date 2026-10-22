/**
 * MAJIN V4 — model discovery.
 *
 * The Windows installation is the single source of truth. V4 reads the SAME
 * config file V1 uses (`$MAJIN_CONFIG` or `<MAJIN_HOME>/config.json`) and
 * exposes only safe metadata: provider labels, model ids and whether a
 * credential is present. Credential values never cross this boundary.
 *
 * Honesty rules:
 *  - "configured" means a key exists; it is NOT proof of a working inference.
 *  - Every listed model therefore carries `liveVerified: false` unless a real
 *    call has succeeded in this process (recorded by the model client).
 *  - A static list is never presented as discovered availability.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expandEnvValue } from './config.js';
import { t } from './ui/strings.js';

const liveResults = new Map(); // "provider/model" -> { ok, at, errorClass }

export function recordLiveResult(modelId, result) {
  liveResults.set(modelId, { at: new Date().toISOString(), ...result });
}

export function liveResultFor(modelId) {
  return liveResults.get(modelId) || null;
}

export function configFilePath({ home, env = process.env }) {
  return env.MAJIN_CONFIG || path.join(home, 'config.json');
}

function readConfig(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function hostOf(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

/**
 * Build the catalogue. Never throws on a broken config: an unreadable file
 * yields `source: 'none'` and the demo lane, which the UI states plainly.
 */
export function discoverModels({ home, env = process.env } = {}) {
  const file = configFilePath({ home, env });
  const cfg = readConfig(file);
  const result = {
    source: cfg ? 'v1-config' : 'none',
    configPath: file,
    configReadable: Boolean(cfg),
    providers: [],
    models: [],
    current: null,
    liveVerifiedCount: 0,
  };

  const envRoute = env.MAJIN_V4_MODEL || null;
  if (envRoute) {
    result.models.push({
      id: `env/${envRoute}`,
      provider: 'env',
      providerLabel: t('model.envLabel'),
      model: envRoute,
      label: envRoute,
      configured: true,
      status: 'configured',
      statusLabel: 'Konfigurerad (ej live-verifierad)',
      liveVerified: false,
    });
    result.providers.push({ name: 'env', label: t('model.envLabel'), kind: 'openai', hasKey: true, host: null, models: [envRoute] });
    result.current = `env/${envRoute}`;
  }

  const providers = cfg?.providers && typeof cfg.providers === 'object' ? cfg.providers : {};
  for (const [name, p] of Object.entries(providers)) {
    if (!p || typeof p !== 'object') continue;
    const models = Array.isArray(p.models) ? p.models.filter((m) => typeof m === 'string' && m.trim()) : [];
    const apiKey = expandEnvValue(p.apiKey, env);
    const hasKey = Boolean(apiKey);
    if (!hasKey && !models.length) continue; // nothing to offer
    const entry = {
      name,
      label: typeof p.label === 'string' ? p.label : name,
      kind: ['openai', 'anthropic', 'responses', 'mock'].includes(p.kind) ? p.kind : 'openai',
      host: hostOf(p.baseUrl) || null,
      hasKey,
      models: [...models],
    };
    result.providers.push(entry);
    for (const model of models) {
      const id = `${name}/${model}`;
      const live = liveResults.get(id);
      const status = !hasKey ? 'missing-key' : live ? (live.ok ? 'verified' : 'unavailable') : 'configured';
      result.models.push({
        id,
        provider: name,
        providerLabel: entry.label,
        model,
        label: `${entry.label} · ${model}`,
        configured: hasKey,
        status,
        statusLabel: {
          'missing-key': t('model.status.missingKey'),
          configured: t('model.status.configured'),
          verified: t('model.status.verified'),
          unavailable: t('model.status.unavailable'),
        }[status],
        liveVerified: status === 'verified',
        ...(live?.errorClass ? { errorClass: live.errorClass } : {}),
      });
    }
  }

  if (!result.current && cfg?.models?.routes?.chat) {
    const ref = String(cfg.models.routes.chat);
    if (result.models.some((m) => m.id === ref)) result.current = ref;
  }
  if (!result.current && result.models.length) {
    const firstUsable = result.models.find((m) => m.configured);
    result.current = firstUsable ? firstUsable.id : result.models[0].id;
  }
  result.liveVerifiedCount = result.models.filter((m) => m.liveVerified).length;
  return result;
}

/**
 * Resolve a model id to a complete route, or null when it is not authorised.
 * Only ids present in the discovered catalogue (or the explicit env route)
 * are accepted, so the phone cannot point MAJIN at an arbitrary endpoint.
 */
export function resolveRouteForModel({ home, env = process.env, modelId, base }) {
  if (!modelId) return null;
  if (modelId.startsWith('env/')) {
    if (!base || base.kind === 'demo') return null;
    if (`env/${base.model}` !== modelId) return null;
    return base;
  }
  const cfg = readConfig(configFilePath({ home, env }));
  if (!cfg) return null;
  const slash = modelId.indexOf('/');
  if (slash < 1) return null;
  const providerName = modelId.slice(0, slash);
  const model = modelId.slice(slash + 1);
  const provider = cfg.providers?.[providerName];
  if (!provider || !provider.baseUrl) return null;
  const declared = Array.isArray(provider.models) ? provider.models : [];
  if (!declared.includes(model)) return null; // not an authorised model id
  const apiKey = expandEnvValue(provider.apiKey, env);
  if (!apiKey) return null;
  const kind = ['anthropic', 'responses', 'mock'].includes(provider.kind) ? provider.kind : 'openai';
  const raw = String(provider.baseUrl).replace(/\/+$/, '');
  return {
    kind,
    providerName,
    label: provider.label || providerName,
    baseUrl: raw,
    endpoint: kind === 'anthropic'
      ? (raw.endsWith('/messages') ? raw : `${raw}/messages`)
      : (raw.endsWith('/chat/completions') ? raw : `${raw}/chat/completions`),
    apiKey,
    model,
    extraHeaders: provider.headers || null,
    maxTokens: base?.maxTokens || 2048,
    temperature: base?.temperature ?? 0.4,
  };
}
