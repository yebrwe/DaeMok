# Maze Authority + Toon Rework Completion Contract

Status: in progress

This document defines “100% complete” for the DaeMok maze rework. A phase is not
complete because its code exists; every listed gate must have direct test or
runtime evidence.

## Non-negotiable invariants

- Game rules are V5: the board remains 6×6 and the base wall/item budget is 15.
  Equipping no runner gear grants a 10-point bonus for a total budget of 25.
- A runner equips at most one persistent match-long gear: `wormholeEscapeKit`
  skips the internal dice puzzle when a safe wormhole exit is available, while
  `insight` privately identifies a fake wall when that runner collides with it.
  Gear is not consumed and its selection remains secret from opponents and
  spectators during setup and play.
- Outside the explicit V5 gear and budget changes, existing movement,
  collision, supported item/special-wall, finish, draw and 2–4-player relay
  assignment results remain byte-equivalent for the same input.
- `collapseWall` and `mirrorWall` are retired for every newly submitted map.
  They are absent from setup/practice catalogs and rejected by both legacy
  validation and Authority submission. Their old reducer, projection decoder
  and renderer branches remain decode-only compatibility code until active
  legacy rooms have drained; they must never be restored into an editable
  draft or offered by a new-map UI.
- Voluntary forfeit is retired. Authority exposes no forfeit command, builder
  or player-facing control; historical forfeit fields/results may be decoded
  only so an old projection can be displayed safely.
- `leaveRoom` is rejected for every participant while the canonical phase is
  `play`, including a runner who has already finished. Leaving is a lifecycle
  operation for `setup` or `end`, not a way to alter a live result.
- The client submits intent only. It cannot choose position, moves, collisions,
  item consumption, turn order, winner or ranking results.
- Secret maps never appear in a response readable by another participant or a
  spectator. UI hiding is not accepted as secrecy evidence.
- Presence and disconnect leases are stored separately from canonical match
  state. A stale heartbeat must never invalidate a valid gameplay command.
- Practice mode uses the same canonical engine locally and remains available
  without a callable round trip.
- Legacy matches are allowed to drain; no live match is converted in place.

## Authority contract

- Private source: `mazeAuthority/v1/rooms/{roomId}` (Admin SDK only).
- Authenticated public projection: `mazeViews/v1/publicRooms/{roomId}`.
- Participant projection: `mazeViews/v1/memberRooms/{uid}/{roomId}` (own UID
  only).
- Presence: `mazePresence/v1/rooms/{roomId}/{uid}/{connectionId}`.
- Ranking: `mazeAuthorityRankings/v1/{uid}` (server-written, authenticated read).
- Every command has an exact tagged payload, `commandId`, generation fence and
  expected revision. Receipts are actor- and payload-bound, replayable and
  bounded.
- Every accepted mutation increments the canonical revision exactly once and
  publishes projections derived from the committed snapshot.

## Match lifecycle contract

- The 45-second (`45_000ms`) clock is only the reconnect grace for the offline
  player who currently owns the turn. It is not a map creation, map reset,
  draft editing or setup deadline.
- Before the grace expires, reconnecting preserves the current turn. After it
  expires, a server-owned offline-turn claim may advance `currentTurn` to the
  next eligible unfinished runner.
- An offline-turn skip must not mutate any player record, including
  `forfeited`, `finished`, `position`, `moves` or `finishMoves`, and must not
  synthesize a winner, draw or terminal result. Only turn bookkeeping,
  Authority revision/receipt metadata and its explanatory message may advance.
- If the disconnected current player is the last unfinished runner, there is
  nobody eligible to receive a skipped turn. The match remains in `play` and
  waits for that runner to reconnect; disconnect alone can never finish the
  match.
- Setup map reset has no wall-clock expiry. `resetMap` only clears the member's
  ready submission under the normal generation/revision fence so the player can
  keep editing and submit again.

## Visual contract

- Art direction: a small toy village on a desk — cheerful clay pawns, a
  high-contrast wood/felt board, rounded toy walls and readable icon
  silhouettes. Soft cartoon accents are welcome, but the maze spine, floor and
  walls must never collapse into a low-contrast pastel wash.
- Rendering: fixed responsive orthographic camera, toon-shaded materials, sRGB,
  ACES tone mapping, soft bounded shadows and device-adaptive DPR.
- Dark fantasy assets and gameplay-specific renderers are not shared.
- Mobile mounts one focused WebGL board. Other runners use accessible DOM status
  chips; switching focus must not reveal map secrets.
- The precise 2D map editor remains the input surface and gains previous-map
  restore, automatic valid-draft save, undo and redo.
- A fake wall (`oneTimeWall`) is visually indistinguishable from a normal
  opaque wall before collision and always remains so to opponents and
  spectators. Its first collision blocks movement and subsequent attempts pass
  through. For a runner without `insight`, the discovered collision remains the
  same opaque normal-wall silhouette. Only the colliding `insight` runner gets
  the private fake-wall identification and may have that silhouette removed;
  public and opponent projections must not expose either signal.
- Reduced motion, keyboard operation, 44px touch targets, shape+icon+color wall
  identity and the 2D fallback are release requirements.

## Delivery phases and evidence

1. Engine foundation
   - Generated Functions vendor is synchronized with canonical V5 sources.
   - Differential transcripts cover movement, every item/special wall, both
     persistent runner gears and terminal settlement.
2. Server vertical slice
   - Create, join, submit/reset map, start and turn execute in one Admin RTDB
     transaction with CAS and idempotency tests. Setup/end leave, restart and
     close use the same envelope; play-phase leave is rejected.
   - Rules deny all client reads/writes to authority and all client writes to
     projections.
3. Full lifecycle
   - Presence, 45-second offline-current-turn skip, reconnect, leave, owner
     transfer/closure, restart, spectator views and ranking settlement are
     server-owned and tested. No disconnect path changes a runner into a
     forfeit or manufactures a result.
4. Client cutover
   - New rooms use Authority by default behind an emergency rollback flag.
   - No online component calls `resolveTurnAction` or writes canonical match
     outcome fields directly.
   - Authority UI has no voluntary-forfeit action and disables room leave for
     the entire `play` phase.
5. Toon product pass
   - Lobby, setup, play, result and ranking screens use scoped DaeMok tokens.
   - Mobile focused-board layout and every wall/item/skill effect have visual
     and accessibility coverage.
6. Release
   - Unit, Functions, emulator rules, deterministic parity, 2/3/4-player E2E,
     practice, spectator, reconnect, owner-disconnect, build and lint gates pass.
   - Production rules/functions/client are deployed in dependency order and a
     real production smoke test proves command, projection and reconnect paths.

## Rollout rule

Authority rooms use a distinct version and data root. Existing V3 client-owned
rooms continue only until they end. Default-on happens after the complete release
gate; deletion of legacy write rules happens only after no active legacy rooms
remain.
