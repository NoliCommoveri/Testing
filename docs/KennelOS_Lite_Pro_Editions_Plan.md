# KennelOS — Lite / Pro Editions

*Design plan. Nothing here is built yet — this is the map to build from in the new repo.*
*Plain-English throughout; the precise rules are called out where they matter.*

---

## The decision in one line

Ship **two editions of the app** — **Lite** (free) and **Pro** (paid) — where the Pro
features are *physically absent* from the Lite download, Lite carries a **soft cap** on
owned dogs and litters that is self-enforcing in practice, and converting Lite → Pro is a
one-time **export-your-data / import-it** step the app already knows how to do.

---

## Why two editions (this is what kills the hacks)

A single app with locked features can always be pried open, because the Pro code is sitting
right there in what everyone downloads — the lock only *hides* it. Two editions flip that:

> If the stud-services code, the contracts code, the receipts code simply **aren't in the
> Lite download**, there is nothing to unlock. You can't hack your way to a feature that
> isn't in the files.

This is the "Lite edition vs Pro edition" model real software used for decades. It's the
strongest paywall static hosting (GitHub Pages) can give you, because the lock is *"it isn't
here,"* not *"it's here but hidden."*

---

## Why a cap actually holds up here

A number-limit still runs in the browser, so on paper it's "soft." But in **this** app it
behaves like a hard limit, for reasons specific to what the data is:

1. **You can't delete a linked dog.** The app blocks permanently deleting any dog that's
   referenced by a litter, pairing, sale, or event (referential integrity). So a breeder
   can't free a slot by deleting a real dog.
2. **Freeing a slot means destroying the pedigree.** The only workaround — unlinking a dog
   from its litters/pairings first — guts exactly the history a breeder values most. Nobody
   trades their pedigree for one extra slot. **The incentive fights the hack.**
3. **Archived dogs still count.** Archiving only hides a record; the row stays. If the cap
   counts archived dogs too, archiving-to-make-room does nothing.
4. **Faking a status corrupts their own records.** Marking a living dog "deceased" or
   "external" to duck the count messes up the very records they're keeping — same
   self-defeating logic as the pedigree point.

The only escape left is **Reset App**, which wipes their entire program — no one nukes their
whole kennel to add a 7th dog. So the cap is technically soft but, in the hands of the person
who actually cares about this data, sturdy. That's as good as it gets without a server, and
it's good enough.

---

## The two tiers

| Area | Lite (free) | Pro (paid) |
|---|---|---|
| Owned / co-owned dogs | Up to the cap | Unlimited |
| Litters | Up to the cap | Unlimited |
| Pairings | Unlimited | Unlimited |
| Events / history log | Unlimited | Unlimited |
| Sales → income | ✅ log sales on their pups | ✅ |
| Buyers on a sale | ✅ self + inline "add buyer" | ✅ full Contacts section |
| Contacts section (browse/manage all) | ❌ | ✅ |
| External dogs | ❌ | ✅ |
| Stud services | ❌ | ✅ |
| Contract types (beyond a logged sale) | ❌ | ✅ |
| Kennel management (logos, custom tests) | Startup selections only | ✅ full |
| Companion app (buyer/partner share-out) | ❌ | ✅ |
| Assistant app | ❌ | ✅ |
| Receipts & file storage | ❌ | ✅ |

The through-line: **Lite = keep good basic records; Pro = run it as a business.** The paid
value is *features*, not "more of the same."

---

## The cap, defined precisely

"6 adult owned dogs" isn't one field in the app — it's a filtered count. Recommended
definition (adjust the specifics in the open-decisions list):

**Counts toward the cap:** a dog whose **ownership is owned or co-owned** *and* whose **life
stage is an adult stage** — active breeding, retired breeding, pet home, or for sale.
**Include archived** ones in this count.

**Does NOT count:** puppies (so a whole litter never blows the cap), external dogs (they're
Pro anyway and not in Lite), and deceased dogs (historical, and faking it corrupts records).

### The one wrinkle: a kept puppy growing up

Your 2 free litters make puppies. Puppies don't count *as puppies* — good. But when a breeder
**keeps** one and it matures, the app changes its life stage on the same record, and it would
now count. Recommended rule:

> **Grandfather home-grown dogs:** let a maturing puppy push you over the cap, but block
> adding *brand-new* adult dogs beyond it.

You never tell someone "you can't record your own puppy growing up," but you still stop them
stacking outside dogs — and it's still a gentle nudge toward Pro.

---

## Converting Lite → Pro (the bridge)

Upgrading means moving a breeder's data from the Lite app into the Pro app. Good news: **the
app already has JSON export and import**, so the bridge is mostly built.

Flow: in Lite, "Upgrade & bring my data" → export a backup file → open Pro → import it →
everything's there, now with the caps lifted and Pro sections unlocked. You offer to help
with this one-time move.

