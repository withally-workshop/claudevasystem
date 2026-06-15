---
name: creator-invoice-processing
description: Use when Codex needs to process creator or vendor invoices for Airwallex bill creation. Triggers include "/invoice-triage", "process invoices", "run invoice triage", "check payment channel", "stage invoice", "create bill". Handles PDF invoices from email (john@kravemedia.co), Slack #payments-invoices-updates, and Slack DMs. Validates each invoice (bank details hardstop, due date, invoice number), creates draft bills in Airwallex Spend via API, confirms to requester, and logs to the Bills tab on the Client Invoice Tracker.
metadata:
  short-description: Process creator invoices into Airwallex draft bills
---

# Creator Invoice Processing

> **PREP & HANDOFF MODEL (2026-06-15).** We do NOT create bills via API — Airwallex can't make a DRAFT or attach a PDF until ~Aug 2026, and API bills land `AWAITING_PAYMENT` (unuploadable). Email-forward is broken. So the automation parses/validates/does FX, posts a **ready-to-create prep package to #ops-command**, replies to the team (feels automated), and logs the tracker. **John creates the DRAFT bill manually** (vendor → fields → upload PDF → submit). Flips to auto-create in Aug 2026.

> **Incident guards (2026-06-12 + 2026-06-15) — all paths.** PDF-only; classify is-invoice before extraction; one reply per message; **HARDCODED SENDER ALLOWLIST** — reply ONLY to John, Noa, Jeneena, Amanda, Shin, Sybil (@kravemedia.co). ANY other sender → no reply, #ops-command flag only. See [[external_autoreply_guards]].

Receive PDF invoices → classify → validate → vendor match + FX math → prep package to #ops-command → reply once (allowlisted senders) → log tracker. John creates the draft manually. Noa pays Thursdays.

## How to Trigger

**Real-time (krave-bot):** Fires when the bot gets a Slack DM with a PDF or a strategist @mentions Claude EA in #payments-invoices-updates with a PDF.

**Email (`DbIJYYQ3FE4HKprB`):** **DEACTIVATED** 2026-06-15 (ungated success reply + broken forward) — pending a prep-and-handoff rebuild. John handles emailed invoices manually for now.

**Manual skill run:** Follow `.claude/skills/creator-invoice-processing/SKILL.md` step-by-step.

## Key References

- **Full SOP:** `references/sops/creator-invoice-management.md`
- **Claude Code skill:** `.claude/skills/creator-invoice-processing/SKILL.md`
- **#payments-invoices-updates:** C09HN2EBPR7
- **Creator & AP Bills Tracker:** `14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`, tab: `Krave — Creator & AP Bills Tracker`

## What It Does (prep & handoff)

1. Scans #payments-invoices-updates / DMs for unprocessed invoice PDFs (Slack cursor + ✅ + tracker `external_id` dedup)
2. **SENDER ALLOWLIST** — only act-with-reply for John/Noa/Jeneena/Amanda/Shin/Sybil; any other sender → #ops-command flag, no reply
3. Parses + **classifies is-invoice** — extracts payee, invoice #, dates, amount, currency, line items, bank details
4. Validates: hardstop no PDF / no bank details. Invoice # missing → `INV-`+7 digits. Currency missing → infer from bank country. Due date → use invoice's exactly, never invent; Friday PHT only if absent
5. **Matches vendor** (payee, not sender) against live `airwallex_list_vendors` + alias table — REPORTS exists/NEW, does NOT create
6. **Converts currency** if invoice ccy ≠ payout ccy (Butanas→PHP, Domingo→USD, Baste→SGD) — `airwallex_fx_rate` × 0.97 + 🚨 CONVERTED
7. **Posts prep package to #ops-command** (vendor, fields, FX'd amount, bank, PDF link) — John creates the DRAFT bill manually
8. Replies **once** (allowlisted senders only) — plain "Received — staged for payment", NEVER any Airwallex link/ID
9. Logs to tracker, status `Prepped — awaiting manual creation`, Bill ID blank (John fills after creating)

**Email path (n8n `DbIJYYQ3FE4HKprB`) is deactivated** (rebuild to prep-and-handoff pending). krave-bot uses the same prep-and-handoff flow as above.

## Dedup Signals

- ✅ (`white_check_mark`) reaction = already processed — never reprocess
- Slack cursor — only fetch messages after last processed ts
- Tracker `external_id` check — skip if row already exists

## Validation Hardstops

- **Blocked sender** → drop entirely. Never parse, reply to, forward, log, or mark read any email from `airwallex.com` (+ subdomains), `no-reply`/`noreply`, `notifications@`, or `mailer-daemon`. Leave untouched in inbox. **NEVER reply to Airwallex.** Do **not** block `kravemedia.co` — strategists manage creators and send/forward invoices, sometimes from that domain. Enforced by `-from:airwallex.com` query + `isBlockedSender()` backstop in the email-scan workflow.
- **No PDF** → reply asking for invoice, do nothing else
- **No bank details in PDF** → return to sender, ask to reissue

## Codex Invocation Notes

- Run order: dedup → allowlist check → parse + classify → validate → match vendor (report) → convert currency → prep package to #ops-command → reply once (allowlisted) → log → cursor
- NO bill creation — John creates the DRAFT manually from the prep package. Do NOT call `airwallex_create_bill` / `airwallex_create_vendor` (kept for the Aug 2026 auto-create flip).
- Vendor = invoice payee, not sender. Reply ONLY to the hardcoded allowlist (John/Noa/Jeneena/Amanda/Shin/Sybil); anyone else → #ops-command flag, no reply.
- Multiple PDFs in one request = one bill each, independent.
- Multiple PDFs in one email = one bill per PDF, each resolved/created/logged/replied independently
- Full step-by-step + reporting/flagging design: `.claude/skills/creator-invoice-processing/SKILL.md` and `references/sops/creator-invoice-management.md`
