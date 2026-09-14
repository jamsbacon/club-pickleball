# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # install dependencies
npm run dev         # start Vite dev server (http://localhost:5173)
npm run dev -- --host   # same, but exposed on the LAN (for testing on a phone)
npm run build        # production build to dist/
npm run preview       # serve the dist/ build locally
```

There is no test suite, linter, or type checker configured in this project — don't assume `npm test` or `npm run lint` exist.

## Versioning

Every time you make a code change to the app (anything under `src/`), bump the version number before finishing:

1. Update `APP_VERSION` in [src/App.jsx](src/App.jsx) (shown on the login screen).
2. Update `"version"` in [package.json](package.json) to match.
3. Use semver: patch (`1.0.x`) for fixes/tweaks, minor (`1.x.0`) for new features, major (`x.0.0`) for breaking changes to the data model or workflows.
4. Commit and push it immediately (see below) — **before** moving on to the next change, not batched at the end of a multi-step task. Each version bump gets its own commit+push, right away.
5. Tell the user the resulting version number **prominently** in your reply — its own bolded/heading line (e.g. `## v2.47.2`), not just mentioned in passing in a paragraph.

## Commit & push after every change

After bumping the version (above), commit the change and push to `origin/main` right away — don't leave changes staged locally waiting for a separate request, and don't queue up several version bumps to commit together later. This repo deploys from `main` (Vercel auto-deploys on push to `https://club-pickleball.vercel.app/`), so an unpushed change never reaches production — the user has been caught checking production and finding it stale because a push was deferred. Write a commit message describing what changed and why, and include the resulting version number.

This does not apply to changes that don't touch the app itself (e.g. editing this file, README, or git/deploy config).

## Verifying against the live app — always clean up test data afterward

There is one shared Supabase project — no separate staging database — so `npm run dev` (local) and the deployed app at `https://club-pickleball.vercel.app/` both read and write the **exact same live data**, including real tournaments with real people and real money. Verifying a change by actually clicking through the app (per the verification workflow) is expected and encouraged, but **any row your own testing creates or changes must be removed/reverted again before you finish that piece of work** — a test category registration, booking, Open Play sign-up, subscription, or role change left behind is exactly as visible to the club and its members as a real one. This bit the project already once: a leftover test registration under the admin's own account (`moralesjtr@gmail.com`, in a tournament category, with the display name literally set to the raw email instead of a real name) sat live in the "Inscritos"/"Pagos" screens until the admin spotted it and had to ask for it to be found and removed (see git history around v2.59.0/v2.60.0).

Practical rules:
- Prefer a disposable identity for anything that writes data (a throwaway test account, a fake name/email typed into an admin "walk-in" form) over the admin's own real account or a real member's — it's easier to spot and safer to leave a trace of by accident.
- If you must exercise a flow that only makes sense on real data (e.g. confirming a fix against an actual live registration), undo the specific thing you changed immediately after confirming it works — don't leave "I'll clean this up later" for a following turn.
- Before ending a turn that touched live data, actively check for anything left over (query the affected table, re-open the relevant admin screen) rather than assuming your own mutations self-cleaned.
- This is stricter than the general safety rule about confirming destructive actions — reverting your *own* test data does not need to wait for permission the way deleting *the user's* real data does.

## Architecture

This is a single-page club-management app ("Club OS") for a pickleball club: bookings, tournaments, open plays, classes and memberships, built as **one React component tree in one file**, [src/App.jsx](src/App.jsx) (~3700 lines). [src/main.jsx](src/main.jsx) just mounts `<App />`; there is no router — navigation is a `tab` state string switched in the main component.

### Supabase-backed — but IDs for anything nested inside a JSONB column are client-generated

All data (club config, courts, bookings, users, open plays, classes, memberships, tournament/categories) lives in `useState` hooks inside the default-exported `PickleballTournamentApp` component (around [src/App.jsx:789](src/App.jsx:789)), mirrored to Supabase — this is **not** an in-memory-only demo (an earlier version of this note said so; it was stale and actively misleading, see the incident below). Reloading the page re-fetches from Supabase, not a blank slate, and every browser tab/session reads and writes the *same* live rows. When adding a feature, follow the existing pattern — a piece of state plus a handful of mutator functions defined alongside it (e.g. `addOpenPlay`, `cancelBooking`, `subscribeToPlan`) that call `supabase.from(...)` — rather than introducing a store library or a separate API layer.

