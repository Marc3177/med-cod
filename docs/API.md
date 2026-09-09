# Med-Cod — API Reference

All routes are served by `apps/api` (default `http://localhost:3000`). Every route
except `POST /auth/login` requires `Authorization: Bearer <token>` (`AuthGuard`); a few
additionally require a specific role (`RolesGuard` + `@Roles(...)`, noted below). Every
encounter-scoped route additionally checks the token's `facilityId` against the
resource's facility and returns 403 on mismatch — see [FEATURES.md](FEATURES.md)
"Multi-facility isolation". See [ARCHITECTURE.md](ARCHITECTURE.md) for the two
databases each service reads from.

## Auth

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| POST | `/auth/login` | — | `{ email, password }` | Returns `{ accessToken, user }`; `user` is the JWT payload (`sub`, `email`, `role`, `facilityId`). Token TTL 12h. |

## Patients / Work Queue

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/work-queue` | any | Encounters at the caller's facility excluding `FINALIZED`/`QA_REVIEW`. |
| GET | `/encounters/:id` | any | Full encounter detail (patient, documents, coding decision). |

## Encoder

| Method | Path | Role | Query | Notes |
|---|---|---|---|---|
| GET | `/encoder/icd-10-cm` | any | `q` | Direct + Alphabetic Index synonym search. Abbreviations expanded first. |
| GET | `/encoder/icd-10-pcs` | any | `q` | Same, ICD-10-PCS. |

## Terminology

| Method | Path | Role | Query | Notes |
|---|---|---|---|---|
| GET | `/terminology/expand` | any | `text` | Returns `{ original, expanded }` — abbreviation expansion in isolation, mostly for debugging. |

## Coding

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| PUT | `/encounters/:id/coding` | any | `{ decision: unknown }` (Zod-validated `CodingDecision` from `@med-cod/shared`) | Every code checked against the reference DB before write. Sets encounter status to `IN_PROGRESS`. Writes an `AuditEntry`. |
| POST | `/encounters/:id/coding/finalize` | any | — | Requires a saved coding decision; computes and stores the DRG; sets status `FINALIZED`; triggers QA sampling. |

## Grouper

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| POST | `/grouper/preview` | any | `{ diagnoses: CodedDiagnosis[], procedures?: CodedProcedure[] }` | Live DRG preview from the current form state — no draft write as a side effect. Returns `DrgResult \| null`. |

## Suggestions

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| GET | `/encounters/:id/suggestions` | any | — | `listActiveSuggestions()` — excludes rejected codes. |
| POST | `/encounters/:id/suggestions/reject` | any | `{ code, codeSystem }` | Persists a `RejectedSuggestion` row; one-way, no undo yet. |

## Documentation Gaps

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/encounters/:id/documentation-gaps` | any | Returns `DocumentationGap[]` — no code field, ever, only `suggestedQuery`. |

## Chart Intelligence

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/encounters/:id/chart-summary` | any | Aggregates Suggestions + Documentation Gaps; see FEATURES.md. |

## Chart Changes

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/encounters/:id/chart-changes` | any | Pure read — safe to call any number of times, does not advance the view timestamp. |
| POST | `/encounters/:id/chart-changes/ack` | any | Advances the caller's `EncounterView.viewedAt` to now. Call after displaying the diff from GET. |

## Decision Explanation

| Method | Path | Role | Query | Notes |
|---|---|---|---|---|
| GET | `/encounters/:id/decision-explanation` | any | `code`, `codeSystem` (`ICD-10-CM`\|`ICD-10-PCS`) | Billability, specificity check, CC/MCC, every evidence excerpt for this code, and `relatedQueries` linked to it. 400 if the code doesn't exist in the current fiscal year. |

## Queries (coder side)

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| GET | `/encounters/:id/queries` | any | — | All queries on the encounter, newest first. |
| POST | `/encounters/:id/queries` | any | `{ question, clinicalIndicators?, relatedCode?, relatedCodeSystem? }` | Creates a `DRAFT` query. `relatedCode`/`relatedCodeSystem` only set when raised from a Suggestion. |
| POST | `/queries/:id/send` | any | — | `DRAFT` → `SENT`; encounter → `QUERY_PENDING`. |
| POST | `/queries/:id/resolve` | any | — | `RESPONDED` → `RESOLVED`; encounter → `IN_PROGRESS` only if no other query on it is still open. |

## Queries (provider side)

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| GET | `/provider/queries` | `PROVIDER` | — | Every `SENT` query at the provider's facility. |
| POST | `/provider/queries/:id/respond` | `PROVIDER` | `{ response }` | `SENT` → `RESPONDED`. |

## QA (coder-visible read + auditor actions)

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| GET | `/encounters/:id/qa-reviews` | any | — | QA review history for the encounter (any role at the same facility can view). |
| GET | `/audit/queue` | `AUDITOR` | — | Pending (`PENDING`) reviews at the auditor's facility. |
| POST | `/audit/reviews/:id/approve` | `AUDITOR` | — | Encounter stays `FINALIZED`. |
| POST | `/audit/reviews/:id/return` | `AUDITOR` | `{ reason }` | Encounter → `IN_PROGRESS`; reason is required and stored. |

## Reporting

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/reports/summary` | `SUPERVISOR`, `ADMIN` | First-pass acceptance rate, QA stats, query stats, productivity — all computed live. |

## FHIR

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| POST | `/fhir/bundle` | any | A FHIR R4 `Bundle` (Patient + Encounter + DocumentReference) | Validates every resource before any write. |

## Claims

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/encounters/:id/claim-export` | any | 400 if the encounter isn't `FINALIZED`. UB-04/837I-shaped JSON, not a certified X12 837. |

## Import (reference-data validation)

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| POST | `/import/icd-10-cm/validate` | none (no `AuthGuard`) | `{ rows: unknown[] }` | Validate-only; the actual bulk load of reference data is done via the one-off scripts in `scripts/` (see the README quick start), not through this endpoint in normal use. |
