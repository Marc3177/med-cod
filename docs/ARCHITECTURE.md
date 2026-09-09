# Med-Cod — Architecture, Tech Stack, and Data Design

## Two databases, on purpose

We keep **reference data** and **application (transactional) data** in separate
databases. Same engine (Postgres) is fine — "separate" means separate database/schema,
not necessarily separate servers, though it can become that later.

| | Reference DB (`coding_reference`) | Application DB (`coding_app`) |
|---|---|---|
| Contents | ICD-10-CM codes, ICD-10-PCS codes, official guidelines, DRG tables, NCCI edits | Patients, encounters, documents, coding decisions, users, queries, audit log |
| Update pattern | Bulk load, annually (ICD-10-CM/PCS, Oct 1) or quarterly (NCCI) | Continuous, transactional, many small writes |
| Read/write ratio | ~100% read in normal operation | Heavy read + write |
| Versioning need | Every row needs `effective_from` / `effective_to` — a code valid in FY2025 may not exist or may mean something different in FY2027 | Standard row versioning / audit trail, not code-set versioning |
| Why separate | Reloading a new annual code set must never lock or risk corrupting live coding data. It also means the reference DB can be treated as a swappable, re-buildable artifact (rebuild from CMS source files), while the app DB is the thing we back up and protect like a database of record. | |

Application tables reference codes by `(code, code_system, version)`, not by a
mutable foreign key to a single "current" code table — so a finalized encounter's
coding never silently changes meaning when the reference data is updated next year.

## Tech stack (v1)

- **Frontend**: React + TypeScript
- **Backend**: Node.js + TypeScript (NestJS — gives us modules/DI structure that
  maps cleanly to the service boundaries below without extra scaffolding work)
- **Database**: PostgreSQL (two logical databases as above), installed locally —
  no Docker/containerization for now; connect via `DATABASE_URL` /
  `REFERENCE_DATABASE_URL` in `.env` (see `.env.example`)
- **ORM**: Prisma, one schema per database (`apps/api/prisma/app.prisma`,
  `apps/api/prisma/reference.prisma`) — generated types keep the DB and code
  from drifting apart silently
- **Search** (encoder terminology search): Postgres full-text search to start;
  revisit OpenSearch/Elasticsearch only if search quality becomes a real bottleneck
  (adding a search cluster in Phase 1 is premature)
- **File/document storage**: local filesystem in dev; S3-compatible object storage
  (e.g. MinIO locally, real S3 in production) for clinical documents
- **Auth**: session or JWT-based auth with a roles table (RBAC) — no need for a
  full identity provider until integrations (Phase 7) demand SSO
- **DRG grouper**: CMS publishes MS-DRG grouper logic/specs (free); evaluate
  integrating it directly vs. a simplified rules-based approximation for Phase 2 —
  this is a real integration task, not a trivial lookup, and is called out as a
  separate resourcing item below.

## Service boundaries (backend modules)

This was the pre-implementation plan; see [FEATURES.md](FEATURES.md) for what each
module actually does today. A few names changed shape once built: `documents` folded
into `patients` (a `ClinicalDocument` is fetched as part of an encounter, not a
separate module); `rules`/validation lives directly in `CodingService` rather than a
standalone module (code-validity checks against the reference DB, inline where the
write happens); `audit` is the `AuditEntry` model written to by `coding`, not a
separate module. Every other module below is real and current:

```
auth                  — users, roles, JWT auth
patients              — work queue, encounter + document retrieval
encoder               — reference-data search (reads coding_reference only)
terminology           — clinical abbreviation expansion (COPD -> ...), used by encoder + suggestions
coding                — diagnosis/procedure assignment, principal dx, POA, finalize, audit trail
grouper               — simplified DRG assignment
suggestions           — evidence-linked candidate codes from documentation text
documentation-gaps    — lab-value-with-no-coded-diagnosis detection (query-only output)
chart-intelligence    — aggregates suggestions + documentation-gaps into one summary
chart-changes         — "what changed since I last looked at this chart"
decision-explanation  — "why this code" — billability, specificity, CC/MCC, evidence, related queries
queries               — CDI/coding query workflow (coder + provider sides)
qa                    — QA sampling, auditor review, return-to-coder
reporting             — productivity metrics, first-pass acceptance rate
fhir                  — FHIR R4 Bundle ingestion
claims                — claims-export shape for finalized encounters
import                — reference-data-file validation (used by scripts/, not the UI)
```

Each module owns its own tables in `coding_app`. `encoder`, `terminology`, `grouper`,
and the reference-lookups inside `coding`/`suggestions`/`decision-explanation` are the
modules that read `coding_reference`.

## Non-functional requirements

- **Audit trail is not optional** — every coding decision change must record
  who/what/when/before/after/reason from day one (Phase 1), not bolted on later.
- **PHI handling**: no real patient data in dev/test environments. Use synthetic
  data (Synthea) or hand-written sample charts until there's a reason (and the
  compliance posture) to handle real PHI.
- **Effective-dated everything** in `coding_reference` — codes, guidelines, and
  DRG tables all change on a schedule; the schema must support "what was valid
  on this encounter's discharge date," not just "what's valid today."
