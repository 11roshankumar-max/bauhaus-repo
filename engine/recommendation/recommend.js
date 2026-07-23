const { db } = require('../data/db.js');

// Doc's UX target: "Don't call the hotel. Call the architect. Within 14
// days. Bring the hospitality catalogue." — one rule per stage, deterministic,
// same "plain rules first" approach as scoring and extraction.
const STAGE_RULES = {
  opening: {
    contact_role: 'General Manager / Owner',
    timing: 'Urgent — opening announced, furniture window is now',
    pitch: 'Offer expedited fulfillment for pre-opening furniture needs; lead with in-stock/quick-turnaround pieces',
  },
  'fit-out': {
    contact_role: 'Interior Fit-Out Contractor / Project Manager',
    timing: 'Immediately — fit-out is underway',
    pitch: 'Propose an FF&E supply timeline aligned to the fit-out schedule',
  },
  procurement: {
    contact_role: 'Procurement Officer / Buyer',
    timing: null, // computed per-opportunity from the GeM bid's own end date, see gemBidDeadline()
    pitch: 'Submit a competitive bid through the same GeM listing',
  },
  design: {
    contact_role: 'Architect / Design Consultant',
    timing: 'Within 14 days — specs are being finalized now',
    pitch: 'Share the catalogue and material samples; get on the approved-vendor list before drawings freeze',
  },
  construction: {
    contact_role: 'Developer / Project Head',
    timing: 'Low priority for now — revisit in 3–6 months as fit-out approaches',
    pitch: 'Introduce the catalogue early to get on the preferred-vendor shortlist',
  },
  planning: {
    contact_role: 'Developer (early-stage contact)',
    timing: 'Low priority — check back once the project reaches design/fit-out',
    pitch: 'General capability introduction, no urgency yet',
  },
};

const DEFAULT_RULE = {
  contact_role: 'Developer / General Contact',
  timing: 'Stage unclear — needs manual review before outreach',
  pitch: 'Verify project details before outreach',
};

function gemBidDeadline(opp) {
  if (!(opp.source_ref || '').startsWith('gem:')) return null;
  const bidNumber = opp.source_ref.split(':')[1];
  const raw = db.prepare("SELECT payload_json FROM raw_events WHERE source_key = 'gem_tender' AND external_id = ?").get(bidNumber);
  if (!raw) return null;
  const payload = JSON.parse(raw.payload_json);
  const endDate = Array.isArray(payload.final_end_date_sort) ? payload.final_end_date_sort[0] : payload.final_end_date_sort;
  return endDate || null;
}

function recommendFor(opp) {
  const rule = STAGE_RULES[opp.stage] || DEFAULT_RULE;
  let timing = rule.timing;
  if (opp.stage === 'procurement') {
    const deadline = gemBidDeadline(opp);
    timing = deadline
      ? `Before the tender closes on ${new Date(deadline).toISOString().slice(0, 10)}`
      : 'Check the GeM listing for the exact bid deadline';
  }
  return { contact_role: rule.contact_role, timing, pitch: rule.pitch };
}

function recommendAll({ recompute = false } = {}) {
  const where = recompute ? '' : 'WHERE rec_contact_role IS NULL';
  const opportunities = db.prepare(`SELECT * FROM opportunities ${where}`).all();

  const update = db.prepare('UPDATE opportunities SET rec_contact_role = ?, rec_timing = ?, rec_pitch = ? WHERE id = ?');
  const tx = db.transaction((rows) => {
    for (const opp of rows) {
      const rec = recommendFor(opp);
      update.run(rec.contact_role, rec.timing, rec.pitch, opp.id);
    }
  });
  tx(opportunities);

  return { recommended: opportunities.length };
}

module.exports = { recommendFor, recommendAll };
