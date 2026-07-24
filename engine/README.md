# Bauhaus Engine — Milestones 1–6 (full pipeline)

Separate app from the Taana Baana store, living alongside it in this repo.
Same stack conventions (Express + `better-sqlite3`), different product: an
opportunity-intelligence engine for tracking hospitality/construction leads.

Every stage from the architecture doc now runs, end to end, on real public
data: **ingest → entity resolution → scoring → recommendation**, orchestrated
by `ingestion/run.js` and triggerable from the dashboard's Raw Events tab
("Run Ingestion Now"), `POST /api/ingest/run`, or the 6-hour timer in
`server.js`.

## What's in here

**Milestone 1 — Foundation**
- **opportunities** — full CRUD, `status` drives the CRM funnel
  (`new → contacted → meeting → proposal → won/lost`)
- **companies** / **contacts** — linked to opportunities via `company_id` so
  a lead always resolves to someone to call.
  - **Registered address is auto-populated for RERA companies**
    (`ingestion/reraCertificate.js`): every registered project has a Form-C
    certificate PDF at a predictable URL, which is a legally-mandated public
    disclosure of the promoter's registered office — not scraped personal
    data. Fetched once per company (skipped if already set), parsed with
    `pdf-parse`. In practice this filled in **85 of 132 companies** with a
    real, verifiable postal address (e.g. Chalet Hotels Limited's actual
    registered office).
  - **Named-person contacts (a phone number, an email, a name) are not
    auto-discovered** — checked directly: RERA's project detail view and
    certificate both lack any phone/email field, and only 1 of 31 GeM
    tenders carried a real email rather than a portal login handle.
    Automatically scraping LinkedIn/people-search sites for names is
    something this build deliberately does not do. The Contacts tab is where
    your team records a name/email/phone once they've actually looked
    someone up — not auto-filled, but no longer just an empty form either,
    since the company record it attaches to now usually has a real address.
- **industry_profiles** — config-driven scoring targets (seeded with a
  "Premium Furniture" profile) instead of hardcoded if/else rules
- Whole app is gated by HTTP Basic Auth (`ENGINE_USER`/`ENGINE_PASSWORD`)

**Milestones 2 & 3 — Ingestion + rule-based extraction** (`ingestion/`)
Three connectors, each hitting a real public source (no login, no CAPTCHA —
verified by hand before writing any code):

