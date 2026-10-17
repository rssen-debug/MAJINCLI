/**
 * MAJIN — provider presets.
 * A preset is just a base URL + auth shape. Every model in the universe works
 * because MAJIN talks OpenAI-compatible chat/completions and rewrites the URL for
 * the three providers that insist on their own dialect.
 */

/** kind: openai | anthropic | gemini | mock */
export const PRESETS = {
  deepseek: {
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    models: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-reasoner'],
    notes: 'deepseek-flash = V4.1 Flash (billig/snabb). deepseek-v4-pro = tung reasoning, 1M context.',
  },
  openrouter: {
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/settings/keys',
    models: ['deepseek/deepseek-flash', 'anthropic/claude-sonnet-5', 'openai/gpt-5.2', 'x-ai/grok-4-fast'],
    notes: '200+ models, one key. Good for MOA references.',
  },
  nous: {
    label: 'Nous Portal',
    kind: 'openai',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    keyEnv: 'NOUS_API_KEY',
    keyUrl: 'https://portal.nousresearch.com/',
    models: ['Hermes-4', 'Hermes-4-Thinking'],
    notes: 'Hermes 4 via Nous Portal.',
  },
  groq: {
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
    notes: 'Low latency — good for the tool loop and voice.',
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-5.2', 'gpt-5.2-mini'],
  },
  anthropic: {
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyEnv: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-sonnet-5', 'claude-opus-4-6'],
    notes: 'The native messages API is translated internally, tools work as usual.',
  },
  gemini: {
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyEnv: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    models: ['gemini-3-pro', 'gemini-3-flash'],
  },
  ollama: {
    label: 'Ollama (lokalt)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    keyEnv: null,
    apiKey: 'ollama',
    models: ['qwen3-coder:30b', 'deepseek-r1:14b', 'llama3.2:3b'],
    notes: 'No key needed. Costs nothing — used as a fallback when the cloud misbehaves.',
  },
  lmstudio: {
    label: 'LM Studio (lokalt)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    keyEnv: null,
    apiKey: 'lmstudio',
    models: ['local-model'],
  },
  mock: {
    label: 'Demo (ingen nyckel)',
    kind: 'mock',
    baseUrl: 'mock://local',
    keyEnv: null,
    apiKey: 'mock',
    models: ['demo-fast', 'demo-pro'],
    notes: 'Scripted provider for testing the agent offline. No data leaves the machine.',
  },
};

export function presetNames() {
  return Object.keys(PRESETS);
}

/** Split "provider/model" or resolve a bare model name against known presets. */
export function splitModel(ref, cfg) {
  if (!ref) return null;
  const s = String(ref).trim();
  const providerFirst = s.includes('/') ? s.slice(0, s.indexOf('/')) : null;
  if (providerFirst && cfg?.providers?.[providerFirst]) {
    return { provider: providerFirst, model: s.slice(s.indexOf('/') + 1) };
  }
  const providers = cfg?.providers ? Object.keys(cfg.providers) : [];
  for (const p of providers) {
    const preset = PRESETS[p];
    if (preset?.models?.includes(s)) return { provider: p, model: s };
  }
  const def = cfg?.models?.provider || providers[0] || 'mock';
  return { provider: def, model: s.includes('/') ? s.split('/').pop() : s };
}

/** OpenAI-compatible chat endpoint for a provider. */
export function chatUrl(provider) {
  const base = String(provider.baseUrl || '').replace(/\/+$/, '');
  if (provider.kind === 'anthropic') return `${base}/messages`;
  if (provider.kind === 'gemini') return base; // model appended per-request
  return `${base}/chat/completions`;
}

export function listModelsUrl(provider) {
  const base = String(provider.baseUrl || '').replace(/\/+$/, '');
  if (provider.kind === 'gemini') return `${base}/models`;
  if (provider.kind === 'anthropic') return null;
  return `${base}/models`;
}