Most top-level rows get their id from Postgres (`.insert().select().single()`), but anything nested *inside* a JSONB column — `categories.teams`/`.waitlist` entries, `matches`, `groups`, price rules, rate-card lines — gets its id from `uid(prefix)` (top of [src/App.jsx](src/App.jsx)), a client-side generator with no database-level uniqueness constraint behind it. **Critical incident (v2.61.0):** `uid()` used to be `` `${p}_${counter++}` `` with the counter reset to 1 on every page load — unique only *within one browser tab's lifetime*, not across the different people actually generating these ids concurrently from their own devices. Two unrelated players, each the first to create a team in their own session, could both get `"team_1"` **in the same category** — a real, silent collision, not a hypothetical one: it actually happened live in the ACP 500 tournament (`categories.teams`) and caused two failures at once — a partner-invite link (`joinTeamUrl`) resolved to the *wrong* person's team, and deleting one of the colliding registrations via `removePersonFromCategory` (`.filter(t => t.id !== teamId)`) silently deleted *all* of them, not just the intended one, destroying two other players' real registrations as collateral damage. `uid()` now uses `crypto.randomUUID()` (with a timestamp+random fallback) so this can't recur, and `removePersonFromCategory` now refuses to touch a list where the target id isn't unique (aborts with an error instead of guessing) as defense-in-depth for any collision predating the fix. If you ever add another place that filters/finds inside a JSONB array by a `uid()`-generated id, assume old collisions might still exist and don't blindly trust `.find()`/`.filter()` to mean "exactly one."

### The file is organized in banner-commented sections, top to bottom

1. **ID / utility helpers, club-schedule helpers, analytics helpers** — pure functions with no JSX (date/time formatting, `uid()`, `generateDayBlocks`, `blockKey`, transaction aggregation for the stats dashboard).
2. **Bracket building / standings** — the tournament draw/scheduling engine (round-robin group generation, seeding, `buildSchedule`, propagating winners through elimination brackets). This is the most algorithmically dense part of the file.
3. **Design tokens** (`COLORS`) and `APP_VERSION`.
4. **`PickleballTournamentApp`** (the default export) — owns all state and all mutator functions, then renders `AuthScreen` (logged out) or `Sidebar` + `TopBar` + the active tab's component + `MobileNav`.
5. **One function per tab**: `ClubTab`, `EstadisticasTab`, `TorneosSection` (with sub-tabs Torneo/Canchas/Categorías/Calendario/Inscripción/Resultados), `ReservasTab`, `EventosTab`, `MembresiasTab` — each takes the slice of state and mutators it needs as props from the main component. There is no context/global store; everything is prop-drilled from `PickleballTournamentApp`.

### The "occupied block" model ties Reservas, Eventos and Torneos together

The club's day is divided into fixed-length blocks (`club.blockMinutes`) between `club.openTime`/`club.closeTime`, generated by `generateDayBlocks()`. A block is uniquely identified by `blockKey(courtId, date, timeMin)`. Court reservations, Open Play/class `occupiedBlocks`, and scheduled tournament matches all write into this same key space (aggregated into the `occupiedKeys` Set built in the main component), which is how the reservation grid in `ReservasTab` knows a slot is taken and by what. When adding anything that claims court time, it must register through this same `occupiedKeys`/`blockKey` mechanism or it will silently allow double-booking.

### Recurring Open Plays and Classes

A recurring Open Play or Class (e.g. "Jueves de DUPR", weekly) is **not** one entity with a recurrence rule — `addOpenPlay`/`addClass` expand it at creation time into one independent `openPlays`/`classes` entry per occurrence (own `id`, `date`, `occupiedBlocks`, `registrations`), all sharing a `recurringGroupId`. `EventosTab` groups entries back by `recurringGroupId` for display (one poster card per series, showing the next upcoming date) and `removeOpenPlaySeries`/`removeClassSeries` delete every entry sharing that id.

Editing follows the same occurrence/series duality as deleting (v2.15.0): `updateOpenPlay`/`updateClass` patch a single row (including its own `date`), while `updateOpenPlaySeries`/`updateClassSeries` patch the fields shared across a whole series (name, price, level, courts, time, image) on every row sharing a `recurringGroupId` **without ever touching each row's own `date`** — that per-row date is what makes it a series instead of one event repeated on the same day. `OpenPlayForm`/`ClaseForm` are shared between create and edit: pass `initial` to prefill and switch into edit mode (hides the recurrence toggle — a pattern isn't editable after creation), and `hideDate` to hide the date field when editing a whole series. Both forms take a single `onSubmit` callback (renamed from `onCreate`) for both creating and saving edits.

