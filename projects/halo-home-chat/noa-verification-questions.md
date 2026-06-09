# Halo Bot — Questions for Noa / Shin (verify before code changes)

Source: Alleah's feedback (June 2026). These four items contradict what the bots currently say, or depend on info that may be stale. We will not change the bots until these are confirmed, because guessing risks telling customers the wrong thing again.

## 1. Philippines shipping
- The website bot currently tells customers **we do NOT ship to the Philippines**.
- Alleah believes we **do** ship to the Philippines.
- **Confirm:** Do we ship to the Philippines today? Yes / No. If yes, any conditions (min order, courier, fees)?

## 2. Europe / Italy shipping
- The website bot currently tells customers **we ship to "all EU countries."**
- Alleah's last check (Feb 2026) said we **cannot ship to Italy or anywhere in Europe**.
- **Confirm:** What is the current EU/Europe shipping status? Give the exact approved country list so we hardcode the correct one.

## 3. Referral program
- The website bot currently tells customers **no referral program exists**.
- Alleah has a ReferralCandy link: `halohome.referralcandy.com/join/haloauto` (friend gets $20 off orders $90+, referrer gets $10 store credit).
- **Confirm:** Is the referral program live right now? If yes, are the terms above still accurate?

## 4. Current promotions
- The bot has no knowledge of the **Buy 2 Get 1 Brushed Chrome Showerhead** promo.
- **Confirm:** Which promos are live right now and their end dates? (Buy 2 Get 1 Brushed Chrome, the "15% off voucher," any holiday promo.) Ideally we pull these from a Shopify discount/page so they expire on their own instead of going stale in the bot.

---

**Why this matters:** Items 1, 2, and 4 expire or change. If we hardcode them and they shift, the bot gives wrong answers again — which is the exact problem in this feedback round. Confirm once, then we wire them so they stay current.