| Connector | Source | Method |
|---|---|---|
| `rera.js` | [Karnataka RERA](https://rera.karnataka.gov.in) project registry, Bengaluru Urban + Rural | Plain POST form submit → server-rendered HTML table (`cheerio`) |
| `gemTenders.js` | [GeM](https://bidplus.gem.gov.in) government tenders, keyword search | GET page for a CSRF token → POST JSON search API |
| `news.js` | Google News RSS, hotel/hospitality queries | RSS/XML (`cheerio` in `xmlMode`) |

Every fetched item is stored verbatim in `raw_events` first (deduped by
`source_key` + `external_id`). Where the source is already structured (RERA,
GeM), a row becomes an opportunity directly. For news, a lexicon/regex layer
(`HOSPITALITY_BRANDS`, `STAGE_PATTERNS` in `news.js`) pulls a company + stage
guess out of the headline — **rule-based, not AI**, and the piece most
likely to need an LLM later.

Re-running a connector is idempotent: `upsertOpportunity()`
(`ingestion/lib.js`) does nothing if the opportunity's `source_ref` already
exists at the same stage, but **updates the stage in place** if a later run
finds it's moved (e.g. RERA `approved` → `applied for completion`).

**Signal detection** (folded into each connector via `recordSignal()`, not a
separate pass — the signal type is already known at extraction time)
Every stage transition writes a dated, sourced row to `signals`
(`new_project`, `construction_started`, `fit_out_phase`, `tender_published`,
`opening_announced`, `architect_appointed`, `renovation_announced`) —
`UNIQUE(opportunity_id, signal_type)` means re-detecting the same signal on
an unchanged re-run is a no-op, not duplicate spam.

**Milestone 4 — Entity resolution + scoring**
- `entity/resolve.js`: Jaccard similarity on normalized company names (legal
  suffixes and generic corporate/government words like "Department",
  "Affairs", "Realty", "Ventures" stripped first — without that,
  "Department of Consumer Affairs" and "Department of Military Affairs"
  scored 0.6 similar on shared filler words alone, a real false positive
  caught during testing). Suggestions require human confirm/reject via the
  **Merge Suggestions** tab — no auto-merge, since a bad merge silently
  corrupts two real, distinct companies into one.
- `scoring/score.js`: the doc's own formula, `Impact × Urgency × Project Size
  × Confidence × Bauhaus Fit → 0–100`, all five factors deterministic rules
  against fields already on hand (stage, industry-profile keyword match,
  luxury-brand/commercial keyword match, GeM order quantity, source
  confidence). Each opportunity gets a `score_reason` explaining the number
  (visible on hover in the dashboard).

**Milestones 5 & 6 — Signal layer + recommendation** (`recommendation/recommend.js`)
One rule per stage, matching the doc's own UX target ("don't call the hotel,
call the architect — within 14 days, bring the catalogue"):

| Stage | Contact | Timing |
|---|---|---|
| `opening` | General Manager / Owner | Urgent — furniture window is now |
| `fit-out` | Interior Fit-Out Contractor / PM | Immediately |
| `procurement` | Procurement Officer / Buyer | Computed from the GeM bid's own end date |
| `design` | Architect / Design Consultant | Within 14 days |
| `construction` | Developer / Project Head | Revisit in 3–6 months |
| `planning` | Developer (early contact) | Low priority |

For GeM-sourced opportunities the timing isn't a template string — it reads
the real bid deadline out of the stored raw payload (verified: e.g. "Before
the tender closes on 2026-07-23").

### Known limitations, deliberately not fixed yet

- **Confidence scores are hand-picked, not learned**: 0.75 RERA, 0.65 GeM,
  0.35 news. These feed directly into the scorer, so a bad hand-picked
  number under/over-weights every opportunity from that source.
- **News stage/signal detection is sparse** — `STAGE_PATTERNS` in `news.js`
  requires fairly literal phrases ("architect appointed", "fit-out"), so
  most headlines end up with `stage = null` and no signal at all, even when
  a human would recognize the news as relevant. Verified in practice: 0
  `architect_appointed` and 0 `renovation_announced` signals were produced
  from 135 news-derived opportunities in testing.
- **News location is hardcoded to "Bengaluru, Karnataka"** for every match,
  since the geo-scoped search query is the only location signal used.
- **RERA ingestion is a full re-pull, not incremental** — each run refetches
  ~5,000+ rows across two districts (no "since date" filter on the site);
  dedup keeps it cheap, but it's a full scan every time.
- **Entity resolution is O(n²)** and precision-biased (would rather miss a
  duplicate than wrongly merge two real companies) — fine at hundreds of
  companies, would need blocking/indexing before it scales past a few
  thousand.
- **Recommendation rules only know six stages** — anything with a `null`
  stage (a real chunk of news-derived opportunities, see above) falls to a
  generic "needs manual review" recommendation rather than a specific one.
- **Registered address only covers RERA-sourced companies** — the 47 of 132
  companies without one are GeM government departments (no certificate
  exists) or news-derived hotel brands (not RERA promoters at all). It's a
  postal address, not a phone/email either way.

## Running it

```bash
cd engine
npm install
cp .env.example .env
npm start
```

Open **http://localhost:4000** (default login `admin` / `changeme` — change
it in `.env`). Database auto-creates at `data/engine.db` on first run.

## What's left (not built)

Everything in the doc's six milestones now runs. What's still open:
- Making news extraction actually good (this is the natural place for the
  LLM the doc's own tech stack lists but this build deliberately avoided,
  per an earlier explicit decision to do "plain rules first")
- Learned/calibrated confidence and scoring weights instead of hand-picked
  constants
- Widening RERA beyond two districts, and GeM beyond three keyword queries
- A real Kanban-style status board (current dashboard is a sortable table,
  not drag-and-drop columns)
