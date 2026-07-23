const { db } = require('../data/db.js');

// source_key + external_id is the de-dupe key for what's already been fetched.
function storeRawEvent({ sourceKey, externalId, title, url, payload }) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO raw_events (source_key, external_id, title, url, payload_json)
    VALUES (@sourceKey, @externalId, @title, @url, @payload)
  `).run({
    sourceKey,
    externalId,
    title: title || null,
    url: url || null,
    payload: JSON.stringify(payload),
  });
  return result.changes > 0; // true only if this row is new
}

function getOrCreateCompany(name, extra = {}) {
  if (!name) return null;
  const existing = db.prepare('SELECT id FROM companies WHERE lower(name) = lower(?)').get(name);
  if (existing) return existing.id;
  const result = db.prepare(`
    INSERT INTO companies (name, type, city, country) VALUES (@name, @type, @city, @country)
  `).run({ name, type: extra.type || null, city: extra.city || null, country: extra.country || null });
  return result.lastInsertRowid;
}

// source_ref (e.g. "rera:PRM/KA/...") makes this idempotent per raw event.
// Unlike a plain "insert if new", a re-run that finds the opportunity already
// exists but has since moved to a new stage (e.g. RERA "approved" ->
// "applied for completion") updates it in place — otherwise stage progression
// over time would never be reflected after the first ingest.
function upsertOpportunity(sourceRef, fields) {
  const existing = db.prepare('SELECT * FROM opportunities WHERE source_ref = ?').get(sourceRef);

  if (!existing) {
    const result = db.prepare(`
      INSERT INTO opportunities (title, industry, company_id, location, stage, confidence, status, source_ref)
      VALUES (@title, @industry, @company_id, @location, @stage, @confidence, 'new', @sourceRef)
    `).run({
      title: fields.title,
      industry: fields.industry || null,
      company_id: fields.company_id || null,
      location: fields.location || null,
      stage: fields.stage || null,
      confidence: fields.confidence ?? null,
      sourceRef,
    });
    return { created: true, updated: false, id: result.lastInsertRowid };
  }

  if (fields.stage && fields.stage !== existing.stage) {
    db.prepare(`
      UPDATE opportunities SET stage = ?, confidence = ?, updated_at = datetime('now') WHERE id = ?
    `).run(fields.stage, fields.confidence ?? existing.confidence, existing.id);
    return { created: false, updated: true, id: existing.id };
  }

  return { created: false, updated: false, id: existing.id };
}

// Signals are the audit trail behind a stage — "why does this say fit-out?"
// answers with a dated, sourced event instead of just a current snapshot.
// UNIQUE(opportunity_id, signal_type) makes re-detecting the same signal on
// an unchanged re-run a no-op rather than duplicate rows.
function recordSignal(opportunityId, signalType, { source, evidence, confidence } = {}) {
  if (!opportunityId || !signalType) return false;
  const result = db.prepare(`
    INSERT OR IGNORE INTO signals (opportunity_id, signal_type, source, evidence, confidence)
    VALUES (@opportunityId, @signalType, @source, @evidence, @confidence)
  `).run({
    opportunityId,
    signalType,
    source: source || null,
    evidence: evidence || null,
    confidence: confidence ?? null,
  });
  return result.changes > 0;
}

function markSourceChecked(url) {
  db.prepare("UPDATE sources SET last_checked = datetime('now') WHERE url = ?").run(url);
}

module.exports = { storeRawEvent, getOrCreateCompany, upsertOpportunity, recordSignal, markSourceChecked };
