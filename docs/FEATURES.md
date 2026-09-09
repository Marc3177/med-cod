# Med-Cod — Features (current state)

Everything in this file exists and has been verified against real data (see
[TEST_REPORT.md](TEST_REPORT.md) for exactly how). This supersedes
[ROADMAP.md](ROADMAP.md) as the description of what the app *does* — ROADMAP.md is
kept as the historical plan. See [API.md](API.md) for the exact endpoint shapes behind
each feature.

## Core coding workflow

### Work queue & encounter detail (`patients` module)

A coder's landing page lists encounters at their own facility that still need work —
excludes `FINALIZED` (done) and `QA_REVIEW` (sitting with an auditor, nothing to do
until it's returned or approved). Opening an encounter shows the patient, admission/
discharge dates, status, and every clinical document verbatim.

### Encoder search (`encoder` module)

Free-text search against both ICD-10-CM and ICD-10-PCS. Two paths, both surfaced
together: a direct match against real code descriptions, and a match against the CMS/
NCHS **Alphabetic Index** (`SynonymIndexEntry`) — the bridge from a clinical term (e.g.
"aspiration pneumonia") to a code whose formal description uses different words
entirely (e.g. "Pneumonitis due to inhalation of food and vomit"). Abbreviations
("COPD", "AKI", "MI"...) are expanded before either search runs (see Terminology,
below). A short free-text query (under 4 characters) skips the direct-description path
entirely — otherwise "MI" matches "middle" and "AKI" matches "anisakiasis", real false
positives found during testing.

### Diagnosis/procedure assignment & finalize (`coding` module)

A coder assigns diagnoses (one designated **principal**, the rest **secondary**, each
flagged present-on-admission or not) and procedures. Every code is checked against the
reference tables before it can be saved — a nonexistent code, or a real but
non-billable category header, is rejected outright, never silently accepted. Removing
the principal diagnosis auto-promotes the next one, rather than leaving the encounter
with none. Every save and finalize writes an `AuditEntry` (who/when/what changed).
Finalizing computes and stores the DRG, then hands off to QA sampling.

### DRG grouper (`grouper` module)

A **deliberately simplified approximation** of the CMS MS-DRG grouper, labeled as such
everywhere it's shown — not the official grouper. Curated `DrgFamily` /
`SurgicalDrgFamily` / `CcMccFlag` reference tables map a principal diagnosis (plus a
significant OR procedure, plus CC/MCC-flagged secondary diagnoses) to a simplified DRG,
severity tier, and description, always showing *which* secondary diagnosis or procedure
drove the result — never a black box.

## Query workflow (CDI loop)

### Coder side (`queries` module)

A query is `DRAFT` → `SENT` (encounter moves to `QUERY_PENDING`) → `RESPONDED` →
`RESOLVED` (coder has reviewed the response; encounter returns to `IN_PROGRESS` only if
no other query on it is still open). A query can optionally carry a `relatedCode` /
`relatedCodeSystem` — set when raised from a Suggestion (see Decision Explanation,
below), never when raised from a Documentation Gap (a gap has no code by design).

### Provider side (`queries/provider-queries` controller, `PROVIDER` role)

Every `SENT` query at the provider's facility, in one queue (no per-provider
assignment concept yet). Responding moves the query to `RESPONDED`.

## QA / audit workflow (`qa` module)

Finalizing an encounter randomly samples it into `QA_REVIEW` (rate is intentionally
high for a small seed dataset — a real deployment would tune it down). An auditor
(`AUDITOR` role) approves (encounter stays `FINALIZED`) or returns it with a required
reason (encounter reopens to `IN_PROGRESS`, so the coder can recode and re-finalize —
which can be sampled again; no cap on how many times an encounter cycles through this).

## Reporting (`reporting` module, `SUPERVISOR`/`ADMIN` roles)

Every number is computed live from real usage, not mock data: first-pass acceptance
rate (the north-star metric — % of finalized encounters never sent back by QA), QA
return rate, coder productivity, query volume/turnaround, pipeline workload.

## Integrations

### FHIR ingestion (`fhir` module)

