# Krave Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local internal showcase web app in `projects/krave-ops-showcase/` that presents the Krave automation system as a truthful operations briefing with workflow status cards, impact metrics, and a recent progress timeline.

**Architecture:** Use a small static app with one HTML file, one CSS file, and one JavaScript file. Keep the content data in JavaScript as structured objects so the page stays easy to update while remaining local-only and backend-free.

**Tech Stack:** HTML, CSS, vanilla JavaScript

---

## File Structure

- Create: `projects/krave-ops-showcase/index.html`
- Create: `projects/krave-ops-showcase/styles.css`
- Create: `projects/krave-ops-showcase/app.js`
- Create: `projects/krave-ops-showcase/README.md`

## Task 1: Scaffold The Static App

**Files:**
- Create: `projects/krave-ops-showcase/index.html`
- Create: `projects/krave-ops-showcase/styles.css`
- Create: `projects/krave-ops-showcase/app.js`
- Create: `projects/krave-ops-showcase/README.md`

- [ ] **Step 1: Write the failing smoke test by checking the app files do not exist yet**

Run:

```powershell
Test-Path projects/krave-ops-showcase/index.html
Test-Path projects/krave-ops-showcase/styles.css
Test-Path projects/krave-ops-showcase/app.js
```

Expected:

```text
False
False
False
```

- [ ] **Step 2: Create the HTML shell**

Write `projects/krave-ops-showcase/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Krave Ops Showcase</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div class="page-shell">
      <header class="hero" id="hero"></header>
      <main class="content-grid">
        <section class="impact-strip" id="impact"></section>
        <section class="workflow-board" id="workflows"></section>
        <section class="assessment-panel" id="assessment"></section>
        <section class="timeline-panel" id="timeline"></section>
      </main>
    </div>
    <script src="./app.js"></script>
  </body>
  </html>
```

- [ ] **Step 3: Create the starter content script**

Write `projects/krave-ops-showcase/app.js`:

```js
const appRoot = {
  hero: document.getElementById('hero'),
  impact: document.getElementById('impact'),
  workflows: document.getElementById('workflows'),
  assessment: document.getElementById('assessment'),
  timeline: document.getElementById('timeline'),
};

for (const [key, node] of Object.entries(appRoot)) {
  if (!node) {
    throw new Error(`Missing mount point: ${key}`);
  }
}

appRoot.hero.innerHTML = '<p>Krave showcase booted.</p>';
appRoot.impact.innerHTML = '<p>Impact area pending.</p>';
appRoot.workflows.innerHTML = '<p>Workflow board pending.</p>';
appRoot.assessment.innerHTML = '<p>Assessment pending.</p>';
appRoot.timeline.innerHTML = '<p>Timeline pending.</p>';
```

- [ ] **Step 4: Create the starter stylesheet**

Write `projects/krave-ops-showcase/styles.css`:

```css
:root {
  color-scheme: light;
  --bg: #f4f0e8;
  --panel: rgba(255, 252, 245, 0.82);
  --panel-strong: #fffaf0;
  --text: #1a1814;
  --muted: #645d52;
  --line: rgba(33, 28, 22, 0.12);
  --accent: #0f5b52;
  --accent-soft: #d8ece7;
  --warn: #a85f14;
  --warn-soft: #f4e2c8;
  --danger: #8f3f2d;
  --danger-soft: #f0d7cf;
  --shadow: 0 24px 60px rgba(60, 41, 22, 0.1);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "Manrope", sans-serif;
  color: var(--text);
  background:
    radial-gradient(circle at top left, rgba(15, 91, 82, 0.12), transparent 28%),
    radial-gradient(circle at top right, rgba(168, 95, 20, 0.1), transparent 25%),
    linear-gradient(180deg, #f6f1e7 0%, #eee6da 100%);
}

.page-shell {
  width: min(1180px, calc(100% - 32px));
  margin: 0 auto;
  padding: 32px 0 56px;
}
```

- [ ] **Step 5: Add a local README**

Write `projects/krave-ops-showcase/README.md`:

