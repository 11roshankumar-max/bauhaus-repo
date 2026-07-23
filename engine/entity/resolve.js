const { db } = require('../data/db.js');

// Legal-entity suffixes only — NOT descriptive words like "Hotels"/"Resorts"/
// "Group", which carry brand meaning and would cause false merges if stripped
// (e.g. "Lords Hotels" and "Leela Hotels" must stay distinct).
const LEGAL_SUFFIXES = [
  'private limited', 'pvt ltd', 'pvt. ltd.', 'limited', 'ltd', 'llp',
  'inc', 'incorporated', 'corp', 'corporation', 'co\\.',
];
const SUFFIX_RE = new RegExp(`\\b(${LEGAL_SUFFIXES.join('|')})\\b`, 'gi');

// Generic corporate/government filler words — without stripping these,
// "Department of Consumer Affairs" and "Department of Military Affairs"
// score 0.6 similar on shared tokens alone, despite being unrelated entities.
// Erring toward stripping too much (missing a real duplicate) rather than
// too little (suggesting a false merge), since a bad merge corrupts data and
// a missed one just leaves a duplicate in place.
const STOPWORDS = new Set([
  'department', 'affairs', 'ministry', 'government', 'private', 'limited',
  'llp', 'pvt', 'ltd', 'and', 'of', 'the', 'properties', 'ventures',
  'infrastructure', 'realty', 'projects', 'group', 'india', 'housing',
  'developers', 'builders', 'construction', 'constructions', 'corporation',
]);

function normalize(name) {
  return name
    .toLowerCase()
    .replace(SUFFIX_RE, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(name) {
  return new Set(normalize(name).split(' ').filter((t) => t && !STOPWORDS.has(t)));
}

function jaccard(a, b) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

// Deliberately conservative (higher than a typical fuzzy-match default)
// because these are corporate legal names — a false merge silently corrupts
// two real, distinct companies into one.
const SIMILARITY_THRESHOLD = 0.6;

// O(n^2) pairwise comparison — fine at hundreds of companies; would need a
// blocking/indexing strategy (e.g. by first token) before this scales past
// a few thousand.
function scanForMerges() {
  const companies = db.prepare('SELECT id, name FROM companies ORDER BY id').all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO company_merge_suggestions (company_a_id, company_b_id, similarity)
    VALUES (@a, @b, @sim)
  `);
  let found = 0;

  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const a = companies[i];
      const b = companies[j];
      if (normalize(a.name) === normalize(b.name)) continue; // already exact-match, wouldn't have been duplicated
      const sim = jaccard(a.name, b.name);
      if (sim >= SIMILARITY_THRESHOLD) {
        const result = insert.run({ a: a.id, b: b.id, sim });
        if (result.changes > 0) found += 1;
      }
    }
  }
  return { scanned: companies.length, suggested: found };
}

function listPending() {
  return db.prepare(`
    SELECT s.id, s.similarity, s.created_at,
           a.id AS company_a_id, a.name AS company_a_name,
           b.id AS company_b_id, b.name AS company_b_name
    FROM company_merge_suggestions s
    JOIN companies a ON a.id = s.company_a_id
    JOIN companies b ON b.id = s.company_b_id
    WHERE s.status = 'pending'
    ORDER BY s.similarity DESC
  `).all();
}

function confirmMerge(suggestionId) {
  const suggestion = db.prepare('SELECT * FROM company_merge_suggestions WHERE id = ?').get(suggestionId);
  if (!suggestion) return { error: 'Suggestion not found' };
  const { company_a_id: keepId, company_b_id: dropId } = suggestion;

  const tx = db.transaction(() => {
    db.prepare('UPDATE opportunities SET company_id = ? WHERE company_id = ?').run(keepId, dropId);
    db.prepare('UPDATE contacts SET company_id = ? WHERE company_id = ?').run(keepId, dropId);
    // status updates (including this suggestion's own row, which still
    // points at dropId) must happen before the DELETE below, or the FK from
    // company_merge_suggestions -> companies blocks removing dropId.
    db.prepare("UPDATE company_merge_suggestions SET status = 'confirmed' WHERE id = ?").run(suggestionId);
    db.prepare("UPDATE company_merge_suggestions SET status = 'obsolete' WHERE status = 'pending' AND (company_a_id = ? OR company_b_id = ?)").run(dropId, dropId);
    db.prepare('DELETE FROM companies WHERE id = ?').run(dropId);
  });
  tx();
  return { merged: true, keptCompanyId: keepId, removedCompanyId: dropId };
}

function rejectMerge(suggestionId) {
  const result = db.prepare("UPDATE company_merge_suggestions SET status = 'rejected' WHERE id = ?").run(suggestionId);
  return { rejected: result.changes > 0 };
}

module.exports = { scanForMerges, listPending, confirmMerge, rejectMerge };
