// Deterministic pricing so re-seeding never changes prices.
// Prices are placeholders — swap for real per-artisan pricing before going live.

const CATEGORY_PRICE_RANGE = {
  "Handloom & Weave":            [6500, 22000],  // cents (USD)
  "Embroidery & Textile Art":    [4000, 14000],
  "Painting & Folk Art":         [3500, 15000],
  "Metal, Wood & Clay":          [2000, 9000],
  "Dye & Print":                 [3000, 7000],
};

// Placeholder shipping weights, grams — textiles are light, metal/wood/clay are heavy.
// Swap for real measured weights per product before relying on this for live courier rates.
const CATEGORY_WEIGHT_RANGE = {
  "Handloom & Weave":            [150, 600],
  "Embroidery & Textile Art":    [100, 400],
  "Painting & Folk Art":         [200, 1200],
  "Metal, Wood & Clay":          [300, 2500],
  "Dye & Print":                 [100, 500],
};

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function priceFor(category, title) {
  const range = CATEGORY_PRICE_RANGE[category] || [3000, 8000];
  const h = hashStr(title);
  const span = range[1] - range[0];
  const price = range[0] + (h % span);
  // round to nearest 100 cents ($1) for cleaner price tags
  return Math.round(price / 100) * 100;
}

function stockFor(title) {
  const h = hashStr(title + "-stock");
  return 6 + (h % 35); // 6..40 units
}

function weightFor(category, title) {
  const range = CATEGORY_WEIGHT_RANGE[category] || [150, 800];
  const h = hashStr(title + "-weight");
  const span = range[1] - range[0];
  return range[0] + (h % span); // grams
}

function skuFor(stateId, idx) {
  return (stateId + "-" + idx).toUpperCase();
}

module.exports = { priceFor, stockFor, skuFor, weightFor, hashStr };
