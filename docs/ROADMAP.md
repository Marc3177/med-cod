# Med-Cod — Phased Roadmap

**Status: all seven phases below are built and end-to-end verified against real
data** — see [FEATURES.md](FEATURES.md) for what actually exists today and
[TEST_REPORT.md](TEST_REPORT.md) for how each phase was tested. This file is kept as
the historical plan (useful for understanding *why* things were sequenced this way),
not as a live task list. A substantial evidence-and-intelligence layer was built after
Phase 7, not originally planned here in this level of detail — see FEATURES.md's
"Evidence & intelligence layer" section: abbreviation expansion, documentation-gap
detection, chart intelligence, change detection, decision explanation, a multi-source
evidence graph, and a unified accept/reject/modify/query workflow per suggestion.

Each phase is scoped to be **fully functional end to end** on its own — a coder
can log in and complete a real, usable workflow at the end of every phase, not
just a scaffold or a partial screen.

## Phase 1 — Manual Coding MVP

**Goal**: a coder can open an encounter, read documentation, search the encoder,
assign diagnosis + procedure codes, and finalize.

- Load ICD-10-CM + ICD-10-PCS into `coding_reference`
- `coding_app` schema: patients, encounters, documents (plain text, manually
  entered or seeded from Synthea), users (single role: coder), coding_decisions
- Screens: work queue (simple list) → encounter view → documentation viewer →
  encoder search → assign codes (mark one principal diagnosis, POA flags) → finalize
- Audit log on every coding_decision write
- **No** AI/NLP suggestions, **no** DRG grouper, **no** queries, **no** QA yet
- Done when: a coder can take a Synthea-generated discharge summary from
  "new" in the queue to "finalized" with correctly structured codes.

## Phase 2 — DRG Grouping + Coding Rules

**Goal**: coder sees the financial/DRG consequence of their coding choices live,
and gets basic validation.

- Simplified rules-based DRG grouper (swap for real CMS grouper later if needed)
- CC/MCC flagging on secondary diagnoses
- Validation rules: code validity, excludes notes, principal-diagnosis sequencing
- NCCI edit ingestion (used for validation, not yet for procedure billing)
- Done when: finalizing an encounter shows the resulting MS-DRG and flags any
  rule violations before allowing finalize.

## Phase 3 — Evidence-Linked Coding Assistance

**Goal**: the app surfaces candidate diagnoses from the documentation, with the
supporting text shown — coder still makes every decision.

- NLP/extraction pass over documentation → candidate diagnosis list + evidence spans
- UI: "why is this suggested" evidence panel, accept/reject/modify per suggestion
- No auto-acceptance, ever — this phase is explicitly designed against the
  automation-bias risk documented in CAC literature (12–15% discrepancy increase
  when suggestions are accepted without review)
- Done when: a coder using suggestions reaches finalize faster than Phase 1,
  measured, not assumed.

## Phase 4 — Query Workflow (CDI loop)

**Goal**: coder (or CDI reviewer) can raise a documentation query to a provider
and get a response, without leaving the app.

- Query entity: draft → sent → provider responded → resolved/expired
- Provider role + minimal provider-facing view (respond to queries only)
- Coding can be updated based on query response, with audit trail linking the two
- Done when: a full query round-trip (raise → respond → recode → finalize) works.

## Phase 5 — QA / Audit Workflow

**Goal**: a second role can review finalized coding before it's truly final.

- Auditor role, QA sampling (e.g. random % of finalized encounters flagged for review)
- Approve / return-to-coder workflow, with reason capture
- Done when: a returned encounter can be recoded and re-submitted for QA.

## Phase 6 — Reporting

**Goal**: productivity and quality metrics that reflect the north-star metric.

- First-pass acceptance rate, specificity capture rate, query volume/turnaround,
  coder productivity (per docs/OVERVIEW.md success metric)
- Supervisor role: work assignment, workload view
- Done when: a supervisor can see real numbers from Phases 1-5 usage, not mock data.

## Phase 7 — Integrations

**Goal**: real-world connectivity, deferred until the core product is proven useful.

- FHIR/HL7 ingestion (replace manual document entry with real feed)
- Billing/claims export (replace "finalize" as an end state with a real handoff)
- Multi-facility support exercised for real (schema already supports it — see
  REQUIREMENTS.md open questions)
- Only now consider CPT/HCPCS Level I + AMA licensing, if outpatient scope is added.
