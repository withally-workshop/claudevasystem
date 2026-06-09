# LinkedIn Post and Newsletter Automation Flow

**For:** the team member managing Noa's LinkedIn posts + resource DMs
**Owner:** Noa Takhel
**Source:** ClickUp task #86exkj821
**Last updated:** 2026-05-14

---

## What this document is

Operating manual for how Noa's LinkedIn posts get made, where they live in ClickUp, and what the team member needs to do every day to keep the engine running.

Read it front to back once, then bookmark — the **Resource → Newsletter Link table** is the thing you'll come back to most often.

The system is built so Noa can sit down on a Sunday, prep the week's posts in 90 minutes, and have everything queued for review. The team handles the daily mechanics: confirming posts went up, watching for comment triggers on resource posts, and sending the right newsletter link to anyone who asks for a resource on LinkedIn.

---

## 🎯 The goal

**One LinkedIn post per day from Noa's profile. Seven posts a week. No off days.**

Consistency matters more than perfection. Even if a post feels "mid", it goes up. Skipping days kills the algorithm momentum built over the last year and is way more expensive than a slightly weaker post.

---

## 📋 The three types of posts

Every post falls into one of three categories. Knowing which one you're looking at tells you what to expect from comments and what your job is for that post.

### 1. Generic posts (with images)

Educational or opinion content about direct response advertising, creative strategy, AI in marketing, the state of DTC, what is working in ads right now. Almost always have an infographic, photo, or carousel image attached.

- 💬 **Comments:** general discussion, agreement, pushback, people sharing their own takes.
- ✅ **You do:** nothing special. Noa replies in comments when she has time.

### 2. Lifestyle posts

Personal moments. Mom life. Travel. Behind-the-scenes at Krave or IM8. Tennis. Anything that is not strictly about ads but reinforces Noa's personal brand.

- 💬 **Comments:** warm, supportive, occasional DMs from people wanting to connect.
- ✅ **You do:** nothing special. Noa handles these directly.

### 3. 🚨 Resource posts (MOST IMPORTANT)

Resource posts give away free Krave playbooks and grow the newsletter list. They follow a specific pattern: the post teaches something valuable, then closes with a CTA like *"Comment HOOKS and I'll DM you the library"* or *"Comment AUTO for the playbook"*.

- 💬 **Comments:** people will literally type the CTA word (HOOKS, COPY, EDIT, etc). Some will also DM Noa directly. Sometimes both.
- ✅ **You do:** when someone types the trigger word in a comment OR DMs asking for the resource, find the correct sign-up link in the Resource → Newsletter Link table below, and DM that link to the person on LinkedIn from Noa's account.

**Why this matters:** every resource request is a hot lead and a future newsletter subscriber. If we are slow to DM the link, or we send the wrong link, we lose the subscriber and make Noa look unreliable. The DM-the-link loop is the single most valuable thing on this SOP.

---

## ⚙️ How posts get generated

### Every morning around 9am Philippine time

Behind the scenes, a system automatically:

**1. Pulls inspiration from 17 creators + 4 newsletters.**
Each Sunday, a separate process scrapes Noa's favorite LinkedIn creators (Olly Hudson, Dara Denney, Native Yanko, Robert Lai, Alex Fedotoff, Grace Beverley, James Mulvey, Ciaran Finn, Bing Hott, Evan Carroll, Tian Yu Xu, Mike Futia, Noah Frydberg, Alex Gough-Cooper, Romain Torres (Arcads), Ferdinand Terme, Andrey Zavyalov) plus newsletters (Soar With Us, LJV Media, Ad World Prime, Nice Ads). Their best-performing recent content gets sorted into 5 content formats as reference material.

**2. Drafts 3 post variations for the day.**
Based on Noa's voice (anchored to 11 of her actual past posts) and the content format scheduled for that weekday, the system drafts Post A, Post B, Post C. Each references her real anecdotes, real client wins, and real language patterns.

**3. Drops the 3 options into Slack.**
The three drafts get posted into `#noa-linkedin-posts` as a thread. Noa reviews on her phone over coffee, picks the one she likes, sometimes edits the wording.

**4. Mirrors all three into ClickUp.**
The three drafts get pushed into the "LinkedIn Post" space in ClickUp as separate tasks. If a post is "framework-style" (numbered list, checklist, multi-step process), an infographic gets auto-generated using the Krave brand template and attached to the task automatically.

**Also at 9AM PHT:** Noa's scheduled LinkedIn post goes live. Noa works every Sunday to pre-schedule posts for the entire week.

### Weekly content rotation

