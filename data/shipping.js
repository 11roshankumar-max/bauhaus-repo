// Shiprocket integration for shipping rate quotes.
//
// Real mode: set SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD / SHIPROCKET_PICKUP_PINCODE
// in .env (a Shiprocket "API user" — create one under Settings > API in your
// Shiprocket dashboard, distinct from your login). Auth + serviceability
// endpoints below are confirmed against https://apidocs.shiprocket.in — the
// serviceability query params are the commonly-documented ones; re-verify
// against your dashboard's API docs since Shiprocket's public docs are a JS
// app that doesn't expose parameter tables to a plain fetch.
//
// Mock mode (no credentials): returns a flat, weight-tiered estimate so
// checkout has *something* to show. This is NOT a real courier quote —
// replace with real Shiprocket credentials before relying on it for
// actual export pricing.

const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL || '';
const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD || '';
const SHIPROCKET_PICKUP_PINCODE = process.env.SHIPROCKET_PICKUP_PINCODE || '';
const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external';

const isConfigured = Boolean(SHIPROCKET_EMAIL && SHIPROCKET_PASSWORD && SHIPROCKET_PICKUP_PINCODE);

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const res = await fetch(`${SHIPROCKET_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SHIPROCKET_EMAIL, password: SHIPROCKET_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Shiprocket auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.token;
  cachedTokenExpiresAt = Date.now() + 1000 * 60 * 60 * 24 * 9; // tokens last 10 days; refresh a day early
  return cachedToken;
}

// destination: { postcode, country } — country defaults to India-domestic serviceability;
// pass a non-IN country for export lanes (Shiprocket's international serviceability
// may need a different endpoint/params — verify once you have a live account).
async function getRealQuote({ postcode, weightGrams, codAmount = 0 }) {
  const token = await getToken();
  const params = new URLSearchParams({
    pickup_postcode: SHIPROCKET_PICKUP_PINCODE,
    delivery_postcode: postcode,
    weight: (weightGrams / 1000).toFixed(2), // Shiprocket expects kg
    cod: codAmount > 0 ? '1' : '0',
  });

  const res = await fetch(`${SHIPROCKET_BASE}/courier/serviceability/?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Shiprocket serviceability check failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  const couriers = data?.data?.available_courier_companies || [];
  if (couriers.length === 0) return { available: false, couriers: [] };

  const cheapest = couriers.reduce((min, c) => (c.rate < min.rate ? c : min), couriers[0]);
  return {
    available: true,
    estimated_cents: Math.round(cheapest.rate * 100),
    currency: 'inr', // Shiprocket domestic rates are INR; export lanes may differ
    courier: cheapest.courier_name,
    etaDays: cheapest.estimated_delivery_days || null,
    couriers,
  };
}

// Flat, weight-tiered placeholder — used until real Shiprocket credentials are set.
function getMockQuote({ weightGrams }) {
  const kg = weightGrams / 1000;
  let estimated_cents;
  if (kg <= 0.5) estimated_cents = 1200;
  else if (kg <= 1) estimated_cents = 1800;
  else if (kg <= 2) estimated_cents = 2800;
  else estimated_cents = 2800 + Math.ceil(kg - 2) * 900;

  return {
    available: true,
    estimated_cents,
    currency: 'usd',
    courier: 'Estimated (mock)',
    etaDays: null,
    mock: true,
  };
}

async function getShippingQuote({ postcode, weightGrams, codAmount = 0 }) {
  if (!isConfigured) return getMockQuote({ weightGrams });
  return getRealQuote({ postcode, weightGrams, codAmount });
}

module.exports = { getShippingQuote, isConfigured };