### Time/date display vs. internal storage

Internally, times are always minutes-since-midnight or 24h `"HH:MM"` strings (`timeToMinutes`/`minutesToTime`) — this is what's stored, compared, and sorted. `minutesToAmPm`/`formatTimeAmPm` are **display-only** wrappers used at render sites; never store their output or feed it back into `timeToMinutes`. Similarly, `formatDateHuman` (short, e.g. "jue., 14 ago") and `formatDateFull`/`weekdayLabel` (long, e.g. "Jueves, 14 de agosto") are for rendering — dates are stored as plain ISO `YYYY-MM-DD` strings throughout.

### Roles

Two roles: `admin` and `client` (`currentUser.role`), checked ad hoc per tab/section (`role === "admin"`) to gate creation/removal actions and admin-only tabs (`NAV_ITEMS` filters by `roles`). There's a demo admin login (`admin@club.com` / `admin123`) wired up in `AuthScreen` for exercising the admin views without a backend.

### Currency

Prices are entered/stored in USD; `club.bsPerUsd` (synced from the BCV EUR rate, or set manually) converts to Bs at checkout time in `CheckoutPanel`. `formatMoney` formats USD with the `es-VE` locale.

### Member pricing lives on the item, not as a plan-wide percentage

Courts, Open Plays and Classes each carry **two flat USD prices**: a base price (`pricePerBlock`/`price`) and a member price (`memberPrice`) — set directly on the item, not derived from a discount percentage on the membership plan. `courtPriceInfo(court, timeMin)` resolves a court's `{base, member}` for a given time (checking `court.priceRules` — time-window overrides like peak/off-peak pricing — before falling back to the court's own price). `memberDiscountPct(base, memberPrice)` converts a flat member price back into a rounded percentage so it can still be fed to `CheckoutPanel`'s existing `baseUsd`/`discountPct` props unchanged. Whether the *current* user gets the member price is just `!!currentPlan && currentPlan.monthlyPrice > 0` — computed ad hoc at each call site (`ReservasTab`, `EventDetail`, `ClassDetail`), not stored anywhere.

Membership plans themselves only carry `monthlyPrice`, `privateCourtAccess`, `description`, and a `rateCard` — a free-form list of `{label, price}` line items shown in the `MembresiasTab` comparison table. The rate card is the plan's *advertised* rate sheet (e.g. "Jornada de Liga", "Mes de clases con APG" — categories that don't have dedicated booking flows yet) and is edited independently of the real `memberPrice` fields on actual courts/Open Plays/Classes; the two aren't kept in sync automatically.

### Branding

Club identity (name, colors) lives in the `COLORS` design tokens ([src/App.jsx:723](src/App.jsx:723), navy `court`/`courtDark` + orange `ball`/`ballDark`) and `club.name` (seeded as "Pickle Hub"). Most secondary text/background colors are inline hex literals rather than COLORS references — if rebranding again, grep for hex literals rather than assuming everything routes through `COLORS`.

### Multi-tournament: `tournaments[]` + `activeTournamentId`, but `categories` stays global

The club runs many tournaments (not one). `tournaments` is the full list (main component
state); `activeTournamentId` (also main-component state) picks which one is currently open
for editing/viewing inside the "torneos" tab — `null` renders `TournamentsListTab` (pick one
or, if admin, create one), a set id renders `TorneosSection` scoped to that single
`tournament` (derived: `tournaments.find(t => t.id === activeTournamentId)`). **`categories`
is fetched unfiltered — every category from every tournament, in one flat array** — because
`occupiedKeys` needs to block courts across all tournaments at once, not just the one being
edited. Every category carries `tournamentId` (`mapCategoryRow`); any screen that should only
see one tournament's categories filters by it at the point where props are built for that
screen (`categories.filter(c => c.tournamentId === tournament.id)`, done once where
`TorneosSection`/`EventosTab` are rendered) — never assume the `categories` prop you receive
is already scoped just because it "feels like" it should be for that tab. `runScheduler`
follows the same rule: it must clone/schedule only the active tournament's slice of
`categories`, then merge that slice back into the full array — cloning the whole thing would
mix other tournaments' matches into this one's calendar, and overwriting `categories` with just
the scheduled slice would silently delete every other tournament's categories from state.

### Tournament `status`: draft is invisible to clients everywhere, not just Actividades