*(Whether the two editions even keep separate local data is an open decision below — if they
share it, no import is needed at all; if they're walled apart, this export/import is the
bridge.)*

---

## The Demo edition (seeded, read-only showcase)

A third thing to hand people — or walk them through yourself — so they can *see* the full app
without installing anything or typing in a single real dog.

**What it is:** the **Pro feature set**, pre-loaded with realistic **sample data**, and
**read-only** — a visitor can click through every page, open dogs, litters, pairings, sales,
Companion, receipts, the works, but **can't change anything.** Your app already ships a
sample-data seed, so the "seeded" half is basically done.

**Why read-only is a clean switch, not a big build:** every change in the app funnels through
one place (the repo layer's create / update / archive / delete). Flip a single "demo mode"
switch and those become friendly no-ops — *"This is a demo — changes aren't saved."* One
chokepoint, so "cannot be edited" is genuinely one lever, not a hundred disabled buttons. On
each visit it re-seeds to the same pristine state, so every viewer sees the same tidy kennel.

**The honest catch to know going in:** the demo is the *one public place the full Pro feature
code lives* (it has to, to show it off). A technical person could, in principle, flip the
read-only switch off in their browser and poke at a working copy. For your audience — dog
breeders looking at a showcase — that's not a real distribution risk, and it's the same
"keeps honest people honest" caveat as everything else here. But it's worth naming: the demo
is a shop window, not a vault. If that ever matters, the demo can leave out the "save/export
my work" paths so an unlocked copy is a dead end.

**Bonus:** this doubles as your sales tool. It's the "try before you buy" that pairs with
whatever pricing you land on — a link you can drop anywhere that sells the app for you.

---

## How it's laid out (plain English, for the new repo)

Not two copies of the app — that way lies drift. Instead, **one shared core that both
editions import from**, and two thin editions on top. No build step, nothing duplicated.

```
/shared/     the database, the repos, the vocab, and the pages both editions
             have in common — dogs, litters, pairings, events, sales — plus utilities

/lite/       Lite's own home page + navigation, the cap logic, and its own
             service-worker precache list. Ships ONLY the shared pages.

/pro/        Pro's own home page + navigation, plus the extra pages Lite doesn't
             have — Contacts, stud services, contracts, Companion, Assistant,
             receipts/files — and its own service-worker precache list.

/demo/       the Pro edition again, but launched with "demo mode" on: auto-seeds
             sample data, blocks all edits, re-seeds clean each visit. Mostly the
             same files as /pro/ with one flag flipped — not a fourth codebase.
```

The nice part: in Lite, most "gating" isn't a runtime check at all — the Pro pages simply
**aren't in Lite's navigation or its offline file list**, so they were never downloaded. The
cap is the only thing Lite actively enforces.

---

## Guardrails carried over from the current app

- **Soft-delete only**; deletes never cascade and never destroy history.
- **Referential integrity via the registry** — every foreign key stays registered (this is
  *why* the cap holds).
- **Count includes archived** wherever the cap counts dogs or litters.
- **IDs are random UUIDs** — no hidden sequence to exploit, and none to lean on either.
- **Service-worker cache discipline, now ×2** — each edition has its own precache list and
  its own cache-name bump. This is the most-forgotten step; there are now two of it.
- **Keep the End-State guide true** — update it in the same change as any structural edit.

---

## Open decisions to lock before building

1. **Cap numbers** — 6 owned dogs? 2 litters? And does **co-owned** count toward the dog cap,
   or only fully owned?
2. **Deceased dogs** — count toward the cap or not? *(Recommend: not.)*
3. **Puppy-grows-up rule** — grandfather home-grown dogs over the cap? *(Recommended above.)*
4. **Inline "add buyer" in the sale flow** — confirm Lite can create/pick a buyer from inside
   a sale, since the full Contacts section is Pro-only.
5. **Shared local data or walled apart** — do Lite and Pro share one local database (no import
   needed) or stay separate (clean wall + the export/import bridge)? *(Recommend: separate,
   for a clean edition boundary.)*
6. **Pricing model on top** — one-time vs yearly key, and which selling platform. Separate
   question; doesn't block the build.
7. **Demo behavior** — strictly read-only (buttons show "not saved"), or a *resetting
   sandbox* where visitors can actually click-edit and it wipes on reload? You asked for
   read-only; the sandbox is a common alternative that lets people *feel* it. *(Recommend:
   read-only, matching your ask.)*
8. **Demo hardening** — leave the "save/export my work" paths in the demo, or strip them so an
   unlocked copy is a dead end? *(Only matters if the shop-window caveat above concerns you.)*

---

## The one honest caveat

Reset App still wipes a Lite cap — that's the only escape hatch left, and it's self-defeating
because it destroys the breeder's whole program. Nothing running purely in a browser can beat
that, and for this audience nothing needs to.
