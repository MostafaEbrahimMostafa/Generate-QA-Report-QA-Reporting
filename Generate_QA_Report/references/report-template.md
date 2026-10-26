<!--
  Base template for NDC_Integration/Artifacts/Logs/<slug>.md — the generate-qa-report skill's live,
  real-time rendered output. Re-render this ENTIRE file from the run's .jsonl every time a new line
  is appended (see log-schema.md); never hand-append prose to a live .md file directly.

  This is the file to point someone at WHILE the run is still going — plain Markdown, readable by
  opening/tailing the file with no browser needed. It is superseded, once, by the final HTML
  transform (references/report-template.html) at run_end/interruption — this .md keeps existing
  after that too, it just stops being the "current" view once the .html exists.

  Populate it, don't redesign it. Repeat the per-test-case section for each `test_case` line in the
  log, in order. A test case's internal `hops` (if any) nest as an indented sub-list under that same
  section — never render a hop as its own top-level section.
-->

# QA Execution Report — <!-- scope -->Flow #43 — V2, Family B, Hold

<!-- DATA: header line — from run_start (+ run_end if present) -->
**Environment:** staging &middot; https://ndc-integration-stg-ne-3.azurewebsites.net/
**Supplier:** SUP_A
**Started:** 2026-08-04 14:32:10 UTC
**Status:** RUNNING
<!-- once run_end exists, replace the Status line with one of:
  **Status:** COMPLETE
  **Status:** INTERRUPTED — after TC-0430 (9/12)
-->

## Summary

<!-- DATA: recompute from ALL test_case lines every render, never accumulate incrementally, and
     never count hops as if they were test cases -->
- Test cases logged: 8
- Passed: 6
- Failed: 1
- Blocked: 1

## Test case results

<!-- DATA: repeat this block once per `test_case` line, in log order. Never omit a test case even if
     it only got as far as BLOCKED — that's what makes an interrupted run's report still
     trustworthy. Every test case section lists these six fields, always in this order: Endpoint
     Name, Request, Response, Expected, Actual, Status. If the line has a `hops` array (a flow-level
     test case), nest it as the indented "Hops" sub-list shown below, with the same six fields
     repeated per hop; single-endpoint test cases have no hops list. -->

### TC-0412 — FareConfirm price reconciliation for SUP_A

- Endpoint Name: FareConfirm
- Request: `POST /api/v2/FareConfirm` — offerId=&lt;redacted-id&gt;, supplier=SUP_A
- Response: 200 — totalFare=482.00, currency=USD, offerId=&lt;redacted-id&gt;
- Expected (§2.3): 200, price fields reconcile per §2.1 formula
- Actual: 200, totalFare=482.00, matches computed 482.00
- Status: **PASS**
- Evidence: computed 460.00 base + 22.00 tax = 482.00, matches totalFare

<!-- Example of a flow-level test case with nested hop detail (only render the "Hops" sub-list when
     this test case's log line actually has a `hops` array): -->

### TC-0430 — Flow #43 — V2, Family B, Hold

- Endpoint Name: Flow #43 (Search &rarr; FareConfirm &rarr; Book)
- Expected (§6.3): full chain completes, terminal Family-B state reached
- Actual: failed at Book — see hops below
- Status: **FAIL**

Hops (3):
  1. Search — Status: **PASS** — Response: 200, responseId captured — responseId captured
  2. FareConfirm — Status: **PASS** — Response: 200, totalFare=482.00 — price reconciled
  3. Book — Status: **FAIL** — Response: 500, empty body — 500, expected 200 per §2.9

<!-- ... one section per test_case line ... -->

## Findings

<!-- DATA: one entry per `finding` line; if none logged, write "No findings logged yet." instead -->

- **Unknown-resolution** — FareConfirm error shape for expired offerId confirmed as
  `{errorCode:'OFFER_EXPIRED'}` (§2.3, TC-0412)

## Proposed SPEC.md updates

<!-- DATA: one entry per spec_update_proposed; use the latest line per (section, old_text) for
     status; if none, write "No SPEC.md updates proposed yet." instead -->

- **§2.3 — pending** — Replace: `"Error shape for expired offerId: UNKNOWN"` With:
  `"Error shape for expired offerId: {errorCode:'OFFER_EXPIRED', httpStatus:400}"`

## Cleanup / follow-up

<!-- DATA: one entry per `cleanup` line; if none, write "Nothing left needing cleanup." instead -->

- Family-B hold — PNR `ABC123` (TC-0430) — expires per holdExpirationDate

<!-- Project type (scripts/project-type.js): add `**Project Type:** UI | API | Mixed (N UI, M API)` to the header
     lines, and a `**WARNING type mismatch:** <TC-ID> declared <x>, data says <y>` line per corrected test case.
     A UI test case labels its three request-shaped bullets "Feature" / "Steps performed" / "Observed" instead of
     "Endpoint Name" / "Request" / "Response", and nests its steps as "Step N" (not "Hop N"). -->
