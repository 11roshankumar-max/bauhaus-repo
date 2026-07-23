require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const basicAuth = require('express-basic-auth');

const productsRouter = require('./routes/products.js');
const cartRouter = require('./routes/cart.js');
const checkoutRouter = require('./routes/checkout.js');
const stripeWebhookRouter = require('./routes/stripeWebhook.js');
const adminRouter = require('./routes/admin.js');
const shippingRouter = require('./routes/shipping.js');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Stripe webhook must get the RAW body for signature verification,
// so it's mounted BEFORE express.json() and given its own raw parser. ---
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookRouter);

app.use(express.json());
app.use(cookieParser());

// --- simple session-id cookie, used to key the in-memory cart ---
app.use((req, res, next) => {
  let sid = req.cookies.tb_session;
  if (!sid) {
    sid = crypto.randomUUID();
    res.cookie('tb_session', sid, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 });
  }
  req.sessionId = sid;
  next();
});

// --- protect the admin UI + admin API with HTTP Basic Auth ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const adminAuth = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASSWORD },
  challenge: true,
  realm: 'Taana Baana Admin',
});
app.use('/admin.html', adminAuth);
app.use('/api/admin', adminAuth);

// --- API routes ---
app.use('/api', productsRouter);
app.use('/api', cartRouter);
app.use('/api', checkoutRouter);
app.use('/api', adminRouter);
app.use('/api', shippingRouter);

// --- static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  const mode = process.env.STRIPE_SECRET_KEY ? 'Stripe (test mode if using test keys)' : 'MOCK / DEMO (no Stripe key set)';
  const shippingMode = process.env.SHIPROCKET_EMAIL ? 'Shiprocket (live rates)' : 'MOCK / ESTIMATE (no Shiprocket credentials set)';
  console.log(`\nTaana Baana store running at http://localhost:${PORT}`);
  console.log(`Payment mode: ${mode}`);
  console.log(`Shipping mode: ${shippingMode}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin.html  (user: ${ADMIN_USER})\n`);
});