Parses a real FHIR R4 Bundle (Patient + Encounter + DocumentReference resources),
resolving intra-bundle references via `fullUrl` (not `resource.id`, which real bundles
don't use for references) and decoding base64 attachment content. Every resource is
validated before any write — not a full FHIR validator, but a pragmatic subset covering
every field this app actually uses.

### Claims export (`claims` module)

A structured JSON export for `FINALIZED` encounters only, using standard UB-04/837I
institutional-claim field concepts (principal/secondary diagnosis, POA, attending,
DRG) — not a certified X12 837 generator, but the shape a real billing integration
would be built against as a first step.

### Multi-facility isolation

Every encounter-touching service checks the requesting user's `facilityId` against the
resource's facility and throws `ForbiddenException` on mismatch. This was retrofitted
after a real cross-tenant leak was found during end-to-end testing (any coder could see
every facility's work queue) — now covered by `scripts/seed-second-facility.ts` and
exercised across every module.

## Evidence & intelligence layer

Built after the core workflow above, each as its own bounded, testable slice — see
[TEST_REPORT.md](TEST_REPORT.md) for the real bugs each one surfaced. The through-line
is architectural, not incidental: **AI finds, explains, and suggests; the coder always
decides.** `DocumentationGap` has no code field at the type level — it can only ever
become a query, never a diagnosis. Nothing here auto-adds a code to a coding decision.

### Abbreviation/terminology expansion (`terminology` module)

A curated `ClinicalAlias` table (COPD, MI, CHF, AKI, CKD, UTI, DVT, PE, CVA, TIA, and
more) expands common inpatient abbreviations into the spelled-out phrase the Alphabetic
Index actually contains, before matching runs — used by both the encoder and
Suggestions. Evidence excerpts always show the chart's original wording, never the
expanded form.

### Evidence-linked suggestions (`suggestions` module)

For every sentence in every document, every Alphabetic Index term is checked: if every
"significant" word of the term appears in the sentence, the code it points to is
suggested, with the exact sentence as evidence. Deliberately dictionary-based, not an
LLM call — every suggestion is traceable to the literal text that produced it. Word
filtering has been refined twice after real, data-verified bugs (see TEST_REPORT.md
"Clinical understanding" and "Broadening the word-filter fix") — a generic-word
stoplist and a structural-connector stoplist (built by analyzing which index-tree words
are ever isolated segments, not by guessing) now strip words like "diseased"/
"specified"/"with" that were being wrongly required verbatim.

`listAllEvidence()` surfaces *every* independent sentence/term match for a code, not
just the first — the "evidence graph": one code mentioned in the H&P *and* the
discharge summary shows both. `listSuggestions()` is a thin dedup wrapper over it (one
per code, first match wins) — one implementation, so the two views can't disagree.

A suggestion reaches exactly one of four outcomes, all coder-driven:

- **Accept** — adds the code as-is to the coding decision.
- **Reject** — persisted per encounter (`RejectedSuggestion` table), so it does not
  resurface on reload or for a different coder opening the same chart. Enforced once,
  centrally (`listActiveSuggestions()`), so a rejection can't keep showing up in Chart
  Intelligence while hidden in the Suggestions panel.
- **Modify** — re-focuses the diagnosis/procedure search box on the suggestion's own
  matched term, so the coder picks a more specific real code themselves instead of
  accepting the suggestion as-is.
- **Query** — raises a real query (see Query workflow) carrying the suggestion's
  evidence, linked to that specific code.

### Documentation-gap detection (`documentation-gaps` module)

Flags a lab value documented in the chart with nothing coded to address it (e.g.
creatinine 2.1 with no coded kidney diagnosis) — five seeded `ClinicalIndicator` rows
(creatinine, sodium, potassium high/low, troponin). Suppressed once a real diagnosis
*prefix*-matches the indicator's related codes (not exact match — "N17" as a prefix
must match a real code like "N179", never the literal string "N17", which isn't
billable on its own). Output has no code field, ever — only a `suggestedQuery` string.

### Chart Intelligence (`chart-intelligence` module)

A pure aggregation layer over Suggestions + Documentation Gaps — deliberately *not* a
new extraction engine, so match quality has one source of truth, not two. Shows
confirmed findings (already coded, resolved to real descriptions), potential findings
(suggested but not coded, evidence-backed), and a documentation-gap count. Clicking a
potential finding scrolls to and highlights its source document.

### Change detection (`chart-changes` module)

"What's changed since I last looked at this chart" — a per-user `EncounterView.viewedAt`
timestamp diffed against new documents, coding edited by a *different* user, a query
response, or a QA return. Reading the diff (`getChanges`) and advancing the timestamp
(`acknowledgeView`) are deliberately separate calls — an earlier version did both in one
request, which raced under concurrent calls (React StrictMode's double effect
invocation, two tabs) and could silently report no changes even though nobody had
actually seen them. Covered by a regression test that calls `getChanges()` twice in a
row and asserts identical results.

### Decision Explanation (`decision-explanation` module)

A "why?" affordance on every coded diagnosis/procedure and every suggestion, showing:
billability, a specificity check (flags "unspecified" wording as a prompt to check for
something more specific — not proof it's wrong), CC/MCC impact from the reference data,
every independent evidence excerpt (the evidence graph, surfaced here), and any query
specifically linked to this code (`relatedQueries` — not a bare count of every open
query on the encounter, which could easily be about something unrelated).

### Unified chart-review workflow (`ChartReviewSummary` component)

A glanceable summary bar — confirmed conditions, potential opportunities, documentation
gaps, changes since last visit, distinct evidence sources — sitting above the detailed
panels. Pure client-side aggregation of data the page already fetches; no new backend
surface for the summary itself.

## Auth & roles (`auth` module)

JWT-based, 12-hour tokens, role stored in the token payload (`CODER`, `ADMIN`,
`PROVIDER`, `AUDITOR`, `SUPERVISOR`). `AuthGuard` requires a valid token on nearly every
route; `RolesGuard` + `@Roles(...)` additionally restricts a handful of routes
(auditor actions, provider responses, reporting) to the roles that should see them.
