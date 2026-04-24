# Krave Internal Showcase Design

Date: 2026-04-22
Audience: Internal/team demo
Primary goal: Show what is live, what is proven, what still needs work, and what comes next.

## Summary

Build a local web app inside `projects/` that presents the Krave automation system as an internal operations briefing rather than a marketing landing page. The page should feel credible, structured, and operational. It should show the system's current value without pretending everything is finished.

This is a hybrid format:
- a strong briefing-style top section
- dashboard-style workflow status cards underneath
- an honest assessment section that clearly separates what is working from what still needs proof
- a recent progress timeline using real session/work dates already established in the repo and session history

The page is for internal review, so it should optimize for trust and clarity over flash.

## User Experience

The page should answer four questions quickly:

1. What problem was this system built to solve?
2. What now exists in the workflow?
3. What is actually working today?
4. What still needs validation before the team can fully rely on it?

The reader should leave with the sense that:
- the system is already useful
- the work is real and actively progressing
- the current state is represented honestly

## Content Structure

### 1. Hero Briefing

Top section with:
- internal-facing headline
- short briefing paragraph
- compact callout describing the system as an operating layer for invoices, payment visibility, reminders, inbox triage, and daily reporting

This section should establish that the project reduces dependence on one person manually coordinating recurring work.

### 2. Impact Strip

A concise metrics band using only the metrics already discussed.

Rules:
- every metric must be labeled `Projected` or `Measured`
- if there is no measured evidence, use `Projected`
- do not invent analytics or charts

Expected content:
- invoice handling time reduction
- payment-status lookup reduction
- missed follow-up reduction
- strategist interruption reduction

### 3. Workflow Status Board

A grid of workflow cards showing the current state of the automation system. Cards should cover:
- Invoice Intake
- Draft Invoice Creation
- Payment Detection
- Invoice Reminders
- Inbox Triage Daily
- EOD Triage Summary
- Start Of Day Report

Each card should show:
- current status label
- short operational summary
- what makes it useful
- what still needs proof or hardening

Recommended status language:
- `Working`
- `Needs Live Proof`
- `Under Fix`

Avoid fake precision like percentages or uptime numbers.

### 4. Honest Assessment

This is the anchor section of the page.

It should be split into:
- What's Working
- What's Not Yet Proven
- What's Needed Next

This section should clearly state that the workflows are useful now but still need full end-to-end reliability validation in real use.

### 5. Recent Progress Timeline

Show 5-7 recent dated entries using the real work history already established:
- inbox triage completion and fixes
- SOD behavior changes
- SOD parsing/debugging for archived bot messages
- workflow drift repair
- invoice intake and Slack invoice handler progress

Each entry should be short and operational:
- date
- what changed
- what came next

## Visual Direction

Tone: sharp internal command center

Design goals:
- structured and serious
- readable at a glance
- strong editorial hierarchy
- no fake dashboard noise
- no generic AI startup look

Visual style:
- light interface
- crisp grid layout
- strong contrast
- restrained use of status colors
- expressive non-default typography
- subtle atmospheric background treatment

## Layout

Desktop:
- briefing-led top section
- metrics strip below
- status board in multi-column grid
- assessment section in distinct blocks
- timeline running down the page

Mobile:
- stacked single-column layout
- cards remain readable and scannable
- metrics collapse cleanly without becoming chart-like

## Interaction

Keep interactions light:
- hover states on workflow cards
- subtle entrance motion
- optional expanded detail on cards if easy to implement cleanly

Do not add:
- fake live data behavior
- noisy charts
- unnecessary filters
- over-animated dashboards

## Data Strategy

This should be a realistic mock internal panel, not a live data integration.

The page content will be static but based on real project facts already known from the repo and session history. No external APIs are required for v1.

## File Placement

Create the local app in `projects/` as a standalone showcase project so it stays near the rest of the work without mixing directly into the workflow source files.

Recommended project name:
- `projects/krave-ops-showcase/`

Expected files:
- `index.html`
- `styles.css`
- `app.js`
- optional `README.md`

## Constraints

- no fake charts or fabricated metrics
- no stack talk in the UI
- no feature list that is detached from operational value
- preserve a truthful distinction between useful and proven

## Success Criteria

The local app is successful if:
- it feels like a real internal briefing page
- it presents the automation system clearly to a team viewer
- it distinguishes working workflows from still-unproven ones
- it makes the project feel credible without overstating its maturity
- it runs locally with no backend required
