const POSITIVE = /(content|social media|some[- ]|so-me|videograf|videorediger|rediger|video editor|videographer|video producer|video creator|creator|creative|strateg|presse|talskrivare|marketing|marknad|kommunik|communication|copywriter|influencer|ugc|community|digital redakt|redaktör|redaktor|media production|medieproduktion|grafisk|designer|e-commerce|ecommerce|\bpr\b|event coordinator|content producer)/i;
const NEGATIVE = /(senior|manager|\blead\b|projektleder|director|chief|officer|head\b|chef\b|project|automation|analyst|product designer|ui designer|student|studentermedhj|praktik|intern\b|trainee|sales|account manager|store manager|assistant store|massage|cleaner|driver|therapist|warehouse|tour guide|travel counselor|nurse|teacher|accountant|engineer|developer|technician|receptionist|waiter|barista|security|logistics|caregiver|fisioterap|physio|optician|dentist|pharmac|lawyer|jurist|økonom|artist|\b3d\b|game|nutrition|fysiolog|näringsfysiolog|relocate|greece|abroad)/i;

export function roleRelevance(title, description = '') {
  const value = String(title || '');
  const full = `${value} ${String(description || '')}`;
  if (!value.trim()) return { relevant: false, reason: 'EMPTY_TITLE' };
  if (NEGATIVE.test(value)) return { relevant: false, reason: 'EXCLUDED_ROLE_SENIORITY_OR_DOMAIN' };
  if (/(plc|hmi|industrial automation|industrial application|electrical engineering|embedded software|software development|1st[- ]line|it-tekniker|network engineer|cyber ?security)/i.test(full)) return { relevant: false, reason: 'WRONG_CANDIDATE_KRISTJAN_IT_OR_PLC' };
  if (!POSITIVE.test(value)) return { relevant: false, reason: 'NOT_CONTENT_SOCIAL_MEDIA_OR_COMMUNICATION' };
  return { relevant: true, reason: null };
}
