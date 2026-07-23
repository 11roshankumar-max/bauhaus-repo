const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'engine.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// CRM funnel — fixed for the dashboard's kanban columns (see architecture doc).
const OPPORTUNITY_STATUSES = ['new', 'contacted', 'meeting', 'proposal', 'won', 'lost'];

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT,
      website TEXT,
      city TEXT,
      country TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      role TEXT,
      email TEXT,
      phone TEXT,
      linkedin TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      industry TEXT,
      company_id INTEGER,
      location TEXT,
      stage TEXT,
      score INTEGER,
      confidence REAL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );

    -- One opportunity accumulates signals over time (new_project today,
    -- architect_appointed in 6 weeks, opening_announced in 8 months) — the
    -- UNIQUE constraint means re-detecting the same signal on an unchanged
    -- re-run is a no-op instead of spamming duplicate rows.
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL,
      signal_type TEXT NOT NULL,
      source TEXT,
      evidence TEXT,
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      confidence REAL,
      UNIQUE(opportunity_id, signal_type)
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      type TEXT,
      last_checked TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      notes TEXT,
      user TEXT,
      date TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
    );

    -- Scoring stays data-driven per industry instead of hardcoded rules —
    -- swap/add a profile to retarget the whole engine at a new vertical.
    CREATE TABLE IF NOT EXISTS industry_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Every fetched item lands here first, verbatim, before any extraction —
    -- source_key + external_id de-dupes re-fetches of the same RERA project /
    -- GeM bid / news article across runs.
    CREATE TABLE IF NOT EXISTS raw_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT,
      url TEXT,
      payload_json TEXT NOT NULL,
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(source_key, external_id)
    );

    -- Entity resolution proposes merges here for a human to confirm/reject —
    -- auto-merging on a fuzzy name match risks silently corrupting two real,
    -- distinct companies into one. No FK here on purpose: confirming a merge
    -- deletes the losing company row, and this table should still hold that
    -- as history afterward instead of being blocked by (or cascading away)
    -- the constraint.
    CREATE TABLE IF NOT EXISTS company_merge_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_a_id INTEGER NOT NULL,
      company_b_id INTEGER NOT NULL,
      similarity REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(company_a_id, company_b_id)
    );
  `);

  // Earlier version of this table declared FKs on company_a_id/company_b_id,
  // which then blocks confirmMerge()'s DELETE FROM companies. Drop and
  // recreate if an old copy is still around — it only holds regenerable
  // suggestion state, never opportunity/company data.
  const suggestionsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='company_merge_suggestions'").get();
  if (suggestionsSchema && suggestionsSchema.sql.includes('REFERENCES')) {
    db.exec('DROP TABLE company_merge_suggestions');
    db.exec(`
      CREATE TABLE company_merge_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_a_id INTEGER NOT NULL,
        company_b_id INTEGER NOT NULL,
        similarity REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(company_a_id, company_b_id)
      );
    `);
  }

  // Earlier version of signals had no UNIQUE(opportunity_id, signal_type) and
  // an FK that would block opportunity deletion — recreate if still old
  // (table is unused so far, so this is a zero-data-loss migration).
  const signalsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='signals'").get();
  if (signalsSchema && !signalsSchema.sql.includes('UNIQUE(opportunity_id')) {
    db.exec('DROP TABLE signals');
    db.exec(`
      CREATE TABLE signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id INTEGER NOT NULL,
        signal_type TEXT NOT NULL,
        source TEXT,
        evidence TEXT,
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        confidence REAL,
        UNIQUE(opportunity_id, signal_type)
      );
    `);
  }

  // opportunities pre-dates ingestion — add source_ref so a re-run can tell
  // "already created an opportunity for this raw event" and skip duplicates,
  // and score_reason so the scorer can explain a number, not just produce one.
  const oppCols = db.prepare("PRAGMA table_info(opportunities)").all().map((c) => c.name);
  if (!oppCols.includes('source_ref')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN source_ref TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_source_ref ON opportunities(source_ref) WHERE source_ref IS NOT NULL');
  }
  if (!oppCols.includes('score_reason')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN score_reason TEXT');
  }
  if (!oppCols.includes('rec_contact_role')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN rec_contact_role TEXT');
    db.exec('ALTER TABLE opportunities ADD COLUMN rec_timing TEXT');
    db.exec('ALTER TABLE opportunities ADD COLUMN rec_pitch TEXT');
  }
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM industry_profiles').get().c;
  if (count > 0) return;

  db.prepare('INSERT INTO industry_profiles (name, config_json) VALUES (?, ?)').run(
    'Premium Furniture',
    JSON.stringify({
      interested_in: ['Hotels', 'Luxury Residential', 'Architects', 'Interior Designers', 'Clubs', 'Restaurants'],
      preferred_stages: ['design', 'fit-out', 'procurement'],
      priority_signals: ['architect_appointed', 'ffe_hiring', 'opening_announced'],
    })
  );
  console.log('Seeded 1 industry profile.');
}

function seedSources() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM sources').get().c;
  if (count > 0) return;

  const insert = db.prepare('INSERT INTO sources (url, type, status) VALUES (?, ?, ?)');
  insert.run('https://rera.karnataka.gov.in/projectViewDetails', 'rera', 'active');
  insert.run('https://bidplus.gem.gov.in/all-bids-data', 'gem_tender', 'active');
  insert.run('https://news.google.com/rss/search', 'news', 'active');
  console.log('Seeded 3 sources.');
}

migrate();
seed();
seedSources();

module.exports = { db, OPPORTUNITY_STATUSES };
