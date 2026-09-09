# Med-Cod — Requirements and Required Resources

## Functional requirements by phase

See [ROADMAP.md](ROADMAP.md) for the phase breakdown. This file lists what's needed
to build, independent of when.

### Data / reference resources

| Resource | Source | Cost | Needed for phase |
|---|---|---|---|
| ICD-10-CM code set (diagnoses) | CMS/NCHS public download | Free | 1 |
| ICD-10-PCS code set (procedures) | CMS public download | Free | 1 |
| ICD-10-CM Official Guidelines for Coding and Reporting | CMS/NCHS PDF | Free | 1 (rules), 2 (enforced) |
| MS-DRG grouper logic/software | CMS public spec/reference software | Free (integration effort is the real cost) | 2 |
| NCCI edit files | CMS, quarterly download | Free | 2–3 (validation rules) |
| Sample clinical documentation | Synthea (synthetic) or hand-written test charts | Free | 1 |
| Real de-identified clinical notes (optional, later) | MIMIC-IV (requires training + data use agreement) | Free but requires credentialing lead time | Later, if needed for NLP quality validation |

### Explicitly not required for v1

- CPT / HCPCS Level I code set + AMA license — deferred until/unless outpatient
  scope is added. (~$18.50/user/year + ~$1,050/year royalty minimum, or $13k/year
  for AMA's CPT Link integration data — real recurring cost, not a one-time fee.)
- FHIR/HL7 integration engine — deferred to Phase 7.
- Any EHR vendor integration/API access.

### People / skills resources

- Someone who can validate coding correctness against real coder judgment —
  ideally short structured conversations with 2-3 practicing inpatient coders
  before Phase 3 (evidence/suggestion features), so "suggested codes" are judged
  against real workflow expectations, not assumptions.
- No dedicated compliance/legal resource is required for v1 as long as we stay
  in synthetic-data-only, non-production territory — revisit before any real PHI
  or production deployment.

### Infrastructure resources

- Postgres instance (local Docker is enough through Phase 3–4)
- Object storage for documents (MinIO locally)
- No cloud deployment required until a phase actually needs multi-user access
  outside a single dev machine — don't provision production infra prematurely.

## Non-functional / compliance requirements

- No real PHI in any environment until there is an explicit, deliberate decision
  to handle it (BAA, HIPAA safeguards, access controls, encryption at rest/in
  transit) — treat this as a hard gate, not a "phase 8 nice to have."
- Every coding decision is audit-logged from Phase 1 (see ARCHITECTURE.md).
- Reference data is versioned/effective-dated from Phase 1, not retrofitted later.

## Open questions (need a decision, not research)

- Do we integrate the actual CMS MS-DRG grouper, or build a simplified rules-based
  approximation first and swap in the real grouper in Phase 2? (Recommendation:
  simplified first — the real grouper is a meaningful integration project on its own
  and shouldn't block the first working diagnosis/procedure coding loop.)
- Single-facility vs. multi-facility data model from day one? (Recommendation:
  design the schema multi-facility-ready — a `facility_id` on encounters — even
  if Phase 1 only ever has one facility, since retrofitting this later touches
  every table.)
