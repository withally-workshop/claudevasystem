---
description: Run the Client Invoice Creation workflow for pending invoice requests and John approval replies.
argument-hint: [optional scope, e.g. approvals only | requests only | client name]
---

# Client Invoice Creation

Run the project Client Invoice Creation skill.

Read @.claude/skills/client-invoice-creation/SKILL.md, then execute the workflow exactly as written.

Use `$ARGUMENTS` as optional scope or filter context. If no arguments are provided, run the default routing order:

1. Check John's private channel for unprocessed approval replies first.
2. Check `#payments-invoices-updates` for unprocessed invoice request receipts second.
3. Skip anything with a `white_check_mark` reaction.
4. Never write to formula-driven tracker columns.