| Day | Primary format | Topic angle |
|-----|---------------|-------------|
| Monday | Format 1: Krave winning videos | Behind-the-scenes from the agency, recent wins, what's converting |
| Tuesday | Format 4: Better ads series | DR craft, hook patterns, what makes ads work |
| Wednesday | Format 2: AI news / AI takes | AI in marketing, tools, Noa's strong opinions |
| Thursday | Format 5: Business + life | Founder reflections, building Krave + IM8, work texture |
| Friday | Format 3: Personal updates | Mom life, family, travel, vulnerable moments |
| Saturday | NO POST | — |
| Sunday | Krave-related story | Reflections, planning the week ahead |

Resource promotion posts (one per Krave resource, three variants each) and the weekly newsletter draft get queued separately into the same ClickUp space.

---

## 🗂 Where posts live in ClickUp

All posts (daily drops + resource promos + newsletters + historical archive) live in one ClickUp space called **"LinkedIn Post"** under the Krave Media workspace. Inside that space there is one list called **"Posts"**.

### What each task looks like

Every task = one post. Task name = date + hook. Description = full post body. Custom fields:

| Field | What it tells you |
|-------|------------------|
| Stage | `idea` → `drafted` → `ready` → `posted` → `killed` |
| Post Type | `linkedin-post`, `newsletter`, `resource-promo`, `reference`, or `doc` |
| Resource | Which Krave resource this post promotes (or `none`) |
| Variant | `A`, `B`, or `C` — daily drops always have 3 versions; Noa picks one |
| Image Attached | Checkbox. If true, scroll to attachments for the auto-generated infographic |
| Date Posted | The day it actually went live on LinkedIn |
| Hook | One-line summary of the post's opening line, useful for skim-scanning |

### Two views to save

- **Today's review:** filter Stage = `idea` OR `drafted`, sort by date created descending. Daily scan view.
- **Posted last 30 days:** filter Stage = `posted`, sort by Date Posted descending. For "did we already post about X this month?" lookups.

> 💡 Group by Stage in the list view → Kanban board with 5 columns. Tasks slide left to right as Noa picks them.

---

## 📆 How Noa uses this

### ☕ Every Sunday

1. Reviews the 7 posts for the upcoming week. Daily drops auto-generate every day, so by Sunday afternoon she has roughly the next 7 days of drafts. She reads through, edits where needed, kills variants she won't use, marks top picks as `ready`, and queues one week's posts into LinkedIn directly with all images.
2. Prepares the weekly newsletter. The draft is auto-queued in the same ClickUp space (filter Post Type = `newsletter`). The `## Noa's Musings` section at the top is 100% hand-written by Noa, never AI. She fills that in Sunday afternoon, polishes the rest, copies into Kit, and schedules it to send Sunday night or Monday morning.

### 📲 9AM

She publishes the post on LinkedIn herself — pastes text from task description, uploads the image, hits Post.

She then comes back into ClickUp, changes the chosen task's Stage to `posted`, sets Date Posted to today. The other two unused variants usually stay as `drafted`, sometimes get manually moved to `killed`.

### 💬 Throughout the day

She replies to comments when she has time. No automated reply tools. If someone comments a trigger word or DMs asking for a resource — **that's where you come in**.

---

## ✅ YOUR TASK — the resource-comment workflow

This is what you do every single day. Read it twice.

### When this gets triggered

- **Trigger 1:** someone comments a resource trigger word on a resource post (`HOOKS`, `AUTO`, `FRAMEWORKS`, `EDIT`, `COPY`, `AUDIT`, `PERSONA`, `VIRAL`).
- **Trigger 2:** someone DMs Noa directly asking for one of the resources ("hey can you send me the hook library", "I'd love the copy bundle", "the audit playbook please", etc).

### Step-by-step

1. **Identify the resource** the person is asking for. Match their trigger word or request to the table below.
2. **Find the row** in the Resource → Newsletter Link table below.
3. **Copy the newsletter sign-up link** (`newsletter.kravemedia.co/r/{slug}`).
4. **DM the person on LinkedIn from Noa's account.** Suggested wording:
   > *"Hey [first name]! Here's the [resource title] you asked for. Just drop your email here and it'll land in your inbox in under a minute: [link]. Excited for you to dig in."*
5. **Done.** Kit handles the rest — landing page, subscriber record, welcome email, resource delivery.

> 🚨 **You do not email the resource yourself. You do not paste the resource doc into the DM. You do not forward anything.** The Kit landing page IS the delivery mechanism. Your job is just to make sure the right link reaches the right person on LinkedIn.

### Edge cases

