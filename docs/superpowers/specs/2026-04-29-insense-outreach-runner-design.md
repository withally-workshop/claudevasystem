# Insense Outreach Runner Design

Date: 2026-04-29
Status: Implemented
Scope: Standalone local Playwright runner for live review and send.

## Goal

Replace the conversation-driven Playwright MCP workflow for Insense creator outreach with a standalone local Playwright runner that can process a campaign end-to-end with much lower model usage and better runtime stability.

The runner now:

- logs into Insense with a persistent browser session
- opens a target campaign and loads its applications list
- extracts creator profile signals needed for quality screening
- separates `review` from `send`
- deduplicates against prior outreach using both local state and the existing chat-thread Typeform-link check
- sends the personalized database invite to creators marked `invite: true`
- persists run state locally
- outputs structured run reports

## Source Of Truth

Primary source materials in this repo:

- `.claude/skills/insense-creator-outreach/SKILL.md`
- `references/sops/insense-creator-outreach.md`
- `projects/insense-creator-database/README.md`

## Final Approach

Build one local Playwright CLI runner with two operating modes:

- `review`: extract applications, score quality, classify obvious skips, apply blocklist rules, and write the decision file
- `send`: read the decision file, reopen only eligible creators, verify dedup, send messages, and persist results immediately after each creator

This keeps Playwright reliability while removing the high-cost model-tool loop from the old MCP flow.

## Current Invite Policy

### Quality rules

- `portfolioUploads >= 1`
- `finishedDeals >= 1`
- `engagementRate >= 1`

### Blocklist rules

- `Previous Collaborator` -> `invite: false`

### Decision behavior

- quality fail -> skipped in review output
- quality pass and not blocklisted -> `invite: true`
- quality pass and blocklisted -> `invite: false` with `blockReason`

This replaced the earlier design assumption that every quality-passing creator required manual operator approval before send.

## File Structure

```text
projects/insense-creator-database/
|-- README.md
|-- package.json
|-- run-insense-outreach.mjs
|-- config.mjs
|-- lib/
|   |-- cli.mjs
|   |-- insense-session.mjs
|   |-- applications.mjs
|   |-- profile-parser.mjs
|   |-- decide.mjs
|   |-- messaging.mjs
|   |-- reporter.mjs
|   `-- state-store.mjs
|-- data/
|   |-- .gitignore
|   |-- storage-state.json
|   |-- creator-cache.json
|   |-- decisions/
|   `-- runs/
`-- tests/
```

## Live Verification Status

Verified in the real Insense brand workspace on `https://app.insense.pro/`:

- login and dashboard navigation
- campaign selection
- applicants-page traversal
- profile-drawer extraction
- username search
- chat-composer opening
- thread dedup scan
- live send path

## Outcome

The runner is now the preferred execution path for Insense creator outreach in this repo.
