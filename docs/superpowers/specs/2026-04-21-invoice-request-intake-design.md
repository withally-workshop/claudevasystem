# Invoice Request Intake Design

**Date:** 2026-04-21
**Status:** Approved for planning
**Primary goal:** Accept structured invoice requests from Slack, attempt full Airwallex draft invoice creation automatically, and fall back cleanly to a manual queue when any Airwallex step fails.

---

## Summary

This workflow fills the gap before the existing invoice reminder and payment detection automations. It turns a Slack-submitted invoice request into a structured billing job, attempts Airwallex draft invoice creation end-to-end, records the result in the tracker, and alerts John by Slack DM when fallback is required during testing.

Version 1 uses a structured Slack modal, supports multiple line items, resolves customers by company/client name rather than email, and stops at `draft invoice created`. It does not auto-send or auto-finalize invoices in Airwallex.

---

## Scope

### In scope

- Structured Slack modal intake
- Multiple line items per invoice request
- Validation and normalization of submitted invoice data
- Airwallex authentication
- Billing customer lookup by company/client name, with create-if-missing behavior
- Product creation per line item
- Price creation per line item
- Draft invoice creation in Airwallex
- Tracker writeback for both success and fallback cases
- Slack requester confirmation
- Slack DM alerts to John during testing

### Out of scope for v1

- Freeform Slack parsing
- Auto-send of invoices
- Auto-finalize of invoices
- Automatic retry loops beyond the immediate workflow path
- Human approval step before attempting Airwallex
- Stable product catalog management

---

## Recommended Architecture

Use a single n8n workflow with three logical stages:

1. `Slack Intake`
Receive a structured submission from a Slack modal and normalize it into one canonical request object.

2. `Airwallex Orchestration`
Attempt the full draft-invoice creation path using the submitted request data and per-line-item Billing objects.

3. `Persistence + Notification`
Write either the successful result or the fallback/manual-needed record to the tracker, then notify the requester and John appropriately.

This is the recommended approach because it keeps the automation closest to the user action while preserving a strong fallback path when Airwallex Billing access or object creation fails.

---

## Intake Design

### Trigger

The workflow starts from a structured Slack modal submission rather than freeform message parsing.

### Modal fields

Required top-level fields:

- Client/company name
- Currency
- Due date
- Requester
- Optional memo/notes

Optional top-level fields:

- Client email

Required line item fields:

- Description
- Quantity
- Unit price

The modal must support multiple line items in one request.

### Canonical request object

Each submission is normalized into one request object with this shape:

- `request_id`
- `submitted_at`
- `submitted_by_slack_user_id`
- `client_name`
- `client_email`
- `currency`
- `due_date`
- `memo`
- `line_items[]`
- `subtotal`
- `status`
- `airwallex_customer_id`
- `airwallex_invoice_id`
- `failure_stage`
- `failure_reason`

---

## Airwallex Execution Design

The workflow treats Airwallex as a per-request object graph build rather than relying on a fixed catalog.

### Step 1: Authenticate

Authenticate using the existing admin key flow and obtain the access token required for Billing API calls.

### Step 2: Resolve customer

Try to find an existing billing customer by `company name` or `client name`.

Rules:

- Name is the primary lookup key
- Email is optional metadata only
- If a single clear match exists, reuse it
- If no match exists, create a new billing customer
- If multiple plausible matches exist, do not guess; trigger fallback

### Step 3: Create products

Create one product per line item using the submitted line item description. Products are request-specific and should not assume a stable catalog.

### Step 4: Create prices

Create one one-time price per product using:

- workflow-level invoice currency
- submitted unit amount
- non-recurring configuration

### Step 5: Create invoice

Create the invoice shell associated with the resolved billing customer and submitted due-date/memo context.

### Step 6: Attach line items

Attach the created prices and submitted quantities to the invoice.

### Step 7: Stop at draft

If the invoice is created successfully, stop at `draft invoice created`.

V1 explicitly does **not**:

- send the invoice
- finalize the invoice

