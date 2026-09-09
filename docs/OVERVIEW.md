# Med-Cod — How the Application Works (End to End)

## Scope decision (locked)

- **Setting**: Inpatient hospital coding only (not outpatient/professional).
- **Code sets**: ICD-10-CM (diagnoses) + ICD-10-PCS (procedures) + MS-DRG grouping.
- **Explicitly out of scope for now**: CPT/HCPCS Level I (AMA-licensed, recurring royalty cost), outpatient/professional coding, risk adjustment (HCC/RAF).
- **Why**: ICD-10-CM, ICD-10-PCS, and HCPCS Level II are public domain (CMS/NCHS). CPT requires a paid, recurring AMA license. Starting inpatient-only means zero data-licensing cost while we validate the product.

## The revenue cycle, and where we fit

```
FRONT-END              MID-CYCLE  (<-- this app lives here)      BACK-END
scheduling             clinical documentation                    claim submission
registration           CDI review / queries                      payer adjudication
eligibility            CODING (diagnosis + procedure + DRG)       payment posting
                       charge capture                             denials / appeals
```

We consume front-end data (patient/encounter/insurance) and produce back-end input
(a finalized, DRG-validated code set). We do not build scheduling, eligibility checks,
claim submission, or payment posting ourselves — those are out of scope, but our data
model must have clean seams to hand off to (or receive from) systems that do.

## One encounter, walked end to end

1. **Admission** — patient registered in an upstream system (EHR). We receive/enter:
   patient demographics, encounter (admission date, admitting diagnosis, facility).
2. **Care + documentation** — physicians write H&P, progress notes, op reports,
   discharge summary. This is free-text, written for clinical/legal purposes, not coding.
3. **Discharge** — the chart becomes "codeable" once the discharge summary is signed.
4. **CDI review (optional, can run concurrently with the stay)** — a documentation
   specialist queries the physician *before* discharge if documentation is ambiguous
   (e.g. "elevated creatinine" vs. a named diagnosis like "acute kidney injury").
5. **Coding** — a coder (via a work queue) opens the encounter, reads documentation,
   and assigns:
   - Diagnoses (ICD-10-CM) — one designated **principal diagnosis** (the condition,
     established after study, chiefly responsible for the admission — not necessarily
     the admitting diagnosis), plus secondary diagnoses, each flagged **POA**
     (present on admission) or not.
   - Procedures (ICD-10-PCS), for anything done in an OR/procedural setting.
6. **DRG grouping** — coded data (principal dx, secondary dx, procedures, age, sex,
   discharge disposition) is run through a **grouper**, which outputs an MS-DRG.
   Secondary diagnoses flagged as **CC** (complication/comorbidity) or **MCC**
   (major CC) can move the case into a higher-paying DRG tier — this is why capturing
   every clinically-supported secondary diagnosis matters financially, not just clinically.
7. **Validation / QA** — coding is checked against rules (code validity, excludes notes,
   sequencing, DRG defensibility) before being marked final.
8. **Finalize** — coded, DRG-assigned encounter is ready to hand off downstream
   (billing/claims — out of scope, but our output must be clean enough to consume).
9. **Denial loop (back-end, out of scope but affects us)** — if a payer denies a claim
   over a coding issue, it comes back to a coder for correction. Our data model should
   support re-opening a finalized encounter and recording why it changed.

## Roles (which ones exist in v1 vs. later)

| Role | Phase introduced | Does |
|---|---|---|
| Coder | Phase 1 | Reviews documentation, assigns codes, finalizes |
| Admin | Phase 1 | Manages users, loads reference data |
| Provider | Phase 4 | Responds to coding queries |
| Auditor/QA | Phase 5 | Reviews finalized coding, approves/returns |
| Supervisor | Phase 6 | Assigns work, monitors productivity |

## Success metric (drives what "done" means per phase)

**First-pass acceptance rate**: % of finalized encounters that would pass billing edits
without rework. This is called out repeatedly in coding-productivity literature as the
metric that predicts real revenue outcomes — more than raw charts-per-day. Every phase
should move this number, not just add screens.
