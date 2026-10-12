# Practice a shift: build list

The game follows the path a real owner takes: one chair, then a team, a full-service salon, a landlord, a brand, a school and a second location. Each chapter uses the ClarityFlow systems a business at that size needs, so what someone learns in the game is what they do in the app.

Code: `src/app/practice` (page, checkout), `src/lib/practice` (scene, rules). Tests: `scripts/verify/practice-sim.verify.ts`.

Status: **Live** · **Next** · **Then** · **Later**

## Chapters

| # | Chapter | Size | Systems used | Shifts | Move up when | Status |
|---|---------|------|--------------|--------|--------------|--------|
| 1 | Solo provider | One chair, you do everything | Booking page, Services, Clients, Front desk checkout, Before the visit, Messages, Reviews, Money | First booked day (Next) · A no-show and a late text (Next) · Deposits and your cancellation policy (Then) | 20 clients rebooked and a 4.8 rating | Next |
| 2 | Fully booked | Still solo; demand is bigger than your hours | Waitlist, Phone assistant, Gift cards, Clubs, Retail, Online shop | Fill a cancellation in 10 minutes · Holiday gift card rush | 3 weeks fully booked, or a waitlist of 15 | Then |
| 3 | First hire | Two chairs; you become a boss | Applicants, Team, Shift schedule, Time clock, Timesheets, Payroll, Staff portal, Agreements | Interview day (conversation) · Payday and a pay question | Your hire is booked 70% for a month | Then |
| 4 | Studio with a team | 4–6 chairs; you run the floor | Front desk, Floor staff, Check-in kiosk, Lobby board, Lounge concierge, Team performance, Incentives | Saturday opening (Live) · Checkout, retail, receipts (Live) · Drinks bar and breaks (Live) | Three 3-star shifts in a row | Live |
| 5 | Full-service salon | Hair, nails, spa, barber, lash | Formulas, Consents, Spaces, Maintenance, Making it right, Refunds, Disputes | Saturday rush (Live) · A color correction goes wrong (Then) · An upset client (Then) | A month with no unresolved complaints | Live |
| 6 | Booth rental landlord | Renters run their own business in your space | Renters, Rent, Booths, Agreements, Documents | Rent day · Two renters, one parking spot | All booths leased, rent collected on time | Later |
| 7 | Your product line | A brand people buy online | Shop designer, Online shop, Fulfilment, Pack bench, Wave picking, Returns, Wholesale, Distribution | Launch day: 200 orders · A wholesale order for 12 salons | $10k in online sales | Later |
| 8 | Academy and events | Teach what you know | Academy, Classes, Events, Resources | Teach your first class · A launch party | 50 students certified | Later |
| 9 | The empire | A second location and beyond | Planner, Money, Analytics, Opportunities, Pipeline, Outreach, Quotes | Two salons, one Saturday · Plan location #3 | New challenges every season | Later |

## Across every chapter

| Feature | What it is | Status |
|---------|-----------|--------|
| Your own salon | Play with your real services, prices, policies and room layout from your account | Next |
| Accessibility | Captions for sounds, reduced motion, color-blind-safe icons, one-hand mode on phone | Next |
| Staff as people | Strengths, goals and a mood that carries over between shifts | Then |
| Conversations | Talk a client down, decline politely, ask for a review; see how your words land | Then |
| Daily challenge | One short shift a day with a twist; same seed for everyone | Then |
| Replay your day | Load yesterday's real bookings and play them back with different calls | Then |
| Try this setting | Play a shift with a policy change (deposit, grace minutes, buffer) before turning it on | Later |
| Training that counts | Finishing a chapter counts as Academy credit and checks off the matching setup step | Later |
| Seasonal events | Prom season, holiday gift cards, wedding Saturdays, back to school | Later |
| More businesses | Spa, barbershop, med spa, café, studio | Later |
| Team leaderboards | Private to your salon; best rebooker of the week | Later |

## Build order

**Done (Chapters 4 and 5)**
- Opening and rush shifts
- Quiet floor: Needs you tray, goals, levels, badges, coach
- Checkout: client profile and notes, recommend and scan retail, items brought to the desk, rebook, tip on the reader, tap / chip / swipe, cash with correct change, print / text / email receipt
- Drinks bar (staff walk over, make it, bring it), staff energy and breaks, client personalities, regulars who come back
- Sidebar link: Team → Practice a shift

**Round 1 (Chapter 1: Solo provider)**
- Play as the provider: the service itself is a short hands-on task
- Texts arrive while you work; answer between clients
- No-show, late text, deposits
- Your own services and prices
- Accessibility pass

**Rounds 2–3 (Chapters 2 and 3)**
- Waitlist fill, gift cards, clubs
- Interview and payday conversations
- Staff as people, daily challenge, replay your day

**Rounds 4+ (Chapters 6 to 9)**
- Rent day and renter disputes
- Product launch and fulfilment
- Teach a class, run an event
- Two locations
- Seasonal events, more businesses

Each round ends playable, tested and pushed.
