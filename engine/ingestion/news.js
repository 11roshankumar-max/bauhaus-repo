const cheerio = require('cheerio');
const { storeRawEvent, getOrCreateCompany, upsertOpportunity, recordSignal, markSourceChecked } = require('./lib.js');

const SOURCE_KEY = 'news';
const UA = 'Mozilla/5.0 (compatible; BauhausEngine/1.0)';

// Google News RSS search — public, no key needed. Queries are geo-scoped to
// the target market so every hit is at least topically relevant.
const QUERIES = [
  'hotel opening Bengaluru',
  'hotel construction Bengaluru',
  'architect appointed hotel Bengaluru',
  'resort Karnataka opening',
];

// Unstructured text needs real extraction, but rule-based (not AI) per the
// current milestone. This is a lexicon match, not NLP — it will miss brands
// not on the list and can mis-hit on ambiguous names. Good enough to route,
// not to trust blindly (hence the low confidence score below).
const HOSPITALITY_BRANDS = [
  'Marriott', 'Hilton', 'Hyatt', 'Taj', 'Oberoi', 'ITC', 'Radisson', 'Accor',
  'IHG', 'Leela', 'Four Seasons', 'Sheraton', 'Novotel', 'Lemon Tree', 'OYO',
  'Treebo', 'Ginger', 'Courtyard', 'Westin', 'Holiday Inn', 'Ibis',
];

const STAGE_PATTERNS = [
  [/\b(open(s|ing|ed)?|launch(es|ing|ed)?|unveil(s|ed|ing)?)\b/i, 'opening'],
  [/\b(break(s|ing)? ground|foundation stone|construction begins)\b/i, 'construction'],
  [/\b(fit[- ]?out|renovat\w*|interior work)\b/i, 'fit-out'],
  [/\b(architect appointed|design unveiled|announces design)\b/i, 'design'],
];

function detectBrand(title) {
  return HOSPITALITY_BRANDS.find((brand) => title.toLowerCase().includes(brand.toLowerCase())) || null;
}

function detectStage(title) {
  const hit = STAGE_PATTERNS.find(([re]) => re.test(title));
  return hit ? hit[1] : null;
}

const SIGNAL_BY_STAGE = {
  opening: 'opening_announced',
  design: 'architect_appointed',
  'fit-out': 'renovation_announced',
  construction: 'construction_started',
};

async function fetchQuery(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`News fetch failed for "${query}": ${res.status}`);
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('item').map((_, item) => ({
    title: $(item).find('title').first().text(),
    link: $(item).find('link').first().text(),
    guid: $(item).find('guid').first().text(),
    pubDate: $(item).find('pubDate').first().text(),
    source: $(item).find('source').first().text(),
  })).get();
}

async function run() {
  const summary = { fetched: 0, stored: 0, opportunities: 0, queries: QUERIES };

  for (const query of QUERIES) {
    const items = await fetchQuery(query);
    summary.fetched += items.length;

    for (const item of items) {
      const externalId = item.guid || item.link;
      if (!externalId) continue;

      const isNew = storeRawEvent({
        sourceKey: SOURCE_KEY,
        externalId,
        title: item.title,
        url: item.link,
        payload: item,
      });
      if (isNew) summary.stored += 1;

      const brand = detectBrand(item.title);
      if (!brand) continue; // no recognizable company — leave as an unprocessed raw event for manual review

      const stage = detectStage(item.title);
      const companyId = getOrCreateCompany(brand, { type: 'hotel', country: 'India' });
      const { created, id: opportunityId } = upsertOpportunity(`news:${externalId}`, {
        title: item.title,
        industry: 'Hospitality',
        company_id: companyId,
        location: 'Bengaluru, Karnataka',
        stage,
        confidence: 0.35, // headline keyword match only — needs human triage
      });
      if (created) summary.opportunities += 1;

      const signalType = SIGNAL_BY_STAGE[stage];
      if (signalType) {
        recordSignal(opportunityId, signalType, { source: 'news', evidence: item.title, confidence: 0.35 });
      }
    }
  }
  markSourceChecked('https://news.google.com/rss/search');
  return summary;
}

module.exports = { run };