**Multiple people commented on the same post.**
Same playbook for each one. DM each requester separately.

**Someone asks for a resource we don't have.**
DM them: *"Don't have a doc on that exact topic yet, but I'll pass the request to Noa. We're always adding new ones — keep an eye on the newsletter."*
Then DM Noa internally with the request.

**Someone asks for the resource without naming it ("send me the doc").**
Look at which post they commented on. The post itself names the resource and trigger word.

**The link returns 404.**
Test in an incognito window. If it actually 404s, see the "If something breaks" section. Don't send a broken link.

---

## 🔗 Resource → Newsletter Link table

| Resource title | Trigger word | DM this link |
|---------------|-------------|-------------|
| 100+ Direct Response Hook Library | `HOOKS` | https://newsletter.kravemedia.co/r/hooks |
| The Micropersona Playbook | `PERSONA` | https://newsletter.kravemedia.co/r/persona |
| Automate Your Creative Research & Scriptwriting | `AUTO` | https://newsletter.kravemedia.co/r/automation |
| The Direct Response Ad Account Forensics Playbook | `AUDIT` | https://newsletter.kravemedia.co/r/forensics |
| The Direct Response Copywriting Bundle | `COPY` | https://newsletter.kravemedia.co/r/copy |
| Winning Ad Frameworks | `FRAMEWORKS` | https://newsletter.kravemedia.co/r/frameworks |
| The Direct Response Editing Checklist | `EDIT` | https://newsletter.kravemedia.co/r/editing |
| The Daily Viral Video Drop Playbook | `VIRAL` | https://newsletter.kravemedia.co/r/tiktokdrop |

> 💡 If someone uses a trigger word not in this table, Noa probably launched a new resource without updating the table. Ping her.

---

## 🚶 The full subscriber journey

When you DM someone a newsletter link, here's what happens on their end. **Do the full journey yourself with a throwaway email before your first shift.**

**Step 1 — They get your DM on LinkedIn.**
They tap the link.

**Step 2 — They land on the Krave sign-up page.**
A Krave-branded landing page at `newsletter.kravemedia.co/r/{slug}`. Ad World Prime style hero image, "Free Resource" eyebrow tag, resource title in big bold type, sub-headline about Krave's $100M+ ad spend, sign-up form (first name, last name, email, DTC operator or agency owner).

**Step 3 — They fill the form and hit submit.**
Behind the scenes:
- Cloudflare Worker receives the form
- Creates a subscriber record in Kit
- Applies tags: `lead-newsletter` (everyone), `lead-{slug}` (resource-specific), `resource-claimed` (generic flag)
- Stores `resource_title` and `resource_url` as custom fields on their subscriber profile
- Enrolls them in the "WELCOME EMAIL" sequence in Kit
- All of this in under 2 seconds

**Step 4 — They see a "You're in" confirmation page.**
Redirects to a thanks page: *"Hey [name], check your inbox. I just sent you the link to [resource]. It should land in the next 30 seconds."*

**Step 5 — The welcome email arrives (within 1-2 minutes).**
From `noa@kravemedia.co`. Subject: *"Your Krave resource is inside"* (dynamic — if signed up via bare URL with no resource, subject is *"Welcome to Krave"*). Body: lime green accent bar, lavender card with resource title, green "Open it now →" button, standard Krave intro, Noa's signature.

**Step 6 — They click the button and land on the resource.**
The "Open it now →" button links to the public ClickUp doc. Hook library example: `https://doc.clickup.com/9018123501/p/h/8crb97d-7438/806720a9da0d8ce`. Public doc — no ClickUp login needed.

**Step 7 — They're now a Krave newsletter subscriber.**
Tagged `lead-newsletter` → receives the weekly Krave newsletter Noa sends on Sundays.

### Complete URL chain (Hook Library as example)

| Step | URL |
|------|-----|
| The DM link you send | https://newsletter.kravemedia.co/r/hooks |
| Where the form is hosted (Cloudflare Worker) | same URL above — it's both the landing page and form handler |
| Kit subscriber record | https://app.kit.com → Subscribers tab |
| Welcome email sequence | https://app.kit.com → Automations → Sequences → "WELCOME EMAIL" |
| The resource doc the email links to | https://doc.clickup.com/9018123501/p/h/8crb97d-7438/806720a9da0d8ce |
| The bundle hub (all resources) | https://doc.clickup.com/9018123501/p/h/8crb97d-6138 |

For every other resource, only the first and last URLs change. The subscriber-side experience is identical across resources.

---

## 📧 How Kit (the newsletter system) is set up

