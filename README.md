# Med-Cod

An inpatient medical coding workspace: a coder opens a discharged encounter, reads the
real clinical documentation, and assigns ICD-10-CM diagnosis and ICD-10-PCS procedure
codes with the help of evidence-linked suggestions — never auto-coded, always traceable
back to the sentence that justifies it. Built around one rule kept from the first line
of code to the last: **the AI finds, explains, and suggests; the coder decides.**

Doc guide (start with #2 if you just want to see how it works end to end):

1. **This file** — what it is, how to run it.
2. **[docs/FEATURES.md](docs/FEATURES.md)** — every feature, what it does, why.
3. **[docs/API.md](docs/API.md)** — every HTTP endpoint, request/response shape.
4. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — tech stack, data model, module boundaries.
5. **[docs/OVERVIEW.md](docs/OVERVIEW.md)** — the domain: what inpatient coding actually is, where this app sits in the revenue cycle.
6. **[docs/DESIGN.md](docs/DESIGN.md)** — UI/data-integrity conventions.
7. **[docs/ROADMAP.md](docs/ROADMAP.md)** / **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)** — the original phased plan and its resourcing (historical — see FEATURES.md for current state).
8. **[docs/TEST_REPORT.md](docs/TEST_REPORT.md)** — every real bug found during end-to-end testing, symptom → cause → fix.
9. **[docs/VALIDATION_METHODOLOGY.md](docs/VALIDATION_METHODOLOGY.md)** — how this project verifies a change actually works, and the automated test suite.

## Quick start

Requires a local PostgreSQL install (no Docker) and Node 20+.

```bash
createdb coding_app
createdb coding_reference

npm install
cp .env.example .env   # fill in DATABASE_URL / REFERENCE_DATABASE_URL / JWT_SECRET

# app-database schema
npm run prisma:app:migrate -w apps/api
# reference-database schema
npm run prisma:reference:migrate -w apps/api
```

Load the reference data (CMS/NCHS public downloads — see
[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for sources):

```bash
npx tsx scripts/import-icd10cm.ts <path-to-icd10cm-order-2026.txt>
npx tsx scripts/import-icd10pcs.ts <path-to-icd10pcs_order_2026.txt>
npx tsx scripts/import-icd10cm-index.ts <path-to-icd10cm-index-2026.xml>
npx tsx scripts/import-icd10pcs-index.ts <path-to-icd10pcs_index_2026.xml>
npx tsx scripts/seed-drg-reference.ts
npx tsx scripts/seed-clinical-aliases.ts
npx tsx scripts/seed-clinical-indicators.ts
```

Seed a demo user in each role and some sample app data:

```bash
npx tsx scripts/seed-app-db.ts
npx tsx scripts/seed-coder-password.ts
npx tsx scripts/seed-auditor.ts
npx tsx scripts/seed-provider.ts
npx tsx scripts/seed-supervisor.ts
npx tsx scripts/seed-qa-test-encounters.ts     # creates the MRN-QA-TEST patient — required if you plan to run `npm run test` (see Testing below); otherwise optional
npx tsx scripts/seed-second-facility.ts        # optional: exercise multi-facility isolation
```

Run it:

```bash
npm run dev:api   # http://localhost:3000
npm run dev:web   # http://localhost:5173
```

Log in as `coder1@med-cod.test` / `coder123`, `auditor1@med-cod.test` / `auditor123`,
`provider1@med-cod.test` / `provider123`, or `supervisor1@med-cod.test` / `supervisor123`.

## Testing

```bash
npm run typecheck        # both apps
npm run test -w apps/api  # 27 real-database integration tests — see docs/VALIDATION_METHODOLOGY.md
```

Frontend verification is currently manual (browser + network + DB, not screenshots
alone — see VALIDATION_METHODOLOGY.md); there is no automated frontend test suite yet.

## Repo layout

```
apps/
  api/     NestJS backend — one module per feature, see docs/API.md
    prisma/app/          transactional schema (patients, encounters, coding, queries...)
    prisma/reference/    CMS code-set schema (ICD-10-CM/PCS, DRG tables, index...)
  web/     React + Vite + Tailwind frontend
packages/
  shared/  Zod schemas imported by both apps — one validation rule, not two
scripts/   One-off and reference-data-loading scripts (see Quick start above)
docs/      Everything listed in the doc guide above
```

## Status

Every phase of the original roadmap (manual coding MVP through FHIR/claims
integrations) is built and end-to-end verified against real data, plus a full
evidence-and-intelligence layer on top (abbreviation expansion, documentation-gap
detection, chart intelligence, change detection, decision explanation, a multi-source
evidence graph, and a unified chart-review workflow). See
[docs/FEATURES.md](docs/FEATURES.md) for the complete current list and
[docs/TEST_REPORT.md](docs/TEST_REPORT.md) for what was tested and what broke along
the way.

Known gaps, honestly: no CI (tests run only when invoked manually), most backend
modules still have no automated tests (4 of 17 do), no automated frontend tests, and
this repo is not yet under version control.