```md
# Krave Ops Showcase

Local internal demo page for the Krave automation system.

## Run

Open `index.html` in a browser, or serve the folder with a simple static server.
```

- [ ] **Step 6: Run a smoke check to verify the files now exist**

Run:

```powershell
Test-Path projects/krave-ops-showcase/index.html
Test-Path projects/krave-ops-showcase/styles.css
Test-Path projects/krave-ops-showcase/app.js
```

Expected:

```text
True
True
True
```

- [ ] **Step 7: Commit**

```bash
git add projects/krave-ops-showcase/index.html projects/krave-ops-showcase/styles.css projects/krave-ops-showcase/app.js projects/krave-ops-showcase/README.md
git commit -m "feat: scaffold krave showcase app"
```

## Task 2: Add The Actual Showcase Content Model

**Files:**
- Modify: `projects/krave-ops-showcase/app.js`

- [ ] **Step 1: Write the failing content test by checking the placeholder text still exists**

Run:

```powershell
Get-Content projects/krave-ops-showcase/app.js
```

Expected:

```text
Contains "pending." placeholder copy
```

- [ ] **Step 2: Replace the placeholder script with a structured data model and render helpers**

Replace `projects/krave-ops-showcase/app.js` with:

```js
const showcase = {
  hero: {
    eyebrow: 'Internal Ops Briefing',
    title: 'Krave Automation System',
    summary:
      'A local showcase of the operating layer built around invoices, payment visibility, reminders, inbox triage, and daily reporting.',
    callout:
      'This system reduces dependence on one person manually checking status, following up, and relaying updates across the team.',
  },
  metrics: [
    { label: 'Invoice handling', value: 'Near-instant', tag: 'Projected' },
    { label: 'Payment lookups', value: '0 / week', tag: 'Projected' },
    { label: 'Missed follow-up', value: 'None', tag: 'Projected' },
    { label: 'Team notification', value: 'Automatic', tag: 'Projected' },
  ],
  workflows: [
    {
      name: 'Invoice Intake',
      status: 'Working',
      summary: 'Slack invoice requests are captured into a structured workflow instead of relying on ad hoc messages.',
      proof: 'Useful now for routing work consistently.',
    },
    {
      name: 'Draft Invoice Creation',
      status: 'Working',
      summary: 'Invoice requests can be turned into draft invoice work without rebuilding details manually each time.',
      proof: 'Needs repeated live runs for stronger confidence.',
    },
    {
      name: 'Payment Detection',
      status: 'Working',
      summary: 'Incoming payment signals can be surfaced automatically so strategists do not have to ask for status.',
      proof: 'Core value is immediate visibility.',
    },
    {
      name: 'Invoice Reminders',
      status: 'Working',
      summary: 'Reminder flow exists so follow-up does not depend on someone remembering who to chase.',
      proof: 'Still benefits from more end-to-end proving.',
    },
    {
      name: 'Inbox Triage Daily',
      status: 'Needs Live Proof',
      summary: 'Daily inbox triage drafts replies, labels messages, and posts summaries.',
      proof: 'Working logic, but it still needs repeated real-run validation.',
    },
    {
      name: 'EOD Triage Summary',
      status: 'Working',
      summary: 'End-of-day summary compacts operational updates into a shareable daily wrap-up.',
      proof: 'Useful as an archive and carry-over source.',
    },
    {
      name: 'Start Of Day Report',
      status: 'Under Fix',
      summary: 'Morning report logic exists, but archived-message parsing has needed live debugging.',
      proof: 'Close to useful, but not fully trusted yet.',
    },
  ],
  assessment: {
    working: [
      'Core workflows for intake, reminders, payment visibility, inbox triage, and reporting now exist in one system.',
      'The system is already useful because it reduces repeated manual coordination work.',
      'Recent work includes real live fixes and redeploys, not just planning.',
    ],
    unproven: [
      'The full chain still needs more end-to-end live testing.',
      'Some workflows have required real-world fixes after deployment.',
      'Useful does not yet mean fully proven under repeated daily use.',
    ],
    next: [
      'Run full-path live tests across request, invoice, payment detection, reminders, and reporting.',
      'Confirm multi-day reliability without manual rescue.',
      'Replace projected impact with measured outcomes once the system runs cleanly for long enough.',
    ],
  },
  timeline: [
    {
      date: '2026-04-22',
      title: 'SOD parser hardened',
      detail: 'Fixed Start Of Day parsing against archived bot-authored EOD messages and preserved real line breaks.',
      next: 'Rerun against live Slack data and confirm reliable carry-over.',
    },
    {
      date: '2026-04-22',
      title: 'SOD fallback relaxed',
      detail: 'Morning Triage was made optional so SOD can still send using yesterday’s EOD plus John’s morning dump.',
      next: 'Confirm stable morning inputs in real use.',
    },
    {
      date: '2026-04-22',
      title: 'Inbox triage live repair',
      detail: 'Gmail draft creation and label lookup path were repaired on the active workflow.',
      next: 'Tighten scanning to only process truly new email.',
    },
    {
      date: '2026-04-21',
      title: 'Workflow drift repair pushed',
      detail: 'Krave workflow drift fixes were committed and pushed after live verification.',
      next: 'Keep repo and production behavior in sync.',
    },
    {
      date: '2026-04-21',
      title: 'Start Of Day launched',
      detail: 'SOD reporting was built into a live workflow with delivery to archive and Noa DM.',
      next: 'Reduce rescue cases and harden upstream parsing.',
    },
    {
      date: '2026-04-21',
      title: 'Inbox Triage Daily finalized',
      detail: 'Inbox triage was completed to classify mail, create drafts, apply labels, and post summaries.',
      next: 'Prove reliability through repeated live runs.',
    },
  ],
};

const appRoot = {
  hero: document.getElementById('hero'),
  impact: document.getElementById('impact'),
  workflows: document.getElementById('workflows'),
  assessment: document.getElementById('assessment'),
  timeline: document.getElementById('timeline'),
};

function renderHero() {
  appRoot.hero.innerHTML = `
    <div class="hero-copy">
      <p class="eyebrow">${showcase.hero.eyebrow}</p>
      <h1>${showcase.hero.title}</h1>
      <p class="hero-summary">${showcase.hero.summary}</p>
    </div>
    <aside class="hero-callout">
      <span class="pill">System Intent</span>
      <p>${showcase.hero.callout}</p>
    </aside>
  `;
}

function renderMetrics() {
  appRoot.impact.innerHTML = `
    <div class="section-heading">
      <p class="eyebrow">Impact</p>
      <h2>Operational effect</h2>
    </div>
    <div class="metric-grid">
      ${showcase.metrics
        .map(
          (metric) => `
            <article class="metric-card">
              <p class="metric-tag">${metric.tag}</p>
              <strong>${metric.value}</strong>
              <span>${metric.label}</span>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderWorkflows() {
  appRoot.workflows.innerHTML = `
    <div class="section-heading">
      <p class="eyebrow">Workflow Board</p>
      <h2>What is live, what needs proof, what is being fixed</h2>
    </div>
    <div class="workflow-grid">
      ${showcase.workflows
        .map(
          (workflow) => `
            <article class="workflow-card status-${workflow.status.toLowerCase().replace(/\\s+/g, '-')}">
              <div class="card-topline">
                <h3>${workflow.name}</h3>
                <span class="status-pill">${workflow.status}</span>
              </div>
              <p>${workflow.summary}</p>
              <p class="card-proof">${workflow.proof}</p>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderAssessment() {
  const sections = [
    ['What’s Working', showcase.assessment.working],
    ['What’s Not Yet Proven', showcase.assessment.unproven],
    ['What’s Needed Next', showcase.assessment.next],
  ];

  appRoot.assessment.innerHTML = `
    <div class="section-heading">
      <p class="eyebrow">Honest Assessment</p>
      <h2>Operational truth over polished storytelling</h2>
    </div>
    <div class="assessment-grid">
      ${sections
        .map(
          ([title, items]) => `
            <article class="assessment-card">
              <h3>${title}</h3>
              <ul>
                ${items.map((item) => `<li>${item}</li>`).join('')}
              </ul>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderTimeline() {
  appRoot.timeline.innerHTML = `
    <div class="section-heading">
      <p class="eyebrow">Recent Progress</p>
      <h2>Momentum over time</h2>
    </div>
    <div class="timeline-list">
      ${showcase.timeline
        .map(
          (entry) => `
            <article class="timeline-item">
              <div class="timeline-date">${entry.date}</div>
              <div class="timeline-body">
                <h3>${entry.title}</h3>
                <p>${entry.detail}</p>
                <p class="timeline-next">Next: ${entry.next}</p>
              </div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

renderHero();
renderMetrics();
renderWorkflows();
renderAssessment();
renderTimeline();
```

- [ ] **Step 3: Run a content check to verify the placeholder copy is gone**

Run:

```powershell
Get-Content projects/krave-ops-showcase/app.js
```

Expected:

```text
Contains "Krave Automation System" and no "pending." placeholder copy
```

- [ ] **Step 4: Commit**

```bash
git add projects/krave-ops-showcase/app.js
git commit -m "feat: add krave showcase content model"
```

## Task 3: Build The Full UI Presentation

**Files:**
- Modify: `projects/krave-ops-showcase/styles.css`

- [ ] **Step 1: Write the failing visual test by checking the stylesheet lacks section and card classes**

Run:

```powershell
Get-Content projects/krave-ops-showcase/styles.css
```

Expected:

```text
Missing selectors like ".hero-copy", ".workflow-card", and ".timeline-item"
```

- [ ] **Step 2: Expand the stylesheet into the full command-center layout**

Append to `projects/krave-ops-showcase/styles.css`:

```css
.hero {
  display: grid;
  grid-template-columns: 1.5fr 0.95fr;
  gap: 20px;
  margin-bottom: 22px;
}

.hero-copy,
.hero-callout,
.impact-strip,
.workflow-board,
.assessment-panel,
.timeline-panel {
  background: var(--panel);
  backdrop-filter: blur(12px);
  border: 1px solid var(--line);
  border-radius: 28px;
  box-shadow: var(--shadow);
}

.hero-copy,
.hero-callout {
  padding: 30px;
}

.eyebrow {
  margin: 0 0 12px;
  font-family: "IBM Plex Mono", monospace;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}

.hero h1,
.section-heading h2 {
  margin: 0;
  line-height: 0.95;
  letter-spacing: -0.04em;
}

.hero h1 {
  font-size: clamp(3rem, 8vw, 6rem);
  max-width: 10ch;
}

.hero-summary,
.hero-callout p,
.workflow-card p,
.assessment-card li,
.timeline-body p {
  color: var(--muted);
  line-height: 1.6;
}

.hero-callout {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: linear-gradient(180deg, rgba(15, 91, 82, 0.08), rgba(255, 250, 240, 0.88));
}

.pill,
.status-pill,
.metric-tag {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  font-family: "IBM Plex Mono", monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.pill,
.metric-tag {
  background: var(--accent-soft);
  color: var(--accent);
}

.content-grid {
  display: grid;
  gap: 22px;
}

.impact-strip,
.workflow-board,
.assessment-panel,
.timeline-panel {
  padding: 28px;
}

.section-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.section-heading h2 {
  font-size: clamp(1.8rem, 3vw, 2.8rem);
  max-width: 16ch;
}

.metric-grid,
.workflow-grid,
.assessment-grid {
  display: grid;
  gap: 16px;
}

.metric-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.metric-card,
.workflow-card,
.assessment-card {
  padding: 20px;
  border-radius: 22px;
  border: 1px solid var(--line);
  background: var(--panel-strong);
}

.metric-card strong {
  display: block;
  margin: 18px 0 8px;
  font-size: 2rem;
  line-height: 1;
}

.metric-card span {
  color: var(--muted);
}

.workflow-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.workflow-card {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: transform 180ms ease, box-shadow 180ms ease;
}

.workflow-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 40px rgba(39, 28, 18, 0.12);
}

.card-topline {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.workflow-card h3,
.assessment-card h3,
.timeline-body h3 {
  margin: 0;
  font-size: 1.2rem;
}

.status-pill {
  border: 1px solid currentColor;
}

.status-working .status-pill {
  color: var(--accent);
  background: var(--accent-soft);
}

.status-needs-live-proof .status-pill {
  color: var(--warn);
  background: var(--warn-soft);
}

.status-under-fix .status-pill {
  color: var(--danger);
  background: var(--danger-soft);
}

.card-proof {
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.assessment-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.assessment-card ul {
  margin: 14px 0 0;
  padding-left: 20px;
}

.timeline-list {
  display: grid;
  gap: 14px;
}

.timeline-item {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 18px;
  padding: 18px 0;
  border-top: 1px solid var(--line);
}

.timeline-item:first-child {
  border-top: 0;
  padding-top: 0;
}

.timeline-date {
  font-family: "IBM Plex Mono", monospace;
  color: var(--accent);
  font-size: 12px;
  letter-spacing: 0.08em;
}

.timeline-next {
  color: var(--text);
  font-weight: 600;
}

@media (max-width: 980px) {
  .hero,
  .metric-grid,
  .workflow-grid,
  .assessment-grid,
  .timeline-item {
    grid-template-columns: 1fr;
  }

  .hero h1 {
    max-width: none;
  }
}
```

- [ ] **Step 3: Run a visual structure check**

Run:

```powershell
Get-Content projects/krave-ops-showcase/styles.css
```

Expected:

```text
Contains ".workflow-card", ".assessment-grid", and "@media (max-width: 980px)"
```

- [ ] **Step 4: Commit**

```bash
git add projects/krave-ops-showcase/styles.css
git commit -m "feat: style krave showcase interface"
```

## Task 4: Final QA And Local Run Instructions

**Files:**
- Modify: `projects/krave-ops-showcase/README.md`

- [ ] **Step 1: Write the failing doc test by checking the README only has the short placeholder**

Run:

```powershell
Get-Content projects/krave-ops-showcase/README.md
```

Expected:

```text
Contains only the short local run note and no section list
```

- [ ] **Step 2: Expand the README with usage and truthfulness notes**

Replace `projects/krave-ops-showcase/README.md` with:

```md
# Krave Ops Showcase

Local internal demo page for the Krave automation system.

## Purpose

This page is an internal-facing showcase of the current automation system around invoices, payment visibility, reminders, inbox triage, and reporting.

It is intentionally honest:
- it shows what is working
- it marks what still needs proof
- it uses projected metrics where measured data does not yet exist

## Files

- `index.html` - page shell
- `styles.css` - visual system and layout
- `app.js` - showcase content data and rendering

## Run

Open `index.html` in a browser, or serve the folder with a simple static server.

Example:

```powershell
cd projects/krave-ops-showcase
python -m http.server 4173
```

Then open `http://localhost:4173`.
```

- [ ] **Step 3: Run a final content smoke test**

Run:

```powershell
Get-Content projects/krave-ops-showcase/index.html
Get-Content projects/krave-ops-showcase/styles.css
Get-Content projects/krave-ops-showcase/app.js
Get-Content projects/krave-ops-showcase/README.md
```

Expected:

```text
All files exist and reflect the final showcase structure
```

- [ ] **Step 4: Commit**

```bash
git add projects/krave-ops-showcase/README.md
git commit -m "docs: add krave showcase usage notes"
```

## Self-Review

- Spec coverage: hero briefing, impact strip, workflow board, honest assessment, and timeline each have a dedicated task and exact file path.
- Placeholder scan: no TODO or TBD placeholders remain in the plan.
- Type consistency: HTML mount ids match the JavaScript render targets, and the CSS selectors match the class names introduced in the plan.
