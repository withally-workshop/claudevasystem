# Insense Outreach — Message Template

Single source of truth for the outreach message. Both `insense-triage` and `insense-send` skills read from here.

## Substitution

- `{firstName}` ← creator's first name; falls back to username (without leading `@`); falls back to `there`.

## Template

```
Hey {firstName},

Thanks for applying to our project on Insense. We loved your work and wanted to reach out personally. You weren't quite the right fit for that specific brief, but we absolutely want to keep working with you!

We're Krave Media and we work with some of the fastest-growing DTC brands in the US.
We'd love for you to join our own creator network so our strategists can match you directly to briefs. If you join, you get:

- First look at paid briefs matched to your niche
- Set your own UGC rates - keep 100% of what you earn
- Work directly with the brand team
- Early access to our private creator Discord - jobs board, work-sharing, and direct line to our brand partners
- Long-term relationships - most of our creators work 6+ campaigns a year with us

It just takes 5 min to fill out:
https://form.typeform.com/to/lAPIxgqv

Once you're in, our strategist team will reach out directly with briefs that match you!
Excited to have you on the team! :)

Cheers,
Krave Media Creator Team
```

## Dedup signal

The Typeform URL `https://form.typeform.com/to/lAPIxgqv` doubles as the dedup marker. The send skill scans the conversation body for this URL before sending — if present, the creator already received the invite and is skipped.
