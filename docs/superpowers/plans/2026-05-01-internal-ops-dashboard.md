# Internal Ops Dashboard Plan

Date: 2026-05-01  
Audience: Krave team  
Status: Planning only

## Goal

Build a private internal dashboard for the ops report so the team can see, at a glance, whether the invoice system is creating invoices, sending reminders, getting replies, and turning follow-ups into payments. The dashboard should feel like a live visibility surface for the system we already built, not a marketing page or a static snapshot.

## Core Decision

Use Google login for access control. This keeps the dashboard private to the team and avoids a shared password gate.

## What The Dashboard Should Prove

The first version should answer four questions quickly:

1. What invoices were created or finalized recently?
2. What reminders were sent, what replies came back, and which ones led to payment?
3. What is next in the reminder queue, including late-fee or collections timing?
4. What is currently healthy or broken in the automation system?

## Data Sources

The dashboard should read live from the existing system of record:

- Google Sheets invoice tracker
- n8n workflow execution history
- Slack context from the payment and draft channels

The browser should not hold API keys. All data access should happen server-side.

## Proposed Layout

### Top Section

Start with a visibility summary that shows:

- invoices created
- invoices finalized or sent
- reminders sent
- replies confirmed
- payments received after follow-up
- open follow-up queue

This section should make the system’s value obvious before any detail tables appear.

### Middle Sections

Show the operational details in separate blocks:

- invoice creation and approval flow
- payment reminder performance
- reply attribution and confidence
- next follow-ups and escalation dates
- workflow health and failures

### Bottom Section

Move source caveats, missing-data notes, and partial-access warnings to the bottom. The report should still be honest, but caveats should not lead the page.

## Features And Controls

The first version should include a small set of controls that are actually useful:

- refresh button
- date range controls such as week-to-date, month-to-date, and custom range
- owner filter
- status filter
- links out to the source tracker and n8n workflows
- copy-summary action for Slack or chat reuse

## Live Data Rules

The dashboard should be live-read only. It should not write back to Sheets, Slack, or n8n.

The live layer should support:

- current tracker state
- reminder history
- client reply state
- next follow-up schedule
- payment status after follow-up
- recent workflow failures

If one source is unavailable, the dashboard should degrade gracefully and label the missing source clearly instead of guessing.

## Suggested Implementation Shape

Use a small internal web app, likely Next.js, with server-side data fetching and Google login protection. The app should be private, deployable internally, and easy to refresh without reopening the local HTML snapshot.

## Rollout Plan

### Phase 1: Spec Finalization

Lock the information architecture, data fields, and authentication choice. The goal here is to decide what the team needs to see before building any UI.

### Phase 2: Data Contract

Define the exact fields to pull from Sheets, Slack, and n8n, and decide how the dashboard will label missing or uncertain data.

### Phase 3: Dashboard Build

Implement the private app, wire Google login, and render the live report sections.

### Phase 4: Verification

Check that the dashboard shows the correct invoice counts, reminder counts, reply counts, and next-follow-up timing from real source data.

### Phase 5: Usability Pass

Adjust the layout so the team can use it quickly during daily review without digging through raw source systems.

## Open Questions

- Whether the dashboard should live in the existing repo or a separate internal app
- Whether access should be limited by Google Workspace domain only or by a narrower allowlist
- Whether the first release should include manual links to Sheets and n8n or also include deep-link drilldowns for specific invoices
- Whether the dashboard should cache results briefly for speed or read live on every request

## Non-Goals

This dashboard plan does not change the underlying invoice workflows. It does not add a new automation source of truth, and it does not replace the existing ops report skill. It only changes how the team views the system.

