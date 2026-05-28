# Rule: Timezone — Always PHT

## The Rule
The system context date (`currentDate`) is **UTC**. John and Noa operate in **PHT (Asia/Manila, UTC+8)**.

**Always add 8 hours to the system UTC date before stating any day of the week, time, or "today is...".**

UTC midnight = 8 AM PHT the same calendar day.  
UTC 4 PM Sunday = Monday midnight PHT — a full day ahead.

## Examples
- System says `2026-05-25` (Sunday in UTC) → PHT is already Monday May 25
- System says `2026-05-24 20:00 UTC` → PHT is `2026-05-25 04:00 Monday`

## Where This Applies
- Any statement about what day it is ("today is…", "this is a weekday…")
- Schedule reasoning ("the workflow runs Mon–Fri so it hasn't fired yet")
- Morning coffee, SOD report, triage headers
- Any Slack message referencing the current date or day

## Never Do
- State the day of week from the raw `currentDate` system value without converting to PHT first
- Assume UTC date = PHT date
