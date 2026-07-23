const Database = require('better-sqlite3');
const path = require('path');
const STATE_DATA = require('./statedata.module.js');
const { priceFor, stockFor, skuFor, weightFor } = require('./pricing.js');

const DB_PATH = path.join(__dirname, 'store.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS states (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      accent TEXT NOT NULL,
      tagline TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      state_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      stock INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      weight_grams INTEGER,
      hs_code TEXT, -- customs HS code; intentionally left NULL at seed time, see README ("Shipping & export")
      FOREIGN KEY(state_id) REFERENCES states(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed | cancelled
      payment_provider TEXT NOT NULL DEFAULT 'mock', -- mock | stripe
      provider_session_id TEXT,
      customer_email TEXT,
      customer_name TEXT,
      shipping_address TEXT,
      total_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      title TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );
  `);

  // products table pre-dates weight_grams/hs_code — add them if this DB was
  // seeded before shipping support existed.
  const productCols = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
  if (!productCols.includes('weight_grams')) {
    db.exec('ALTER TABLE products ADD COLUMN weight_grams INTEGER');
  }
  if (!productCols.includes('hs_code')) {
    db.exec('ALTER TABLE products ADD COLUMN hs_code TEXT');
  }
}

function backfillWeights() {
  const missing = db.prepare('SELECT id, category, title FROM products WHERE weight_grams IS NULL').all();
  if (missing.length === 0) return;
  const update = db.prepare('UPDATE products SET weight_grams = ? WHERE id = ?');
  const tx = db.transaction(() => {
    missing.forEach((p) => update.run(weightFor(p.category, p.title), p.id));
  });
  tx();
  console.log('Backfilled shipping weight for', missing.length, 'existing products.');
}

function seed() {
  const stateCount = db.prepare('SELECT COUNT(*) AS c FROM states').get().c;
  if (stateCount > 0) return; // already seeded

  const insertState = db.prepare(`
    INSERT INTO states (id, name, region, accent, tagline) VALUES (@id, @name, @region, @accent, @tagline)
  `);
  const insertProduct = db.prepare(`
    INSERT INTO products (id, sku, state_id, category, title, description, price_cents, currency, stock, weight_grams)
    VALUES (@id, @sku, @state_id, @category, @title, @description, @price_cents, @currency, @stock, @weight_grams)
  `);

  const tx = db.transaction(() => {
    Object.keys(STATE_DATA).forEach((stateId) => {
      const s = STATE_DATA[stateId];
      insertState.run({ id: stateId, name: s.name, region: s.region, accent: s.accent, tagline: s.tagline });

      s.crafts.forEach((c, idx) => {
        const id = `${stateId}-${idx}`;
        insertProduct.run({
          id,
          sku: skuFor(stateId, idx),
          state_id: stateId,
          category: c.category,
          title: c.title,
          description: c.desc,
          price_cents: priceFor(c.category, c.title),
          currency: 'usd',
          stock: stockFor(c.title),
          weight_grams: weightFor(c.category, c.title),
        });
      });
    });
  });
  tx();
  console.log('Seeded', db.prepare('SELECT COUNT(*) AS c FROM states').get().c, 'states and',
    db.prepare('SELECT COUNT(*) AS c FROM products').get().c, 'products.');
}

migrate();
seed();
backfillWeights();

module.exports = db;