---

## Persistence Design

The existing tracker should remain as intact as possible. Add only the minimum extra fields needed for traceability and fallback handling.

Recommended additions:

- Request ID
- Source = `Slack Modal`
- Creation status
- Failure stage
- Failure reason
- Airwallex customer ID
- Airwallex invoice ID
- Structured line item payload or a durable serialized detail field

The tracker must answer:

- what was requested
- who requested it
- whether Airwallex draft creation succeeded
- what failed if it did not
- what still needs manual handling

---

## Status Model

Recommended request statuses:

- `intake_received`
- `airwallex_in_progress`
- `airwallex_created`
- `fallback_manual_required`
- `completed`
- `failed_validation`

These statuses should be used consistently in workflow branches, tracker writes, and notification messages.

---

## Fallback Design

Fallback exists to ensure no invoice request is lost while Billing access and API behavior are still being stabilized.

### Fallback triggers

Fallback should happen on any of these conditions:

- authentication failure
- customer lookup failure
- customer create failure
- ambiguous customer match
- product creation failure
- price creation failure
- invoice creation failure
- line item attach failure
- request validation failure

### Fallback output

When fallback happens, the workflow must:

- write a manual-ready tracker record
- preserve the full submitted line item payload
- record `failure_stage`
- record `failure_reason`
- DM John with a concise failure summary and invoice details

### Testing-mode alerting

While the workflow is being stabilized:

- all failures DM John
- successful draft creations may also DM John with the Airwallex draft invoice ID
- requester messaging should remain conservative until the Airwallex branch is trusted

---

## Notification Design

### Requester notifications

On successful draft creation:

- confirm that the invoice request was received
- confirm that an Airwallex draft invoice was created
- include a compact invoice summary

On fallback:

- confirm receipt of the request
- state that manual Airwallex creation is required
- avoid exposing noisy internal error detail to the requester

### John DM notifications

During testing, DM John on:

- all fallback/manual-required outcomes
- optionally all successful draft creations

The DM should include:

- request ID
- client/company name
- requester
- subtotal/currency
- line item summary
- failure stage
- failure reason
- Airwallex IDs if available

---

## Error Handling

### Validation errors

If required fields are missing or malformed:

- do not call Airwallex
- mark the request `failed_validation`
- write the request to the tracker for visibility
- DM John during testing

### Ambiguous customer resolution

If name-based lookup returns multiple plausible customers:

- do not guess
- do not continue invoice creation
- trigger fallback with candidate context

### Airwallex Billing access issues

Because earlier experiments produced `401` and `404` errors, the workflow should treat auth and endpoint failures as first-class operational states rather than rare exceptions. Failures must be surfaced clearly to John and written to the tracker with enough detail to diagnose whether the issue is:

- token/authentication
- wrong endpoint/path
- missing Billing entitlement
- bad request payload
- missing referenced object

---

## Testing Strategy

V1 should be tested in progressive slices:

1. Slack modal submission reaches the workflow and produces the canonical request object.
2. Tracker fallback write works even when Airwallex is intentionally bypassed.
3. Airwallex auth step is tested in isolation.
4. Customer resolution/create is tested in isolation.
5. Product and price creation are tested with a small multi-line invoice.
6. Draft invoice creation is tested without send/finalize.
7. End-to-end success and fallback branches both confirm the right tracker writes and Slack notifications.

---

## Open Assumptions Locked For V1

- Slack modal is the only intake surface
- Multiple line items are required
- Customer lookup is by company/client name first, not by email
- Client email is optional
- Products are dynamic and request-specific
- V1 stops at `draft invoice created`
- Failures DM John directly during testing

---

## Success Criteria

The workflow is successful when:

- a structured Slack submission reliably creates a normalized invoice request
- the workflow can attempt the full Airwallex draft invoice path automatically
- successful requests create draft invoices without manual intervention
- failed requests are never lost and always become manual-ready tracker records
- John receives enough diagnostic detail in Slack DM to debug failures quickly

