require('dotenv').config();
const express = require('express');
const path = require('path');
const basicAuth = require('express-basic-auth');

const opportunitiesRouter = require('./routes/opportunities.js');
const companiesRouter = require('./routes/companies.js');
const contactsRouter = require('./routes/contacts.js');
const profilesRouter = require('./routes/profiles.js');
const rawEventsRouter = require('./routes/rawEvents.js');
const ingestRouter = require('./routes/ingest.js');
const scoreRouter = require('./routes/score.js');
const mergesRouter = require('./routes/merges.js');
const recommendRouter = require('./routes/recommend.js');
const { runAll } = require('./ingestion/run.js');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

// --- entire engine is internal — gate everything behind basic auth ---
const ENGINE_USER = process.env.ENGINE_USER || 'admin';
const ENGINE_PASSWORD = process.env.ENGINE_PASSWORD || 'changeme';
app.use(basicAuth({
  users: { [ENGINE_USER]: ENGINE_PASSWORD },
  challenge: true,
  realm: 'Bauhaus Engine',
}));

app.use('/api', opportunitiesRouter);
app.use('/api', companiesRouter);
app.use('/api', contactsRouter);
app.use('/api', profilesRouter);
app.use('/api', rawEventsRouter);
app.use('/api', ingestRouter);
app.use('/api', scoreRouter);
app.use('/api', mergesRouter);
app.use('/api', recommendRouter);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/dashboard.html'));
app.get('/health', (req, res) => res.json({ ok: true }));

const INGEST_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

app.listen(PORT, () => {
  console.log(`\nBauhaus engine running at http://localhost:${PORT}`);
  console.log(`Login: ${ENGINE_USER} / ${ENGINE_PASSWORD}\n`);

  setInterval(() => {
    console.log('Running scheduled ingestion...');
    runAll().then((r) => console.log('Ingestion result:', JSON.stringify(r)));
  }, INGEST_INTERVAL_MS);
});