`tournaments.status` is `'draft'` (default, on create) or `'published'` — publishing requires
`startDate`+`endDate` both set (checked client-side in `TorneoTab`, the "Publicar torneo"
button stays disabled otherwise). A draft is hidden from clients in **both** places a
tournament can appear: `EventosTab` (Actividades) filters to `status === "published"`
unconditionally (admin included — Actividades is "what's live", not a draft preview), and
`TournamentsListTab` filters to published-only for `role !== "admin"` while showing admin
every tournament with a "Borrador" badge on unpublished ones. Don't add a tournament-surfacing
screen without applying the same filter — a screen that shows drafts to clients is a very easy
way to reintroduce the original bug (an incomplete, unpublished tournament visible to
everyone) that motivated `status` in the first place.

### Torneo admin controls vs. player self-service

Inside `TorneosSection`, `TORNEO_SUB_ITEMS` gates which sub-tabs a role can even see, but **visibility of a sub-tab is not the same as write access within it** — `CalendarioTab` is visible to both roles (players need to see the schedule) but only renders the match-duration inputs and the "Generar/Actualizar calendario" button when `role === "admin"`; check `isAdmin` inside a shared tab before assuming a `roles` entry on `TORNEO_SUB_ITEMS` is sufficient gating. `InscripcionTab` branches early into two entirely different components based on role: `InscripcionAdminForm` (unchanged free-text roster entry, no payment) for admins, vs. the player self-service flow (this file) for everyone else — don't try to unify them further, they serve different jobs (organizer registering a walk-in vs. a player registering themselves with a real checkout).

### Player self-registration: identity, partner search, and checkout

A player never types their own name when registering for a tournament category — it comes from `currentUser`. For doubles, `PartnerPicker` either searches the `users` directory by name/email ("Instagram-style") and resolves to `{userId, name, ranking}`, or invites someone not yet registered via `{name, email, ranking}`. `InscripcionTab` only lists categories still open to the current user: `c.matches.length === 0` (no draw generated yet) and the user isn't already in `c.teams`/`c.waitlist`. Registration price is **per player, never doubled for doubles** — a team's partner pays their own registration when *they* register, not the person creating the team. `addTeam(catId, players, checkout)`'s third argument is optional and spread onto the stored team record; the organizer's manual roster editor omits it.

Since v2.64.0, `InscripcionTab` also shows a **standing** "invite my partner" section (`myPendingTeams`) above the category list, for any doubles category where the current registrant is already the titular (`players[0]`) of an incomplete team — same WhatsApp share button and `joinTeamUrl` as the old one-time success screen, just reachable any time instead of only right after checkout. This exists because the original link is tied to one specific `teamId`: if that row's id ever changes (a re-registration after a data-recovery incident, for instance — see the v2.61.0 ID-collision postmortem below) the old link 404s with "este link ya no está disponible", and until this section existed there was no way to get a working link again short of asking a developer to query the database for the current id.

A `"mixto"` category is open to any gender when *starting* a team (that's why `InscripcionTab`'s eligibility filter and `JoinTeamModal`'s `extraEligible` both skip the gender check for `c.gender === "mixto"`) — but the finished pair must be 1 man + 1 woman, and nothing enforced that on the *second* player joining via the self-service invite link until v2.61.0. `players` inside a stored team never carries `gender` (only `profiles`/`directory` do), so `joinTeam` resolves both the creator's and the joiner's gender by looking up their `userId` in `users` and refuses the join if they match — silently allowing it, same as the rest of the app's "unknown gender isn't filtered" convention, whenever either side's gender can't be resolved (a guest invited without an account, an incomplete profile). `JoinTeamModal` repeats the same check client-side (`genderMismatch`) purely so the UI can block before checkout instead of after; `joinTeam` itself is the real, authoritative check. The organizer's manual roster entry (`TeamRegistration`, walk-ins typed in by an admin) has no gender field at all and is **not** covered by this check — lower risk (a human is looking at both names when typing them in), but still a gap if it's ever revisited.

Since v2.17.0 the price itself is tiered by how many categories the player registers for **in the same cart checkout**: `tournamentRegPrice(tournament, catCount)` returns the total bundle price for `catCount` categories at once (`tournament.presalePrice1/2/3` / `regularPrice1/2/3`, tier 3 covers 3-or-more, presale wins inside its date window same as before) — it is a bundle total, not a per-category rate to multiply. `InscripcionTab` splits that total evenly across the teams it creates in one checkout (`pricePerTeam = total / selectedCats.length`) so each team's stored `priceUsd` sums back to the real amount charged — storing the full bundle total on every team would inflate `buildClientActivity()`'s revenue sum by the category count.

That per-category split is correct for storage/revenue math, but showing it raw in an admin payment-review screen reads as two unrelated partial payments instead of one $35 checkout. `PagosTab`'s `buildPaymentRows` (v2.59.0) re-groups tournament rows back to one row per (tournament, person) — summing `priceUsd` across their categories, joining category names, and applying a status change to every still-unverified target in the group at once (same "verify everything pending" idea as `InscritosTab`'s `verifyAll`) — specifically so the UI never contradicts what `InscritosTab` already shows as that person's real total. `EstadisticasTab`/`buildClientActivity` still sum the underlying per-category `priceUsd` values directly (unaffected, and correctly un-inflated) — only `PagosTab`'s display grouping changed.

