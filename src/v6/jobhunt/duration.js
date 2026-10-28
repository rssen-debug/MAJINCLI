const UNIT_MS = Object.freeze({ d: 86_400_000, h: 3_600_000, m: 60_000 });
const MAX_DURATION_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const DURATION_PATTERN = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/i;

export class DurationError extends Error {
  constructor(message, code = 'DURATION_INVALID') {
    super(message);
    this.name = 'DurationError';
    this.code = code;
  }
}

export function parseDuration(input) {
  if (input == null || String(input).trim() === '') {
    throw new DurationError('A duration is required, for example 30m, 2h or 1d', 'DURATION_REQUIRED');
  }
  const normalized = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!DURATION_PATTERN.test(normalized)) {
    throw new DurationError('Invalid duration. Use a positive value with m, h or d, for example 120m, 2h or 1d', 'DURATION_INVALID');
  }
  const match = normalized.match(DURATION_PATTERN);
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  if (![days, hours, minutes].every(Number.isSafeInteger)) {
    throw new DurationError('Duration is too large to represent safely', 'DURATION_TOO_LARGE');
  }
  const total = (days * UNIT_MS.d) + (hours * UNIT_MS.h) + (minutes * UNIT_MS.m);
  if (!Number.isSafeInteger(total)) {
    throw new DurationError('Duration is too large to represent safely', 'DURATION_TOO_LARGE');
  }
  if (total <= 0) {
    throw new DurationError('Duration must be greater than zero', 'DURATION_ZERO');
  }
  if (total > MAX_DURATION_MS) {
    throw new DurationError('Duration exceeds the 10-year maximum', 'DURATION_TOO_LARGE');
  }
  const normalizedDays = Math.floor(total / UNIT_MS.d);
  const normalizedHours = Math.floor((total % UNIT_MS.d) / UNIT_MS.h);
  const normalizedMinutes = Math.floor((total % UNIT_MS.h) / UNIT_MS.m);
  return {
    ok: true,
    ms: total,
    normalized,
    parts: { days: normalizedDays, hours: normalizedHours, minutes: normalizedMinutes },
    human: formatDuration(total),
  };
}

export function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return 'unknown';
  let remaining = Math.floor(value);
  const days = Math.floor(remaining / UNIT_MS.d);
  remaining -= days * UNIT_MS.d;
  const hours = Math.floor(remaining / UNIT_MS.h);
  remaining -= hours * UNIT_MS.h;
  const minutes = Math.floor(remaining / UNIT_MS.m);
  remaining -= minutes * UNIT_MS.m;
  const seconds = Math.floor(remaining / 1000);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!days && !hours && !minutes) parts.push(`${seconds}s`);
  return parts.join(' ');
}

export function parseDurationList(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => parseDurationList(entry));
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parseDuration(entry));
}

export { MAX_DURATION_MS, UNIT_MS };
