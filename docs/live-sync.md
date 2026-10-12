# Ledger synchronization

## Data preservation

This release keeps document version 10 and the existing pricing/split functions.
The additive migration does not update ledger documents or revisions. Before
deployment, the full ledger and revision are backed up in
`private.ledger_realtime_backup` (RLS enabled, no client privileges or policies).
Never publish these backups to GitHub or expose them through the API.

## Transport

The app loads through authenticated `GET /api/ledger`. Debounced changes save
through the existing validated, rate-limited revision-checked `PUT /api/ledger`.
New clients bind writes to the user and organization returned by GET.

A database trigger broadcasts a revision notification on the private
`ledger:<organizationId>` channel. The payload contains the revision and the
message ID added by Supabase, not the ledger. RLS permits only organization
members to receive it. Browser clients cannot broadcast to these channels.

Notifications trigger a coalesced authenticated GET. A successful channel join,
reconnect, foreground/focus, and online event also revalidate. When live delivery
is unavailable, a visible, online tab checks every 60 seconds. Background tabs
do not poll. WebSocket heartbeats are separate from ledger polling.

## Concurrent edits and recovery

One sync controller serializes reads and writes. It re-reads canonical database
snapshots after saves. HTTP 409 fetches the latest revision; it never reloads the
page. Different records merge by ID. Records are atomic (service, quantity and
pricing cannot accidentally be mixed). Rates and settings are each atomic.
Concurrent deletions and duplicate trip numbers require whole-record-group
review to avoid orphaning clients. Same-record edits require explicit choice.
The next write still uses revision checking, so another intervening change is
reviewed again rather than overwritten blindly.

Open forms hold remote updates until submission/cancellation. Their original
ledger base and exact input values survive a same-tab reload using sessionStorage.
Draft keys are scoped to user and organization. This is session recovery, not a
full offline app: closing the tab/browser may remove the draft. Storage failures
show a warning, and drafts can be downloaded. Conflict resolution preserves a
recovery copy for the current tab; successful signout clears its recovery data.
Never put auth credentials in draft storage. Signout is blocked while edits are
pending or a form is open. Expired auth preserves drafts before redirecting.

Transient failures retry with exponential delay; 429 honors Retry-After even if
another local edit arrives. Validation/permission failures do not loop. A changed
account/organization stops the controller. Unsaved changes are not labeled saved.

## Verification

```sh
pnpm lint
pnpm build
node --experimental-strip-types --test tests/ledger-sync.test.mjs tests/ledger-sync-hook.test.mjs tests/rate-snapshots.test.mjs tests/service-split.test.mjs
```

Run `tests/ledger-realtime.sql` only inside `BEGIN; ... ROLLBACK;`. It tests member
access, cross-organization denial, unrelated-user denial, forged-notification
denial, and the trigger's revision-only payload. Its temporary ledger revision
and messages are rolled back. Realtime initializes its message partitions after
the first WebSocket connection; do not manually alter the managed schema.

Manual mobile smoke test: open the same organization on two devices, add/edit a
record on one, verify the other report refreshes; open the same client form on
both, submit different values, verify conflict review retains the drafts; repeat
after airplane mode and after backgrounding Safari. Do not use real records for
destructive tests. Browser rendering QA was unavailable in the build environment;
the React integration test uses an in-memory API and Realtime transport.

Security advisor notes: private backup tables intentionally have deny-all RLS;
the existing save RPC remains intentionally authenticated SECURITY DEFINER with
auth, membership and role checks. The pre-existing disabled leaked-password
protection setting was not changed in this release. See
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