Since v2.56.0 there **is** cross-session accumulation: `countRegisteredCategories(categories, tournamentId, identity, excludeCatId?)` counts how many categories of this tournament the player is already in (`teams` or `waitlist` — the waitlist paid too) from any *earlier, separate* checkout, and `tournamentRegPriceFrom(tournament, alreadyCount, newCount)` charges this new cart as if it were continuing the same tier ladder (`tournamentRegPrice(already+new) - tournamentRegPrice(already)`) instead of restarting at tier 1 — a player who paid for 1 category last week and comes back today for one more pays the "categoría adicional" price, not tier-1 again. Both `InscripcionTab` and `JoinTeamModal` (the "join via partner-invite link, plus extra categories" cart) use this pair instead of calling `tournamentRegPrice` directly for their real charge.

### `category.maxTeams` is a row cap on the DB column, but the real-world cap is in players

`categories.max_teams` (`cat.maxTeams`) is stored as one number and its UI label used to just say "equipos" regardless of modality — misleading, because a `teams` row is **not** always 2 people: since v2.51.0 a doubles registration always starts "esperando pareja" (one player, waiting for a partner to join later via `joinTeam`), so a raw `cat.teams.length >= cat.maxTeams` check filled up the cap with half as many people as intended (16 solo sign-ups exhausted a 16-slot doubles category that was meant to hold 32 people, 16 *pairs*). Since v2.57.0, `categoryMaxPlayers(cat)` is the real capacity in **players** (`maxTeams` as-is for `modality === "individual"`, `maxTeams * 2` for doubles), `countCategoryPlayers(teams)` sums actual players across whatever rows are passed in, and `categoryIsFull(cat)` (used by `addTeam`'s waitlist decision, `TeamRegistration`, and both capacity checks in `InscripcionTab`) compares real player count against that capacity instead of row count. `categoryCountLabel(cat)` renders the right unit for display ("X/Y jugadores" for individual, "X duplas (Y/Z jugadores)" for doubles) and `NewCategoryForm`'s field label/helper text switches between "Cupo máximo de jugadores" and "Cupo máximo de duplas" by modality, spelling out the ×2 explicitly for doubles. If you add another place that reads `cat.maxTeams`/`cat.teams.length` directly to decide capacity, route it through these helpers instead — a fresh row-count check reintroduces the exact bug this fixed.

Since v2.62.0 both `maxTeams` and a new `minTeams` (`categories.min_teams`, same unit as `maxTeams` — duplas in dobles, jugadores in individual) are editable **after** a category already has registrations, from a pencil icon next to the category name in `CategoriasTab` (`CategoryCapacityFields`, shared with `NewCategoryForm` so creating and editing use identical inputs/copy). This goes through the ordinary `updateCategory` mutator, same as everything else that patches a category — no separate endpoint. `minTeams` is purely informational today (shown as "Necesita al menos N duplas para jugarse"); nothing reads it to block registration, warn, or auto-cancel a category that falls short — if that behavior gets requested later, `FormatAdvisor` (which already reasons about registered-team counts) is the natural place to wire it in.

### Deleting a user account (UsuariosTab) — server-side, and only two files ever run on a server

`deleteUserAccount(targetUserId)` in `App.jsx` and [api/delete-user.js](api/delete-user.js) together delete a member's account for good: their tournament entries, bookings, Open Play/class registrations, membership subscriptions, push subscriptions, `profiles` row, **and** their Supabase Auth login (via the Admin API — they truly cannot sign back in with that email). This is the club's explicit choice (confirmed after asking): any record with a payment already `"confirmada"` is **preserved** instead of deleted — deleting money that really came in would silently change past months' totals in `EstadisticasTab`. `buildUserDeletionSummary()` computes the delete-vs-preserve counts shown in the confirmation popup; `findUnverifiedCategoryEntries()` finds just the unverified tournament rows to remove.

The work is split across exactly two places, and the split is load-bearing, not arbitrary:
- **Tournament categories, client-side**, in `deleteUserAccount` itself: it loops `findUnverifiedCategoryEntries()`'s results through the *existing* `removePersonFromCategory` (same one `InscritosTab` uses) so the price-rebalancing and waitlist-promotion logic that already lives there runs unchanged — reimplementing that on a server would risk two copies drifting apart.
- **Everything else, server-side**, in `api/delete-user.js`, using the Supabase `service_role` key (same security pattern as [api/send-push.js](api/send-push.js) — read that file's header comment first if this is new to you: validate the caller's access token, confirm `profiles.role === 'admin'`, never trust anything else the client claims). This is not a style choice: `bookings`, `subscriptions` and `profiles` have **no RLS `DELETE` policy at all**, so a client-side `.delete()` on them silently matches zero rows no matter who's logged in — only `service_role` (server-only, never shipped to the browser) can touch them. `open_play_registrations`/`class_registrations` *do* have an admin `DELETE` policy already (that's what `removeOpenPlayRegistration`/`removeClassRegistration` use), but their cleanup happens here too anyway, to keep "everything except categories" as one network round-trip.

