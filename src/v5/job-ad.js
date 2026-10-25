/**
 * MAJIN V5 — shared job-ad normalization and grounded qualification vocabulary.
 *
 * Platsbanken, the older V1 tools and the V5 workflow use different names for
 * the same fields. This module is the lossless boundary between them. Model
 * extraction is optional; normalization and evidence checks stay deterministic.
 */

export function foldJobText(value = '') {
  return String(value ?? '')
    .toLowerCase()
    .replace(/c\s*#/g, ' csharp ')
    .replace(/\.net\b/g, ' dotnet ')
    .replace(/\bnode\s*\.\s*js\b/g, ' node js ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ø]/g, 'o')
    .replace(/[æ]/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const skill = (id, aliases) => ({ id, aliases: [...new Set([id, ...aliases])] });

/** Input vocabulary only. Unknown labels are preserved, never discarded. */
export const JOB_SKILL_CATALOG = Object.freeze([
  skill('javascript', ['js', 'ecmascript']),
  skill('typescript', ['ts']),
  skill('node.js', ['node', 'nodejs', 'node js']),
  skill('react', ['reactjs', 'react js']),
  skill('angular', ['angularjs']),
  skill('vue', ['vuejs', 'vue js']),
  skill('svelte', []),
  skill('html', ['html5', 'html markup', 'html marksprak']), // input vocabulary, never rendered
  skill('css', ['css3', 'sass', 'scss', 'tailwind']),
  skill('python', []),
  skill('java', ['spring boot', 'springboot']),
  skill('c#', ['csharp', 'c sharp']),
  skill('.net', ['dotnet', 'asp net']),
  skill('php', ['laravel', 'symfony']),
  skill('go', ['golang']),
  skill('rust', []),
  skill('kotlin', []),
  skill('swift', ['ios']),
  skill('sql', ['t sql']),
  skill('postgresql', ['postgres', 'postgre sql']),
  skill('mysql', []),
  skill('mongodb', ['mongo']),
  skill('docker', []),
  skill('kubernetes', ['k8s']),
  skill('terraform', []),
  skill('aws', ['amazon web services']),
  skill('azure', ['microsoft azure']),
  skill('gcp', ['google cloud', 'google cloud platform']),
  skill('git', ['github', 'gitlab', 'bitbucket']),
  skill('linux', ['red hat', 'redhat', 'ubuntu', 'debian']),
  skill('windows', ['windows server']),
  skill('graphql', []),
  skill('rest', ['rest api', 'restapi', 'restful']),
  skill('playwright', []),
  skill('testing', ['testning', 'test automation', 'testautomatisering', 'jest', 'pytest', 'junit', 'cypress', 'selenium']), // input vocabulary, never rendered
  skill('ci/cd', ['ci cd', 'continuous integration', 'github actions', 'gitlab ci', 'jenkins']),
  skill('scrum', ['agile', 'agilt', 'agil', 'kanban']), // input vocabulary, never rendered
  skill('figma', []),
  skill('svenska', ['swedish', 'svenskt sprak', 'svenska i tal och skrift']), // input vocabulary, never rendered
  skill('engelska', ['english', 'engelska i tal och skrift']), // input vocabulary, never rendered
  skill('finska', ['finnish']), // input vocabulary, never rendered
  skill('norska', ['norwegian']), // input vocabulary, never rendered
  skill('danska', ['danish']), // input vocabulary, never rendered
  skill('tyska', ['german']), // input vocabulary, never rendered
  skill('körkort', ['korkort', 'driving license', 'driving licence']), // input vocabulary, never rendered
  skill('b-körkort', ['b korkort', 'korkort b', 'driving license b', 'driving licence b']), // input vocabulary, never rendered
  skill('c-körkort', ['c korkort', 'c behörighet', 'c behorighet', 'c kort']), // input vocabulary, never rendered
  skill('ce-körkort', ['ce korkort', 'ce behörighet', 'ce behorighet', 'ce kort', 'ce chauffor', 'ce chaufför']), // input vocabulary, never rendered
  skill('ykb', ['yrkeskompetensbevis', 'yrkeskompetensbevis for forare', 'giltigt ykb']), // input vocabulary, never rendered
  skill('digitalt förarkort', ['digitalt forarkort', 'digital driver card']), // input vocabulary, never rendered
  skill('truckkort', ['truckkort a', 'truckkort b', 'forklift licence', 'forklift license']), // input vocabulary, never rendered
  skill('legitimerad sjuksköterska', ['sjuksköterskelegitimation', 'legitimerad sjukskoterska', 'registered nurse', 'rn license']), // input vocabulary, never rendered
  skill('sjuksköterska', ['sjukskoterska', 'nurse']), // input vocabulary, never rendered
  skill('undersköterska', ['underskoterska', 'assistant nurse']), // input vocabulary, never rendered
  skill('geriatrik', ['geriatrics', 'äldrevård', 'aldrevard']), // input vocabulary, never rendered
  skill('demensvård', ['demensvard', 'dementia care']), // input vocabulary, never rendered
  skill('psykiatri', ['psychiatry', 'psychiatric care']), // input vocabulary, never rendered
  skill('lss', ['lss kunskap']), // input vocabulary, never rendered
  skill('excel', ['microsoft excel', 'avancerad excel']),
  skill('redovisning', ['accounting', 'bokföring', 'bokforing']), // input vocabulary, never rendered
  skill('ekonomi', ['finance', 'economics']), // input vocabulary, never rendered
  skill('sap', ['sap erp', 'sap s 4hana']),
  skill('power bi', ['powerbi']),
  skill('kundtjänst', ['kundtjanst', 'customer service', 'customer support']), // input vocabulary, never rendered
  skill('försäljning', ['forsaljning', 'sales']), // input vocabulary, never rendered
]);

export const LANGUAGE_SKILL_IDS = Object.freeze(['svenska', 'engelska', 'finska', 'norska', 'danska', 'tyska']); // input vocabulary, never rendered

const FOLDED_CATALOG = JOB_SKILL_CATALOG.map((entry) => ({
  id: entry.id,
  foldedId: foldJobText(entry.id),
  aliases: entry.aliases.map(foldJobText).filter(Boolean).sort((a, b) => b.length - a.length),
}));

function containsFolded(haystack, needle) {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/** Map a taxonomy label or free-form skill to a stable ID without inventing one. */
export function canonicalSkillName(value = '') {
  const folded = foldJobText(value);
  if (!folded) return '';
  for (const entry of FOLDED_CATALOG) {
    if (entry.foldedId === folded || entry.aliases.includes(folded)) return entry.id;
  }
  for (const entry of FOLDED_CATALOG) {
    if (entry.aliases.some((alias) => containsFolded(folded, alias))) return entry.id;
  }
  return folded;
}

/** Extract only explicit mentions. A job title alone never proves a CV skill. */
export function extractSkillMentions(text = '') {
  const folded = foldJobText(text);
  if (!folded) return [];
  const hits = [];
  for (const entry of FOLDED_CATALOG) {
    if (entry.aliases.some((alias) => containsFolded(folded, alias))) hits.push(entry.id);
  }
  return [...new Set(hits)];
}

/** A required skill may be satisfied by an explicitly equivalent CV qualification. */
export function skillSatisfied(required, available) {
  const req = canonicalSkillName(required);
  if (!req) return true;
  if (available.has(req)) return true;
  if (req === 'sql' && ['postgresql', 'mysql'].some((id) => available.has(id))) return true;
  if (req === 'körkort' && ['b-körkort', 'c-körkort', 'ce-körkort'].some((id) => available.has(id))) return true; // input vocabulary, never rendered
  if (req === 'c-körkort' && available.has('ce-körkort')) return true; // input vocabulary, never rendered
  if (req === 'ce-körkort' && available.has('c-körkort')) return false; // input vocabulary, never rendered
  return false;
}

export function isKnownSkillId(id) {
  return JOB_SKILL_CATALOG.some((entry) => entry.id === id);
}

function stringList(value) {
  const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  return [...new Set(list.map((item) => {
    if (item && typeof item === 'object') return String(item.label || item.name || '').trim();
    return String(item ?? '').trim();
  }).filter(Boolean))];
}

/**
 * Convert V1 Platsbanken jobs, raw API hits and native V5 ads to one shape.
 * Existing fields are retained so source URLs, application channels and evidence
 * survive the boundary. No requirement arrays are fabricated from empty tags.
 */
export function normalizeJobAd(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const hit = raw.hit && typeof raw.hit === 'object' ? raw.hit : raw;
  const wp = hit.workplace_address || {};
  const employer = hit.employer || {};
  const description = typeof hit.description === 'object' ? hit.description?.text : hit.description;
  const mustGroup = hit.must_have || {};
  const niceGroup = hit.nice_to_have || {};
  const mustHave = stringList(hit.requiredSkills).length
    ? stringList(hit.requiredSkills)
    : stringList(hit.mustHave).length
      ? stringList(hit.mustHave)
      : stringList(mustGroup.skills);
  const niceToHave = stringList(hit.preferredSkills).length
    ? stringList(hit.preferredSkills)
    : stringList(hit.niceToHave).length
      ? stringList(hit.niceToHave)
      : stringList(niceGroup.skills);
  const requiredLanguages = stringList(mustGroup.languages);
  const preferredLanguages = stringList(niceGroup.languages);
  const driving = hit.driving_license_required ? stringList(hit.driving_license).map((label) => {
    if (/^c$/i.test(label)) return 'C-körkort'; // input vocabulary, never rendered
    if (/^ce$/i.test(label)) return 'CE-körkort'; // input vocabulary, never rendered
    if (/^b$/i.test(label)) return 'B-körkort'; // input vocabulary, never rendered
    return label;
  }) : [];

  return {
    ...hit,
    id: String(hit.id || hit.siteId || `job-${stableTinyId(hit.webpage_url || hit.url || `${hit.headline || hit.title}:${employer.name || hit.company || ''}`)}`),
    siteId: hit.siteId == null && hit.id != null ? String(hit.id) : hit.siteId,
    title: String(hit.title || hit.headline || 'Untitled Role'),
    employer: String(hit.employer?.name || hit.company || (typeof hit.employer === 'string' ? hit.employer : '') || 'Unknown Employer'),
    company: String(hit.company || employer.name || (typeof hit.employer === 'string' ? hit.employer : '') || ''),
    location: String(hit.location || hit.city || wp.city || wp.municipality || employer.workplace || ''),
    city: hit.city || wp.city || wp.municipality || null,
    url: hit.url || hit.webpage_url || null,
    description: String(description || ''),
    requiredSkills: [...mustHave, ...requiredLanguages, ...driving],
    preferredSkills: [...niceToHave, ...preferredLanguages],
    mustHave: [...mustHave, ...requiredLanguages, ...driving],
    niceToHave: [...niceToHave, ...preferredLanguages],
    requirementsSource: hit.requirementsSource || (mustHave.length || requiredLanguages.length || driving.length || niceToHave.length || preferredLanguages.length ? 'structured' : 'unstructured'),
    noRequirements: hit.noRequirements === true,
  };
}

function stableTinyId(value) {
  let hash = 2166136261;
  for (const ch of String(value || 'job')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function hasStructuredRequirements(ad = {}) {
  return (Array.isArray(ad.requiredSkills) && ad.requiredSkills.length > 0)
    || (Array.isArray(ad.preferredSkills) && ad.preferredSkills.length > 0);
}

export function jobAdEvidenceText(ad = {}) {
  return [
    ad.title,
    ad.description,
    ...(ad.requiredSkills || []),
    ...(ad.preferredSkills || []),
  ].filter(Boolean).join('\n');
}

/** Evidence quotes must occur in the actual ad, modulo whitespace/case only. */
export function evidenceOccursInAd(evidence, ad = {}) {
  const needle = String(evidence || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!needle || needle.length < 2) return false;
  const haystack = jobAdEvidenceText(ad).trim().replace(/\s+/g, ' ').toLowerCase();
  return haystack.includes(needle);
}
