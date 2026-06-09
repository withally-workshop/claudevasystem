# Rule: Doc Freshness — No Inventories, No Stale Labels

## The Rule

Documents describe **invariants**; directories and registries describe **inventories**. Never add a list of skills, projects, workflows, or MCP servers to CLAUDE.md, README.md, or context files — point to the source of truth instead (see the Source-of-Truth table in CLAUDE.md).

## When Creating or Changing Anything

1. **New/changed skill or workflow** → follow `.claude/rules/skill-and-workflow-creation.md` (both skill trees + routing map + n8n docs). The pre-commit hook warns on violations — fix them, don't `SKIP_SYNC_CHECK` past them.
2. **Behavior fix** → follow `.claude/rules/cross-cutting-fixes.md`; the doc-sync PostToolUse hook will list the sibling files to update.
3. **Any edit to CLAUDE.md** → update its `Last updated:` date stamp.
4. **Decisions** → append to `decisions/log.md` in the same round; if it changes priorities, update `context/current-priorities.md` too.

## Forbidden Stale Patterns

- Timezone labels other than PHT / Asia/Manila / UTC+8 (no ICT, SGT, GMT+7, Asia/Bangkok) — pre-commit warns on these.
- Credentials in any committed file — pre-commit BLOCKS these. Secrets live only in `.env` and `.mcp.json`.
- `TBD` workflow IDs left in WORKFLOWS.md/README.md after deploy.
- Doc claims about schedules/IDs that haven't been verified against the live n8n instance in the same session.

## Periodic Check

When asked for a repo health check (or roughly monthly), run the pre-commit checks against the full tree, verify the routing map covers every skill directory, and spot-check WORKFLOWS.md index rows against `GET /api/v1/workflows` on the live instance.