One FK detail that matters if you touch this: `subscriptions.user_id → profiles.id` is `ON DELETE CASCADE`, unlike `bookings`/`open_play_registrations`/`class_registrations`, which are `ON DELETE SET NULL`. That means a *verified* subscription — the one thing this feature is supposed to protect — would otherwise vanish the instant the `profiles` row is deleted. `api/delete-user.js` works around it by nulling `user_id` on any remaining (= verified) subscriptions immediately before deleting the profile. Deletion order in that file is deliberate: cheap/reversible cleanup first, the `profiles` row next, and `auth.admin.deleteUser()` dead last — if anything earlier fails, the person can still log in and the admin can retry, instead of ending up with a revoked login and half-cleaned data.

The delete button in `UsuariosTab` is hidden for the admin's own row and for any other `role === "admin"` row (demote them to `cliente` first) — `api/delete-user.js` enforces the exact same two checks server-side, since the UI hiding a button is not a security boundary.

### `InscritosTab`: "paid" and "verified" are different amounts on purpose

`buildTournamentParticipants()` tracks two separate running totals per person, and they must stay separate: `verifiedUsd` is only what has `paymentStatus === "confirmada"` (used for the "Monto verificado" stat card — genuinely reviewed money), while `paidUsd`/`paidBs` (v2.63.0) is everything **except** `"pendiente_efectivo"` — i.e. it includes `"pendiente_verificacion"` (a Pago Móvil transfer the player already sent, just not yet checked against the bank) — shown per row as "Monto pagado" so that screen stops claiming a mobile payment is "$0 paid" while it waits for review. `priceBs` on a team/player is already a **historical, fixed** value (computed once at checkout time as `pricePerTeam * bsRate`-then, never recalculated) — summing it for `paidBs` is what makes the Bs amount shown next to "Monto pagado" immune to today's exchange rate moving, which is the whole point: the money already sitting in the club's bank account in bolívares doesn't change because BCV's rate did. Don't casually swap `verifiedUsd` for `paidUsd` (or vice versa) in either the stat cards or the per-row column — they answer different questions ("what's actually confirmed" vs "what has the player already sent").

Both the "Verificar" action and the per-person delete already require a confirmation modal (`ConfirmDeleteModal`, reused for both — its name predates the verify use) before applying; if you add another payment-status or destructive action to this tab, follow the same pattern rather than firing on a bare click.

### Client activity attribution (loyalty leaderboard)

Every self-service checkout (`ReservasTab`, `EventDetail`, `ClassDetail`, `InscripcionTab`) stamps `userId: currentUser.id` onto the record it creates (booking / registration / team) — this is what lets `buildClientActivity()` in [src/App.jsx](src/App.jsx) attribute money and attendance back to a specific client for `EstadisticasTab`'s "Clientes más leales" card. Resolution falls back to a name match (`byName`) for older or admin-entered records that predate `userId`, and silently drops anything matching no known user — if you add a new paid, attendee-facing flow, stamp `userId` on it too or it won't show up in the leaderboard. Membership subscriptions are excluded on purpose (a subscription isn't "attendance").