You don't manage Kit day-to-day, but know enough to log in and check things when something feels off.

**Log in:** https://app.kit.com — credentials in 1Password under `noa@kravemedia.co`.

### When something breaks in Kit

**Subscriber didn't get the welcome email:**
1. Subscribers tab → search their email
2. Confirm state is `active` (not `bounced` or `unsubscribed`)
3. Tags panel: should have `lead-newsletter` + `lead-{slug}` + `resource-claimed`
4. Custom Fields: `resource_title` and `resource_url` should both be filled
5. Email History tab: did the welcome email send? If yes → it's in their spam/promotions. Tell them to check.
6. If welcome email never sent → check Automations → Sequences → "WELCOME EMAIL" → make sure it's active

**Resource link in welcome email is wrong:**
The worker registry is out of sync. Ping Noa — fix is on the worker side, not in Kit.

**Wrong subject line or body:**
The email uses Liquid templating based on the `resource-claimed` tag. If that tag is missing, they see the generic version. Open Automations → Sequences → "WELCOME EMAIL" → inspect. Don't edit unless Noa explicitly asks.

**New tag you expected doesn't exist:**
Subscribers → Tags → search for it. If missing, ping Noa — a new tag needs to be created AND registered on the worker side.

### What you should never touch in Kit

- Don't modify the welcome sequence's email body without Noa's explicit ask.
- Don't delete tags. Ever.
- Don't merge or split subscribers.
- Don't change the form on the worker side (it's not hosted by Kit — it's hosted by Cloudflare).

---

## 🚨 DO NOT automate DMs on LinkedIn

**This is the single most important rule in this SOP.**

No Phantombuster. No Dripify. No Linked Helper. No Lemlist for connect-then-message. No Sales Navigator automation. Every DM from Noa's profile is sent by a human, typed by a human, sent in real time, one at a time.

**Why:** Noa's LinkedIn account is the single most valuable distribution asset Krave Media has. A ban or "we noticed automated behavior" warning would set us back months and could lose years of relationship equity. The cost of a ban dramatically outweighs the time we'd save. Even tools that claim to be "safe" trip LinkedIn's detection often enough that we don't take the risk.

**In practice:**
- Resource DMs go out manually (this SOP).
- Connection requests are sent by Noa herself.
- Replies to DMs are typed by Noa or by you in real time.
- No bulk sending. No scheduled DMs. No "if X then DM Y" rules. No warming tools.

If anyone suggests a tool to speed this up: the answer is no until Noa explicitly approves it.

**The DM workflow being manual is a feature, not a bug.**

---

## 🛠 If something breaks

**A daily post draft didn't show up in ClickUp:**
1. Open Slack `#noa-linkedin-posts`. Did the morning drop arrive?
2. If YES → Slack is fine but ClickUp sync failed. Ping Noa or the dev (it's a Node script running on a server).
3. If NO → the daily generator failed entirely. Ping Noa.

**A resource link returns 404:**
1. Open `newsletter.kravemedia.co/r/{slug}` in an incognito window.
2. If it 404s → the worker registry doesn't have that slug. Ping Noa. Fix is in the worker code.

**Someone signed up but says they didn't get the welcome email:**
Walk through the Kit subscriber checklist above. 95% of the time it landed in promotions or spam. 5% is a paused welcome sequence or bounced email.

**A comment trigger word doesn't match the table:**
A new resource was probably launched without the table being updated. Ping Noa.

**Kit shows a sync error, duplicate subscriber, or weird state:**
Don't merge, delete, or change anything. Screenshot and DM Noa.

---

## 📌 Quick reference

| Thing | Link |
|-------|------|
| ClickUp LinkedIn Post space | https://app.clickup.com/9018123501/v/li |
| Slack channel for daily drops | `#noa-linkedin-posts` |
| Kit login | https://app.kit.com (credentials in 1Password) |
| Newsletter signup base URL | https://newsletter.kravemedia.co |
| Krave Resource Bundle (public) | https://doc.clickup.com/9018123501/p/h/8crb97d-6138 |
| This SOP (ClickUp source) | https://app.clickup.com/t/86exkj821 |

---

## 📝 Change log

- **2026-05-14b:** Added "The full subscriber journey" section with step-by-step walkthrough + "test it yourself" call-out + complete URL chain table for one resource as reference example.
- **2026-05-14a:** Full rewrite for non-technical handoff. Added resource → newsletter link table, expanded YOUR TASK section, added Kit walkthrough, added DO NOT automate DMs section, added Sunday prep block.
- **2026-05-13:** Initial doc published with technical architecture notes.
