const { db } = require('../data/db.js');

// Doc's formula: Score = Impact × Urgency × Project Size × Confidence × Bauhaus Fit.
// Every factor is a deterministic rule against fields we already have — no AI,
// consistent with the "plain rules first" decision for extraction. Each
// factor is a 0..1 multiplier with a floor so one weak factor doesn't zero
// out an otherwise-strong lead.
const FLOOR = 0.15;
const clamp = (n) => Math.max(FLOOR, Math.min(1, n));

const STAGE_URGENCY = {
  opening: 1.0,       // furniture window is now
  'fit-out': 0.85,
  procurement: 0.7,
  design: 0.5,
  construction: 0.3,
  planning: 0.15,
};

const FIT_SYNONYMS = {
  Hotels: ['hotel', 'hospitality', 'resort'],
  'Luxury Residential': ['luxury', 'villa', 'residential'],
  Architects: ['architect'],
  'Interior Designers': ['interior', 'design'],
  Clubs: ['club'],
  Restaurants: ['restaurant', 'dining', 'cafe', 'café'],
};

const LUXURY_BRANDS = ['marriott', 'hilton', 'hyatt', 'taj', 'oberoi', 'itc', 'leela', 'four seasons', 'sheraton', 'accor', 'ihg', 'westin', 'ritz'];
const COMMERCIAL_KEYWORDS = ['commercial', 'mall', 'retail', 'club', 'resort'];

function bauhausFit(opp, profile) {
  const haystack = `${opp.title} ${opp.industry} ${opp.location}`.toLowerCase();
  for (const category of profile.interested_in || []) {
    const synonyms = FIT_SYNONYMS[category] || [category.toLowerCase()];
    if (synonyms.some((s) => haystack.includes(s))) return { value: 1.0, reason: `matches "${category}"` };
  }
  // GeM tenders were fetched via a furniture-specific search query already —
  // they're relevant by construction even without a keyword hit here.
  if ((opp.source_ref || '').startsWith('gem:')) return { value: 0.9, reason: 'pre-filtered furniture/fit-out tender' };
  return { value: 0.35, reason: 'no direct match to industry profile' };
}

function urgency(stage) {
  const value = STAGE_URGENCY[stage] ?? 0.2;
  const reason = stage ? `stage "${stage}"` : 'stage unknown';
  return { value, reason };
}

function impact(opp) {
  const haystack = `${opp.title} ${opp.industry}`.toLowerCase();
  if (LUXURY_BRANDS.some((b) => haystack.includes(b))) return { value: 1.0, reason: 'recognized luxury brand' };
  if (COMMERCIAL_KEYWORDS.some((k) => haystack.includes(k))) return { value: 0.75, reason: 'commercial/hospitality project type' };
  return { value: 0.45, reason: 'unclassified project tier' };
}

// Only GeM tenders carry an explicit quantity; everything else has no reliable
// size signal yet, so it defaults to neutral rather than penalized.
function projectSize(opp) {
  if (!(opp.source_ref || '').startsWith('gem:')) return { value: 0.5, reason: 'no size data available' };
  const bidNumber = opp.source_ref.split(':')[1];
  const raw = db.prepare("SELECT payload_json FROM raw_events WHERE source_key = 'gem_tender' AND external_id = ?").get(bidNumber);
  if (!raw) return { value: 0.5, reason: 'no size data available' };
  const payload = JSON.parse(raw.payload_json);
  const qty = Array.isArray(payload.b_total_quantity) ? payload.b_total_quantity[0] : payload.b_total_quantity;
  if (!qty) return { value: 0.5, reason: 'no size data available' };
  if (qty >= 500) return { value: 1.0, reason: `large order quantity (${qty})` };
  if (qty >= 50) return { value: 0.7, reason: `medium order quantity (${qty})` };
  return { value: 0.4, reason: `small order quantity (${qty})` };
}

function confidenceFactor(opp) {
  const value = opp.confidence ?? 0.6;
  const reason = opp.confidence != null ? `${Math.round(opp.confidence * 100)}% source confidence` : 'no confidence recorded';
  return { value, reason };
}

function scoreOpportunity(opp, profile) {
  const fit = bauhausFit(opp, profile);
  const urg = urgency(opp.stage);
  const imp = impact(opp);
  const size = projectSize(opp);
  const conf = confidenceFactor(opp);

  const raw = clamp(fit.value) * clamp(urg.value) * clamp(imp.value) * clamp(size.value) * clamp(conf.value);
  const score = Math.max(1, Math.min(100, Math.round(raw * 100)));
  const reason = [imp.reason, urg.reason, fit.reason, size.reason, conf.reason].join(' · ');

  return { score, reason };
}

function scoreAll({ rescore = false } = {}) {
  const profile = db.prepare("SELECT config_json FROM industry_profiles WHERE name = 'Premium Furniture'").get();
  if (!profile) return { scored: 0, error: 'No industry profile found' };
  const config = JSON.parse(profile.config_json);

  const where = rescore ? '' : 'WHERE score IS NULL';
  const opportunities = db.prepare(`SELECT * FROM opportunities ${where}`).all();

  const update = db.prepare('UPDATE opportunities SET score = ?, score_reason = ? WHERE id = ?');
  const tx = db.transaction((rows) => {
    for (const opp of rows) {
      const { score, reason } = scoreOpportunity(opp, config);
      update.run(score, reason, opp.id);
    }
  });
  tx(opportunities);

  return { scored: opportunities.length };
}

module.exports = { scoreOpportunity, scoreAll };
