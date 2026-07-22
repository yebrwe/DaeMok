"use strict";
// GENERATED FILE. Edit the canonical source under src/ and regenerate.
// Source: src/lib/gameTurn.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeConsumed = normalizeConsumed;
exports.isVisionObscuredForPlayer = isVisionObscuredForPlayer;
exports.getActiveFireVisionEffect = getActiveFireVisionEffect;
exports.getActivePoisonEffect = getActivePoisonEffect;
exports.mergeWallSegments = mergeWallSegments;
exports.findRadarWalls = findRadarWalls;
exports.appendTurnPosition = appendTurnPosition;
exports.getMineRollbackPosition = getMineRollbackPosition;
exports.sanitizeHiddenIllusionOutcomeForPresentation = sanitizeHiddenIllusionOutcomeForPresentation;
exports.sanitizeHiddenIllusionResolutionForPresentation = sanitizeHiddenIllusionResolutionForPresentation;
exports.resolveTurnAction = resolveTurnAction;
exports.settleCompletedGameState = settleCompletedGameState;
const game_1 = require("../types/game");
const gameUtils_1 = require("./gameUtils");
const diceWormhole_1 = require("./diceWormhole");
function isLegacyWormholeRun(run) {
    return run.challenge.version === 1 && (0, gameUtils_1.isValidWormholeChallenge)(run.challenge);
}
function isDiceWormholeRun(run) {
    return run.challenge.version === 2 && (0, diceWormhole_1.isValidDiceWormholeChallenge)(run.challenge);
}
function normalizeConsumed(value) {
    if (value === true)
        return { 0: true };
    return value && typeof value === 'object' ? { ...value } : {};
}
function isVisionObscuredForPlayer(state, playerId) {
    const player = state?.players?.[playerId];
    const effect = state?.visionEffectsByPlayer?.[playerId];
    return !!player && !player.finished && !player.forfeited && !player.hasLeft &&
        effect?.type === 'smoke' && (player.moves || 0) < effect.expiresAtTargetMove;
}
function isTimedEffectActive(state, playerId, effect) {
    const player = state?.players?.[playerId];
    return !!player && !player.finished && !player.forfeited && !player.hasLeft &&
        !!effect && (player.moves || 0) < effect.expiresAtTargetMove;
}
function getActiveFireVisionEffect(state, playerId) {
    const effect = state?.visionEffectsByPlayer?.[playerId];
    return effect?.type === 'fire' && isTimedEffectActive(state, playerId, effect) ? effect : null;
}
function getActivePoisonEffect(state, playerId) {
    const effect = state?.poisonEffectsByPlayer?.[playerId];
    return effect && isTimedEffectActive(state, playerId, effect) ? effect : null;
}
function mergeWallSegments(current, incoming) {
    const merged = [...current];
    incoming.forEach((wall) => {
        if (!merged.some((item) => (0, gameUtils_1.isSameWallSegment)(item.position, item.direction, wall.position, wall.direction))) {
            merged.push(wall);
        }
    });
    return merged;
}
function findRadarWalls(position, playedMap, consumed) {
    const mapItems = (0, gameUtils_1.getMapItems)(playedMap);
    const found = [];
    for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
            const cell = { row: position.row + dr, col: position.col + dc };
            if (!(0, gameUtils_1.isPositionInBoard)(cell))
                continue;
            ['up', 'down', 'left', 'right'].forEach((direction) => {
                const target = (0, gameUtils_1.getNewPosition)(cell, direction);
                if (!(0, gameUtils_1.isPositionInBoard)(target))
                    return;
                const hasWall = (playedMap.obstacles || []).some((wall) => (0, gameUtils_1.isSameWallSegment)(cell, direction, wall.position, wall.direction)) ||
                    mapItems.some((item, index) => (0, gameUtils_1.isWallItemType)(item.type) &&
                        !!item.wallPosition &&
                        !!item.wallDirection &&
                        (item.type === 'steelWall' || !consumed[index]) &&
                        (0, gameUtils_1.isSameWallSegment)(cell, direction, item.wallPosition, item.wallDirection));
                if (hasWall)
                    found.push({ position: cell, direction });
            });
        }
    }
    return mergeWallSegments([], found);
}
function appendTurnPosition(history, fallback, result) {
    const current = Array.isArray(history) && history.length > 0 ? history : [fallback];
    return [...current, result].slice(-8);
}
function getMineRollbackPosition(history, fallback) {
    const turns = Array.isArray(history) && history.length > 0 ? history : [fallback];
    return turns.length >= 2 ? turns[turns.length - 2] : turns[0];
}
function collisionRecord(value) {
    if (!value)
        return {};
    if (!Array.isArray(value))
        return { ...value };
    return Object.fromEntries(value.filter(Boolean).map((wall, index) => [`legacy_${index}`, wall]));
}
function normalizeItemFlags(value) {
    if (value === true)
        return { 0: true };
    return value && typeof value === 'object' ? { ...value } : {};
}
const FIRE_ACTION_DURATION = 4;
const POISON_ACTION_DURATION = 4;
const CARDINAL_DIRECTIONS = ['up', 'down', 'left', 'right'];
const DIRECTION_LABELS = {
    up: '위',
    right: '오른쪽',
    down: '아래',
    left: '왼쪽',
};
/**
 * Illusion activation and progress are trusted reducer details, not player
 * feedback. Keep those markers available to Authority validation, then pass
 * the result through this boundary before showing or returning it to a player.
 * The wake-up return is deliberately public because the board really rewinds.
 */
function sanitizeHiddenIllusionOutcomeForPresentation(outcome, playerDisplayName = '플레이어') {
    if (outcome.type !== 'move'
        || !outcome.illusionTransition
        || outcome.illusionTransition === 'returned')
        return outcome;
    const hiddenTransition = outcome.illusionTransition;
    const sanitized = { ...outcome };
    delete sanitized.illusionTransition;
    delete sanitized.illusionReturnPosition;
    delete sanitized.illusionReturnFromWormhole;
    // The trigger wall must be indistinguishable from an ordinary open edge.
    // If another, visible landing effect happened on the same action, retain
    // that effect while removing only the illusion-wall metadata.
    if (hiddenTransition === 'activated') {
        delete sanitized.wallEffect;
        delete sanitized.wallItemIndex;
        if (outcome.effect === 'move') {
            sanitized.consumedItemIndex = null;
            delete sanitized.itemPosition;
        }
    }
    if ((hiddenTransition === 'activated' || hiddenTransition === 'phased')
        && sanitized.effect === 'move') {
        const ordinaryMoveMessage = `${playerDisplayName || '플레이어'}가 한 칸 이동했습니다.`;
        sanitized.message = sanitized.poisonMisdirected === true
            && sanitized.requestedDirection !== undefined
            ? `중독으로 ${DIRECTION_LABELS[sanitized.requestedDirection]} 입력이 ${DIRECTION_LABELS[sanitized.direction]} 방향으로 뒤틀렸습니다. ${ordinaryMoveMessage}`
            : ordinaryMoveMessage;
    }
    return sanitized;
}
function sanitizeHiddenIllusionResolutionForPresentation(resolution, actorId) {
    const outcome = sanitizeHiddenIllusionOutcomeForPresentation(resolution.outcome, resolution.state.players[actorId]?.displayName || '플레이어');
    if (outcome === resolution.outcome)
        return resolution;
    return {
        state: {
            ...resolution.state,
            turnMessage: outcome.message,
        },
        outcome,
    };
}
function stableEffectHash(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}
function poisonDirectionForAction(state, actorId, requestedDirection) {
    const effect = getActivePoisonEffect(state, actorId);
    if (!effect)
        return requestedDirection;
    const actionNumber = state.players[actorId]?.moves || 0;
    return CARDINAL_DIRECTIONS[stableEffectHash(`${effect.seed}:direction:${actionNumber}`) % CARDINAL_DIRECTIONS.length];
}
function forgetWallKnowledgeForPlayer(state, playerId) {
    const collisionWalls = Object.fromEntries(Object.entries(collisionRecord(state.collisionWalls)).filter(([, wall]) => wall.playerId !== playerId));
    const revealedWallsByPlayer = { ...(state.revealedWallsByPlayer || {}) };
    delete revealedWallsByPlayer[playerId];
    const nextState = {
        ...state,
        collisionWalls,
        revealedWallsByPlayer,
    };
    const wormholeRun = state.wormholeRunsByPlayer?.[playerId];
    if (wormholeRun && isLegacyWormholeRun(wormholeRun) && wormholeRun.discoveredWalls?.length) {
        const clearedRun = { ...wormholeRun };
        delete clearedRun.discoveredWalls;
        nextState.wormholeRunsByPlayer = {
            ...(state.wormholeRunsByPlayer || {}),
            [playerId]: clearedRun,
        };
    }
    return nextState;
}
function matchingWallItemIndex(position, direction, items, consumed, activeWalls, ignoredItemIndex = null) {
    return items.findIndex((item, index) => {
        if (index === ignoredItemIndex)
            return false;
        if (!(0, gameUtils_1.isWallItemType)(item.type) || !item.wallPosition || !item.wallDirection)
            return false;
        if (!(0, gameUtils_1.isSameWallSegment)(position, direction, item.wallPosition, item.wallDirection))
            return false;
        if (item.type === 'steelWall')
            return true;
        if (item.type === 'collapseWall' && activeWalls[index])
            return true;
        return !consumed[index];
    });
}
function wallItemWouldBlock(item, index, activeWalls, phaseOpen) {
    switch (item.type) {
        case 'oneTimeWall':
        case 'steelWall':
        case 'fireWall':
        case 'iceWall':
        case 'windWall':
        case 'thornWall':
        case 'crystalWall':
            return true;
        case 'collapseWall':
            return !!activeWalls[index];
        case 'phaseWall':
            return !phaseOpen[index];
        case 'poisonWall':
        case 'fogWall':
        case 'illusionWall':
        case 'mirrorWall':
        case 'mine':
        case 'wormhole':
        case 'radar':
        case 'smoke':
            return false;
    }
}
function permanentBlockingWalls(playedMap, items, activeWalls, extra = []) {
    const itemWalls = items.flatMap((item, index) => {
        const isPermanent = item.type === 'steelWall' ||
            (item.type === 'collapseWall' && !!activeWalls[index]);
        return isPermanent && item.wallPosition && item.wallDirection
            ? [{ position: item.wallPosition, direction: item.wallDirection }]
            : [];
    });
    return [...(playedMap.obstacles || []), ...itemWalls, ...extra];
}
function hasGoalPath(position, playedMap, items, activeWalls, extra = []) {
    return !!(0, gameUtils_1.findShortestPath)(position, playedMap.endPosition, permanentBlockingWalls(playedMap, items, activeWalls, extra));
}
function unconsumedFakeWallObstacles(items, consumed) {
    return items.flatMap((item, index) => item.type === 'oneTimeWall' &&
        !consumed[index] &&
        item.wallPosition &&
        item.wallDirection
        ? [{ position: item.wallPosition, direction: item.wallDirection }]
        : []);
}
function isBlockedForForcedStep(position, direction, playedMap, items, consumed, activeWalls, ignoredItemIndex = null) {
    if (!(0, gameUtils_1.canMove)(position, direction, playedMap.obstacles || []))
        return true;
    return matchingWallItemIndex(position, direction, items, consumed, activeWalls, ignoredItemIndex) >= 0;
}
function findNearbyStaticWalls(position, playedMap) {
    const found = [];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
            const cell = { row: position.row + rowOffset, col: position.col + colOffset };
            if (!(0, gameUtils_1.isPositionInBoard)(cell))
                continue;
            for (const wall of playedMap.obstacles || []) {
                if ((0, gameUtils_1.isSamePosition)(wall.position, cell) ||
                    (0, gameUtils_1.isSamePosition)((0, gameUtils_1.getNewPosition)(wall.position, wall.direction), cell)) {
                    found.push(wall);
                }
            }
        }
    }
    return mergeWallSegments([], found);
}
function resolveLegacyWormholeMove(state, actorId, direction, playedMap, mapOwnerId, now, consumeOutOfBounds = false) {
    const player = state.players[actorId];
    const run = state.wormholeRunsByPlayer?.[actorId];
    if (!player || !run || run.mapOwnerId !== mapOwnerId) {
        return null;
    }
    // Version-specific resolution stays behind this dispatcher. A V2 challenge
    // must never fall through to the V1 seal-maze rules below.
    if (!isLegacyWormholeRun(run))
        return null;
    const wormhole = (0, gameUtils_1.getMapItems)(playedMap)[run.itemIndex];
    if (!wormhole ||
        wormhole.type !== 'wormhole' ||
        !wormhole.exit ||
        !wormhole.challenge ||
        wormhole.challenge.version !== 1)
        return null;
    const origin = run.position;
    const attempted = (0, gameUtils_1.getNewPosition)(origin, direction);
    const attemptedInBoard = (0, gameUtils_1.isPositionInBoard)(attempted);
    if (!attemptedInBoard && !consumeOutOfBounds)
        return null;
    const blocked = !attemptedInBoard || !(0, gameUtils_1.canMove)(origin, direction, run.challenge.obstacles);
    const position = blocked ? origin : attempted;
    const activatedSeals = { ...(run.activatedSeals || {}) };
    const sealIndex = blocked
        ? -1
        : run.challenge.seals.findIndex((seal) => (0, gameUtils_1.isSamePosition)(seal, position));
    const activatedNewSeal = sealIndex >= 0 && !activatedSeals[sealIndex];
    if (activatedNewSeal)
        activatedSeals[sealIndex] = true;
    const activatedSealCount = run.challenge.seals.reduce((count, _, index) => count + (activatedSeals[index] ? 1 : 0), 0);
    const allSealsActivated = activatedSealCount === run.challenge.seals.length;
    const returned = !blocked && allSealsActivated && (0, gameUtils_1.isSamePosition)(position, run.challenge.endPosition);
    const moves = (player.moves || 0) + 1;
    const discoveredWalls = blocked && attemptedInBoard
        ? mergeWallSegments(run.discoveredWalls || [], [{ position: origin, direction }])
        : [...(run.discoveredWalls || [])];
    let message = blocked
        ? attemptedInBoard
            ? '웜홀 내부의 숨은 벽에 부딪혔습니다.'
            : '중독으로 웜홀 경계에 부딪혀 행동을 소모했습니다.'
        : `${player.displayName || '플레이어'}가 웜홀 내부에서 한 칸 이동했습니다.`;
    let wormholeTransition;
    if (activatedNewSeal) {
        wormholeTransition = 'seal';
        message = `웜홀 봉인을 해제했습니다. ${activatedSealCount}/${run.challenge.seals.length}`;
    }
    else if (!blocked && (0, gameUtils_1.isSamePosition)(position, run.challenge.endPosition) && !allSealsActivated) {
        message = `내부 출구가 잠겨 있습니다. 봉인 ${run.challenge.seals.length - activatedSealCount}개가 남았습니다.`;
    }
    const players = {
        ...state.players,
        [actorId]: returned
            ? {
                ...player,
                position: { ...wormhole.exit },
                moves,
                positionHistory: appendTurnPosition(player.positionHistory, player.position || playedMap.startPosition, wormhole.exit),
            }
            : { ...player, moves },
    };
    const runs = { ...(state.wormholeRunsByPlayer || {}) };
    if (returned) {
        delete runs[actorId];
        wormholeTransition = 'returned';
        message = `${player.displayName || '플레이어'}가 모든 봉인을 풀고 웜홀에서 탈출했습니다.`;
    }
    else {
        runs[actorId] = {
            ...run,
            position,
            ...(Object.keys(activatedSeals).length > 0 ? { activatedSeals } : {}),
            ...(discoveredWalls.length > 0 ? { discoveredWalls } : {}),
        };
    }
    const nextState = {
        ...state,
        players,
        currentTurn: (0, gameUtils_1.getNextTurnPlayerId)(players, actorId, state.turnOrder),
        turnNumber: (state.turnNumber || 1) + 1,
        turnMessage: message,
        turnMessageTimestamp: now,
    };
    if (Object.keys(runs).length > 0)
        nextState.wormholeRunsByPlayer = runs;
    else
        delete nextState.wormholeRunsByPlayer;
    return {
        state: nextState,
        outcome: {
            type: 'move',
            direction,
            origin,
            attempted,
            position: returned ? { ...wormhole.exit } : position,
            moves,
            effect: blocked ? 'bump' : returned ? 'wormhole' : 'move',
            consumedItemIndex: null,
            ...(returned ? {
                itemPosition: player.position || playedMap.startPosition,
                wormholeExit: wormhole.exit,
            } : {}),
            realm: returned ? 'main' : 'wormhole',
            ...(wormholeTransition ? { wormholeTransition } : {}),
            reachedGoal: false,
            message,
        },
    };
}
function resolveDiceWormholeMove(state, actorId, direction, playedMap, mapOwnerId, now) {
    const player = state.players[actorId];
    const run = state.wormholeRunsByPlayer?.[actorId];
    if (!player || !run || run.mapOwnerId !== mapOwnerId || !isDiceWormholeRun(run))
        return null;
    const wormhole = (0, gameUtils_1.getMapItems)(playedMap)[run.itemIndex];
    if (!wormhole ||
        wormhole.type !== 'wormhole' ||
        !wormhole.exit ||
        wormhole.challenge?.version !== 2 ||
        !(0, diceWormhole_1.isValidDiceWormholeChallenge)(wormhole.challenge))
        return null;
    const origin = run.position;
    const attempted = (0, gameUtils_1.getNewPosition)(origin, direction);
    const attemptedInBoard = (0, diceWormhole_1.isDiceWormholePosition)(attempted);
    const blocked = !attemptedInBoard || run.challenge.blockedCells.some((cell) => (0, gameUtils_1.isSamePosition)(cell, attempted));
    const position = blocked ? origin : attempted;
    const orientation = blocked
        ? run.orientation
        : (0, diceWormhole_1.rollDiceOrientation)(run.orientation, direction);
    const actionsTaken = run.actionsTaken + 1;
    const top = (0, diceWormhole_1.getDiceOrientationFaces)(orientation).top;
    const returned = !blocked &&
        (0, gameUtils_1.isSamePosition)(position, run.challenge.endPosition) &&
        top === run.challenge.targetTop;
    const moves = (player.moves || 0) + 1;
    let message = blocked
        ? attemptedInBoard
            ? '주사위가 차원 방의 막힌 칸에 부딪혔습니다.'
            : '주사위가 차원 방 경계에 부딪혀 행동을 소모했습니다.'
        : `${player.displayName || '플레이어'}가 주사위를 굴렸습니다. 현재 윗면 ${top}`;
    if (!blocked && (0, gameUtils_1.isSamePosition)(position, run.challenge.endPosition) && !returned) {
        message = `출구에 도착했지만 윗면이 ${top}입니다. ${run.challenge.targetTop}을(를) 맞춰야 나갈 수 있습니다.`;
    }
    const players = {
        ...state.players,
        [actorId]: returned
            ? {
                ...player,
                position: { ...wormhole.exit },
                moves,
                positionHistory: appendTurnPosition(player.positionHistory, player.position || playedMap.startPosition, wormhole.exit),
            }
            : { ...player, moves },
    };
    const runs = { ...(state.wormholeRunsByPlayer || {}) };
    let wormholeTransition;
    if (returned) {
        delete runs[actorId];
        wormholeTransition = 'returned';
        message = `주사위 윗면 ${run.challenge.targetTop}을(를) 맞춰 웜홀에서 탈출했습니다.`;
    }
    else {
        const nextRun = {
            ...run,
            position,
            orientation,
            actionsTaken,
        };
        runs[actorId] = nextRun;
    }
    const nextState = {
        ...state,
        players,
        currentTurn: (0, gameUtils_1.getNextTurnPlayerId)(players, actorId, state.turnOrder),
        turnNumber: (state.turnNumber || 1) + 1,
        turnMessage: message,
        turnMessageTimestamp: now,
    };
    if (Object.keys(runs).length > 0)
        nextState.wormholeRunsByPlayer = runs;
    else
        delete nextState.wormholeRunsByPlayer;
    return {
        state: nextState,
        outcome: {
            type: 'move',
            direction,
            origin,
            attempted,
            position: returned ? { ...wormhole.exit } : position,
            moves,
            effect: blocked ? 'bump' : returned ? 'wormhole' : 'move',
            consumedItemIndex: null,
            ...(returned ? {
                itemPosition: player.position || playedMap.startPosition,
                wormholeExit: wormhole.exit,
            } : {}),
            realm: returned ? 'main' : 'wormhole',
            ...(wormholeTransition ? { wormholeTransition } : {}),
            reachedGoal: false,
            message,
        },
    };
}
function resolveWormholeMove(state, actorId, direction, playedMap, mapOwnerId, now, consumeOutOfBounds = false) {
    const run = state.wormholeRunsByPlayer?.[actorId];
    if (!run)
        return null;
    return run.challenge.version === 2
        ? resolveDiceWormholeMove(state, actorId, direction, playedMap, mapOwnerId, now)
        : resolveLegacyWormholeMove(state, actorId, direction, playedMap, mapOwnerId, now, consumeOutOfBounds);
}
function resolveMove(state, actorId, direction, playedMap, mapOwnerId, runnerGear, now, consumeOutOfBounds = false) {
    const player = state.players[actorId];
    const origin = player.position || playedMap.startPosition;
    const attempted = (0, gameUtils_1.getNewPosition)(origin, direction);
    const attemptedInBoard = (0, gameUtils_1.isPositionInBoard)(attempted);
    if (!attemptedInBoard && !consumeOutOfBounds)
        return null;
    const mapItems = (0, gameUtils_1.getMapItems)(playedMap);
    const mapItemState = state.itemState?.[mapOwnerId];
    const consumed = normalizeConsumed(mapItemState?.consumed);
    const activeWalls = normalizeItemFlags(mapItemState?.activeWalls);
    const phaseOpen = normalizeItemFlags(mapItemState?.phaseOpen);
    let consumedChanged = false;
    let activeWallsChanged = false;
    let phaseOpenChanged = false;
    let moves = (player.moves || 0) + 1;
    let position = origin;
    let effect = 'move';
    let consumedItemIndex = null;
    let wallEffect;
    let wallItemIndex;
    let itemPosition;
    let wormholeExit;
    let wormholeTransition;
    let illusionTransition;
    let wormholeRunToCreate = null;
    let crystalRevealed = [];
    let needsFinalLandingTrapCheck = false;
    let smokeTriggered = false;
    let fireTriggered = false;
    let poisonTriggered = false;
    let message = `${player.displayName || '플레이어'}가 한 칸 이동했습니다.`;
    const activeFireEffect = getActiveFireVisionEffect(state, actorId);
    const consumeItem = (index) => {
        consumed[index] = true;
        consumedChanged = true;
        consumedItemIndex = index;
    };
    const applyLandingTrap = (landingPosition, fallbackPosition) => {
        // Goal arrival is terminal. Valid V5 maps cannot place a cell trap on the goal,
        // but this also gives legacy/malformed maps deterministic ordering.
        if ((0, gameUtils_1.isSamePosition)(landingPosition, playedMap.endPosition))
            return false;
        const mineIndex = mapItems.findIndex((item, index) => item.type === 'mine' &&
            !!item.position &&
            !consumed[index] &&
            (0, gameUtils_1.isSamePosition)(landingPosition, item.position));
        const wormholeIndex = mapItems.findIndex((item, index) => item.type === 'wormhole' &&
            !!item.entrance &&
            !consumed[index] &&
            (0, gameUtils_1.isSamePosition)(landingPosition, item.entrance));
        const smokeIndex = mapItems.findIndex((item, index) => item.type === 'smoke' &&
            !!item.position &&
            !consumed[index] &&
            (0, gameUtils_1.isSamePosition)(landingPosition, item.position));
        if (mineIndex >= 0) {
            const rollback = getMineRollbackPosition(player.positionHistory, fallbackPosition);
            const rollbackIsSafe = hasGoalPath(rollback, playedMap, mapItems, activeWalls);
            position = rollbackIsSafe ? rollback : landingPosition;
            effect = 'mine';
            consumeItem(mineIndex);
            itemPosition = mapItems[mineIndex].position;
            message = rollbackIsSafe
                ? `${player.displayName || '플레이어'}가 지뢰를 밟아 2턴 전 위치로 돌아갔습니다.`
                : '지뢰가 폭발했지만 안전한 되감기 경로가 없어 착지 칸에 남았습니다.';
            return true;
        }
        if (wormholeIndex >= 0) {
            const wormhole = mapItems[wormholeIndex];
            const exit = wormhole.exit;
            const exitIsSafe = (0, gameUtils_1.isWormholeExitSafe)(playedMap, exit);
            effect = 'wormhole';
            consumeItem(wormholeIndex);
            itemPosition = wormhole.entrance;
            if (exitIsSafe && exit && runnerGear === 'wormholeEscapeKit') {
                position = { ...exit };
                wormholeExit = { ...exit };
                message = `${player.displayName || '플레이어'}가 웜홀 탈출키트로 내부 퍼즐을 건너뛰고 출구로 이동했습니다.`;
            }
            else if (exitIsSafe &&
                exit &&
                wormhole.challenge &&
                (0, gameUtils_1.isValidWormholeChallenge)(wormhole.challenge)) {
                position = landingPosition;
                wormholeExit = wormhole.challenge.startPosition;
                wormholeTransition = 'entered';
                const challenge = (0, gameUtils_1.cloneWormholeChallenge)(wormhole.challenge);
                wormholeRunToCreate = challenge.version === 2
                    ? {
                        mapOwnerId,
                        itemIndex: wormholeIndex,
                        position: { ...challenge.startPosition },
                        challenge,
                        orientation: challenge.initialOrientation,
                        actionsTaken: 0,
                        enteredAtTurn: state.turnNumber || 1,
                    }
                    : {
                        mapOwnerId,
                        itemIndex: wormholeIndex,
                        position: { ...challenge.startPosition },
                        challenge,
                        enteredAtTurn: state.turnNumber || 1,
                    };
                message = challenge.version === 2
                    ? `${player.displayName || '플레이어'}가 주사위 웜홀 방으로 끌려갔습니다. 출구에서 윗면 ${challenge.targetTop}을(를) 맞춰야 합니다.`
                    : `${player.displayName || '플레이어'}가 웜홀 내부 미로로 끌려갔습니다.`;
            }
            else {
                const destination = exitIsSafe && exit ? exit : fallbackPosition;
                position = destination;
                wormholeExit = position;
                message = exitIsSafe
                    ? `${player.displayName || '플레이어'}가 웜홀을 통과했습니다.`
                    : '불안정한 출구로 웜홀이 붕괴했습니다.';
            }
            return true;
        }
        if (smokeIndex >= 0) {
            position = landingPosition;
            effect = 'smoke';
            smokeTriggered = true;
            consumeItem(smokeIndex);
            itemPosition = mapItems[smokeIndex].position;
            message = activeFireEffect
                ? `${player.displayName || '플레이어'}가 연막 함정을 밟았지만 타오르는 불길이 연막을 흩트러뜨렸습니다. 화염 상태가 계속됩니다.`
                : `${player.displayName || '플레이어'}가 연막 함정을 밟았습니다. 다음 차례의 시야가 가려집니다.`;
            return true;
        }
        return false;
    };
    const staticWallBlocked = attemptedInBoard &&
        !(0, gameUtils_1.canMove)(origin, direction, playedMap.obstacles || []);
    const matchingIndex = attemptedInBoard && !staticWallBlocked
        ? matchingWallItemIndex(origin, direction, mapItems, consumed, activeWalls)
        : -1;
    const contactedWallItem = matchingIndex >= 0 ? mapItems[matchingIndex] : null;
    const illusionActive = !!state.illusionEffectsByPlayer?.[actorId];
    const phasedBlockingWall = illusionActive && attemptedInBoard && (staticWallBlocked || (!!contactedWallItem &&
        wallItemWouldBlock(contactedWallItem, matchingIndex, activeWalls, phaseOpen)));
    const wallItem = phasedBlockingWall ? null : contactedWallItem;
    let blocked = !attemptedInBoard || staticWallBlocked;
    if (phasedBlockingWall) {
        blocked = false;
        illusionTransition = 'phased';
        // The transition is retained only for trusted validation. Presentation
        // must look exactly like an ordinary move so the runner cannot tell that
        // a hidden wall was phased.
        message = `${player.displayName || '플레이어'}가 한 칸 이동했습니다.`;
    }
    if (wallItem) {
        wallItemIndex = matchingIndex;
        itemPosition = wallItem.wallPosition;
        if (wallItem.type !== 'oneTimeWall')
            wallEffect = wallItem.type;
        switch (wallItem.type) {
            case 'oneTimeWall':
                blocked = true;
                consumeItem(matchingIndex);
                message = `${player.displayName || '플레이어'}가 벽에 부딪혔습니다.`;
                break;
            case 'steelWall':
                blocked = true;
                message = '강철벽은 파괴되지 않고 이동을 막습니다.';
                break;
            case 'fireWall':
                blocked = true;
                consumeItem(matchingIndex);
                fireTriggered = true;
                message = '화염벽에 부딪혀 불이 붙었습니다. 벽에 대한 기억이 흐려집니다.';
                break;
            case 'fogWall':
                consumeItem(matchingIndex);
                smokeTriggered = true;
                message = activeFireEffect
                    ? '안개벽을 통과했지만 타오르는 불길이 안개를 흘트러뜨렸습니다. 화염 상태가 계속됩니다.'
                    : '안개벽을 통과했습니다. 다음 차례의 시야가 가려집니다.';
                break;
            case 'illusionWall':
                consumeItem(matchingIndex);
                illusionTransition = 'activated';
                message = `${player.displayName || '플레이어'}가 한 칸 이동했습니다.`;
                break;
            case 'poisonWall':
                consumeItem(matchingIndex);
                poisonTriggered = true;
                message = '독벽을 통과해 중독됐습니다. 다음 4번의 행동 방향이 무작위로 뒤틀립니다.';
                break;
            case 'collapseWall':
                blocked = !!activeWalls[matchingIndex];
                message = blocked
                    ? '이미 붕괴한 벽이 이동을 막습니다.'
                    : '붕괴벽을 통과했습니다.';
                break;
            case 'phaseWall':
                if (phaseOpen[matchingIndex]) {
                    phaseOpen[matchingIndex] = false;
                    phaseOpenChanged = true;
                    message = '열린 위상벽을 통과했습니다.';
                }
                else {
                    blocked = true;
                    phaseOpen[matchingIndex] = true;
                    phaseOpenChanged = true;
                    message = '위상벽에 막혔습니다. 다음 시도에는 통과할 수 있습니다.';
                }
                break;
            case 'thornWall':
                blocked = true;
                consumeItem(matchingIndex);
                message = '가시벽에 막혀 반대 방향으로 튕겨납니다.';
                break;
            case 'crystalWall':
                blocked = true;
                consumeItem(matchingIndex);
                crystalRevealed = findNearbyStaticWalls(origin, playedMap);
                message = '수정벽이 부서지며 주변의 진짜 벽을 드러냈습니다.';
                break;
            case 'iceWall':
                blocked = true;
                consumeItem(matchingIndex);
                moves += 1;
                message = '빙결벽에 막혀 얼어붙었습니다. 행동 수가 1 추가됩니다.';
                break;
            case 'windWall':
                blocked = true;
                consumeItem(matchingIndex);
                message = '바람벽에 막혀 지정 방향으로 튕겨납니다.';
                break;
            case 'mirrorWall':
                consumeItem(matchingIndex);
                message = '거울벽을 통과해 반전된 뒤 벽이 깨졌습니다.';
                break;
        }
    }
    if (blocked) {
        effect = 'bump';
        if (!wallItem)
            message = `${player.displayName || '플레이어'}가 벽에 부딪혔습니다.`;
        if (wallItem?.type === 'thornWall' || wallItem?.type === 'windWall') {
            const reboundDirection = wallItem.type === 'thornWall'
                ? (0, gameUtils_1.getOppositeDirection)(direction)
                : wallItem.effectDirection || direction;
            const rebound = (0, gameUtils_1.getNewPosition)(origin, reboundDirection);
            const canRebound = (0, gameUtils_1.isPositionInBoard)(rebound) &&
                !(0, gameUtils_1.isSamePosition)(rebound, playedMap.endPosition) &&
                !isBlockedForForcedStep(origin, reboundDirection, playedMap, mapItems, consumed, activeWalls, matchingIndex) &&
                hasGoalPath(rebound, playedMap, mapItems, activeWalls);
            if (canRebound) {
                position = rebound;
                needsFinalLandingTrapCheck = true;
                message = wallItem.type === 'thornWall'
                    ? '가시벽에 막혀 반대 방향으로 한 칸 튕겨났습니다.'
                    : `바람벽에 막혀 ${DIRECTION_LABELS[reboundDirection]}으로 한 칸 튕겨났습니다.`;
            }
            else {
                message = wallItem.type === 'thornWall'
                    ? '가시벽이 부서졌지만 뒤 칸이 막혀 제자리에 남았습니다.'
                    : '바람벽이 사라졌지만 밀릴 칸이 막혀 제자리에 남았습니다.';
            }
        }
    }
    if (!blocked) {
        position = attempted;
        const cellEffectTriggered = applyLandingTrap(attempted, origin);
        if (!cellEffectTriggered && wallItem && !(0, gameUtils_1.isSamePosition)(attempted, playedMap.endPosition)) {
            if (wallItem.type === 'mirrorWall') {
                const mirrorTarget = {
                    row: gameUtils_1.BOARD_SIZE - 1 - attempted.row,
                    col: gameUtils_1.BOARD_SIZE - 1 - attempted.col,
                };
                if (!(0, gameUtils_1.isSamePosition)(mirrorTarget, playedMap.endPosition) &&
                    hasGoalPath(mirrorTarget, playedMap, mapItems, activeWalls)) {
                    position = mirrorTarget;
                    needsFinalLandingTrapCheck = true;
                }
            }
        }
        if (wallItem?.type === 'collapseWall' && !activeWalls[matchingIndex]) {
            const collapsedWall = wallItem.wallPosition && wallItem.wallDirection
                ? [{ position: wallItem.wallPosition, direction: wallItem.wallDirection }]
                : [];
            const beliefSafeWalls = [
                ...collapsedWall,
                ...unconsumedFakeWallObstacles(mapItems, consumed),
            ];
            const targetRemainsSafe = collapsedWall.length > 0 &&
                hasGoalPath(attempted, playedMap, mapItems, activeWalls, beliefSafeWalls) &&
                hasGoalPath(position, playedMap, mapItems, activeWalls, beliefSafeWalls);
            if (targetRemainsSafe) {
                activeWalls[matchingIndex] = true;
                activeWallsChanged = true;
                message = '통과한 붕괴벽이 뒤에서 영구적으로 닫혔습니다.';
            }
            else {
                consumeItem(matchingIndex);
                message = '붕괴벽이 경로를 막을 수 있어 활성화되지 않고 사라졌습니다.';
            }
        }
    }
    if (needsFinalLandingTrapCheck) {
        applyLandingTrap(position, blocked ? origin : attempted);
    }
    const reachedGoal = (0, gameUtils_1.isSamePosition)(position, playedMap.endPosition);
    const updatedPlayer = {
        ...player,
        position,
        moves,
        positionHistory: appendTurnPosition(player.positionHistory, origin, position),
        ...(reachedGoal ? { finished: true, finishMoves: moves } : {}),
    };
    const players = { ...state.players, [actorId]: updatedPlayer };
    let nextState = {
        ...state,
        players,
        currentTurn: (0, gameUtils_1.getNextTurnPlayerId)(players, actorId, state.turnOrder),
        turnNumber: (state.turnNumber || 1) + 1,
        turnMessage: message,
        turnMessageTimestamp: now,
    };
    if (consumedChanged || activeWallsChanged || phaseOpenChanged) {
        nextState.itemState = {
            ...(state.itemState || {}),
            [mapOwnerId]: {
                ...(mapItemState || {}),
                ...(consumedChanged ? { consumed, consumedAt: now } : {}),
                ...(activeWallsChanged ? { activeWalls } : {}),
                ...(phaseOpenChanged ? { phaseOpen } : {}),
            },
        };
    }
    if (crystalRevealed.length > 0) {
        nextState.revealedWallsByPlayer = {
            ...(state.revealedWallsByPlayer || {}),
            [actorId]: mergeWallSegments(state.revealedWallsByPlayer?.[actorId] || [], crystalRevealed),
        };
    }
    // Fire owns the single vision-effect slot for its full four-action lifetime.
    // A smoke trap is still consumed, but cannot truncate an active fire ledger.
    if (smokeTriggered && !activeFireEffect) {
        nextState.visionEffectsByPlayer = {
            ...(state.visionEffectsByPlayer || {}),
            [actorId]: {
                type: 'smoke',
                sourcePlayerId: mapOwnerId,
                appliedAtTurn: state.turnNumber || 1,
                expiresAtTargetMove: moves + 1,
            },
        };
    }
    if (fireTriggered) {
        // Ignition immediately wipes only this runner's learned wall state. The
        // consumed fire wall itself is deliberately not re-added as a collision.
        nextState = forgetWallKnowledgeForPlayer(nextState, actorId);
        nextState.visionEffectsByPlayer = {
            ...(state.visionEffectsByPlayer || {}),
            [actorId]: {
                type: 'fire',
                sourcePlayerId: mapOwnerId,
                appliedAtTurn: state.turnNumber || 1,
                expiresAtTargetMove: moves + FIRE_ACTION_DURATION,
            },
        };
    }
    if (poisonTriggered && !updatedPlayer.finished) {
        nextState.poisonEffectsByPlayer = {
            ...(state.poisonEffectsByPlayer || {}),
            [actorId]: {
                sourcePlayerId: mapOwnerId,
                appliedAtTurn: state.turnNumber || 1,
                expiresAtTargetMove: moves + POISON_ACTION_DURATION,
                seed: stableEffectHash(`${actorId}:${mapOwnerId}:${state.turnNumber || 1}:poison`),
            },
        };
    }
    if (wormholeRunToCreate) {
        nextState.wormholeRunsByPlayer = {
            ...(state.wormholeRunsByPlayer || {}),
            [actorId]: wormholeRunToCreate,
        };
    }
    const identifiedFakeWall = blocked &&
        wallItem?.type === 'oneTimeWall' &&
        runnerGear === 'insight';
    if (blocked && attemptedInBoard && wallItem?.type !== 'fireWall') {
        const collision = {
            playerId: actorId,
            position: origin,
            direction,
            timestamp: now,
            mapOwnerId,
            ...(identifiedFakeWall ? { identifiedAsFake: true } : {}),
        };
        const safePlayerId = actorId.replace(/[.#$\[\]/]/g, '_');
        const collisionKey = `turn_${state.turnNumber || 1}_${safePlayerId}`;
        nextState.collisionWalls = {
            ...collisionRecord(state.collisionWalls),
            [collisionKey]: collision,
        };
    }
    return {
        state: nextState,
        outcome: {
            type: 'move',
            direction,
            origin,
            attempted,
            position,
            moves,
            effect,
            consumedItemIndex,
            wallEffect,
            wallItemIndex,
            itemPosition,
            wormholeExit,
            ...(wormholeTransition ? { realm: 'main', wormholeTransition } : {}),
            ...(illusionTransition ? { illusionTransition } : {}),
            ...(identifiedFakeWall ? { identifiedFakeWall: true } : {}),
            reachedGoal,
            message,
        },
    };
}
function applyIllusionActionProgress(stateBeforeAction, actorId, mapOwnerId, resolution) {
    if (resolution.outcome.type !== 'move')
        return resolution;
    const outcome = resolution.outcome;
    const previousEffect = stateBeforeAction.illusionEffectsByPlayer?.[actorId];
    const actionStartedInWormhole = !!stateBeforeAction.wormholeRunsByPlayer?.[actorId];
    const resolvedPlayer = resolution.state.players[actorId];
    if (!resolvedPlayer)
        return resolution;
    if (!previousEffect) {
        if (outcome.illusionTransition !== 'activated' || resolvedPlayer.finished)
            return resolution;
        resolution.state.illusionEffectsByPlayer = {
            ...(resolution.state.illusionEffectsByPlayer || {}),
            [actorId]: {
                sourcePlayerId: mapOwnerId,
                appliedAtTurn: stateBeforeAction.turnNumber || 1,
                actionsRemaining: 3,
            },
        };
        return resolution;
    }
    const firstWallOrigin = previousEffect.firstWallOrigin ||
        (outcome.illusionTransition === 'phased' ? { ...outcome.origin } : undefined);
    const actionsRemaining = previousEffect.actionsRemaining - 1;
    const illusionEffectsByPlayer = {
        ...(resolution.state.illusionEffectsByPlayer || {}),
    };
    if (actionsRemaining > 0 && !resolvedPlayer.finished) {
        illusionEffectsByPlayer[actorId] = {
            ...previousEffect,
            actionsRemaining,
            ...(firstWallOrigin ? { firstWallOrigin } : {}),
        };
        resolution.state.illusionEffectsByPlayer = illusionEffectsByPlayer;
        return resolution;
    }
    delete illusionEffectsByPlayer[actorId];
    if (Object.keys(illusionEffectsByPlayer).length > 0) {
        resolution.state.illusionEffectsByPlayer = illusionEffectsByPlayer;
    }
    else {
        delete resolution.state.illusionEffectsByPlayer;
    }
    // Reaching the goal during the first or second affected action remains
    // terminal. On the third action, however, the promised wake-up return is
    // resolved before finish settlement.
    if (actionsRemaining !== 0 || !firstWallOrigin) {
        if (actionsRemaining === 0)
            outcome.illusionTransition = 'expired';
        return resolution;
    }
    const returnedPlayer = {
        ...resolvedPlayer,
        position: { ...firstWallOrigin },
        positionHistory: appendTurnPosition(stateBeforeAction.players[actorId]?.positionHistory, stateBeforeAction.players[actorId]?.position || firstWallOrigin, firstWallOrigin),
        finished: false,
    };
    delete returnedPlayer.finishMoves;
    const players = {
        ...resolution.state.players,
        [actorId]: returnedPlayer,
    };
    const wormholeRunsByPlayer = { ...(resolution.state.wormholeRunsByPlayer || {}) };
    delete wormholeRunsByPlayer[actorId];
    const returnMessage = `${resolvedPlayer.displayName || '플레이어'}의 환영이 깨져 처음 관통한 원래 막힌 벽 직전으로 돌아갔습니다.`;
    resolution.state = {
        ...resolution.state,
        players,
        currentTurn: (0, gameUtils_1.getNextTurnPlayerId)(players, actorId, resolution.state.turnOrder),
        turnMessage: returnMessage,
    };
    if (Object.keys(wormholeRunsByPlayer).length > 0) {
        resolution.state.wormholeRunsByPlayer = wormholeRunsByPlayer;
    }
    else {
        delete resolution.state.wormholeRunsByPlayer;
    }
    outcome.position = { ...firstWallOrigin };
    outcome.reachedGoal = false;
    outcome.illusionTransition = 'returned';
    outcome.illusionReturnPosition = { ...firstWallOrigin };
    if (actionStartedInWormhole)
        outcome.illusionReturnFromWormhole = true;
    outcome.realm = 'main';
    outcome.message = returnMessage;
    if (outcome.effect === 'wormhole')
        outcome.effect = 'move';
    delete outcome.wormholeTransition;
    delete outcome.wormholeExit;
    return resolution;
}
function resolveTurnAction(state, actorId, action, now = Date.now()) {
    if (!state || state.phase !== game_1.GamePhase.PLAY || state.currentTurn !== actorId)
        return null;
    const player = state.players?.[actorId];
    const mapOwnerId = state.assignments?.[actorId];
    const playedMap = mapOwnerId ? state.maps?.[mapOwnerId] : null;
    const ownMap = state.maps?.[actorId];
    if (!player || player.finished || player.forfeited || player.hasLeft || !mapOwnerId || !playedMap || !ownMap) {
        return null;
    }
    // Retired detector/skill commands can still appear in legacy receipts and
    // payload types, but movement is now the only legal runtime action.
    if (action.type !== 'move')
        return null;
    const storedFireEffect = state.visionEffectsByPlayer?.[actorId];
    const fireLedger = storedFireEffect?.type === 'fire' ? storedFireEffect : null;
    const playerMovesBeforeAction = player.moves || 0;
    // Keep an inactive fire ledger through equality so the fourth affected
    // action's discovery is removed immediately before the fifth own action.
    // If this attempted action is rejected, the prepared state is never
    // committed and the temporary discovery remains visible as intended.
    const preparedState = fireLedger && playerMovesBeforeAction <= fireLedger.expiresAtTargetMove
        ? forgetWallKnowledgeForPlayer(state, actorId)
        : state;
    const poisonWasActive = !!getActivePoisonEffect(preparedState, actorId);
    const resolvedDirection = poisonDirectionForAction(preparedState, actorId, action.direction);
    let resolved = preparedState.wormholeRunsByPlayer?.[actorId]
        ? resolveWormholeMove(preparedState, actorId, resolvedDirection, playedMap, mapOwnerId, now, poisonWasActive)
        : resolveMove(preparedState, actorId, resolvedDirection, playedMap, mapOwnerId, (0, gameUtils_1.getMapRunnerGear)(ownMap), now, poisonWasActive);
    if (!resolved)
        return null;
    resolved = applyIllusionActionProgress(preparedState, actorId, mapOwnerId, resolved);
    if (resolvedDirection !== action.direction && resolved.outcome.type === 'move') {
        resolved.outcome.requestedDirection = action.direction;
        resolved.outcome.poisonMisdirected = true;
        resolved.outcome.message = `중독으로 ${DIRECTION_LABELS[action.direction]} 입력이 ${DIRECTION_LABELS[resolvedDirection]} 방향으로 뒤틀렸습니다. ${resolved.outcome.message}`;
        resolved.state.turnMessage = resolved.outcome.message;
    }
    const previousEffect = state.visionEffectsByPlayer?.[actorId];
    const nextEffect = resolved.state.visionEffectsByPlayer?.[actorId];
    const sameVisionEffect = previousEffect &&
        nextEffect &&
        nextEffect.type === previousEffect.type &&
        nextEffect.appliedAtTurn === previousEffect.appliedAtTurn;
    const shouldRemoveVisionEffect = sameVisionEffect && (previousEffect.type === 'fire'
        ? playerMovesBeforeAction >= previousEffect.expiresAtTargetMove ||
            !!resolved.state.players[actorId]?.finished ||
            !!resolved.state.players[actorId]?.forfeited ||
            !!resolved.state.players[actorId]?.hasLeft
        : !isTimedEffectActive(resolved.state, actorId, nextEffect));
    if (shouldRemoveVisionEffect) {
        const visionEffectsByPlayer = { ...(resolved.state.visionEffectsByPlayer || {}) };
        delete visionEffectsByPlayer[actorId];
        resolved.state = { ...resolved.state, visionEffectsByPlayer };
    }
    const previousPoison = state.poisonEffectsByPlayer?.[actorId];
    const nextPoison = resolved.state.poisonEffectsByPlayer?.[actorId];
    if (previousPoison &&
        nextPoison &&
        nextPoison.appliedAtTurn === previousPoison.appliedAtTurn &&
        !isTimedEffectActive(resolved.state, actorId, nextPoison)) {
        const poisonEffectsByPlayer = { ...(resolved.state.poisonEffectsByPlayer || {}) };
        delete poisonEffectsByPlayer[actorId];
        resolved.state = { ...resolved.state, poisonEffectsByPlayer };
    }
    // Online turns commit this reducer result directly. Settling here keeps the
    // last goal move and END/winner transition in the same Firebase transaction.
    resolved.state = settleCompletedGameState(resolved.state);
    return resolved;
}
function settleCompletedGameState(state) {
    const participantIds = (state.turnOrder || Object.keys(state.players)).filter((id) => !!state.players[id]);
    const allDone = participantIds.length > 0 && participantIds.every((id) => {
        const player = state.players[id];
        return !!player && (player.finished || player.forfeited || player.hasLeft);
    });
    if (!allDone)
        return state;
    const finishers = participantIds
        .filter((id) => state.players[id]?.finished && !state.players[id]?.forfeited)
        .map((id) => ({ id, moves: state.players[id].finishMoves ?? Number.MAX_SAFE_INTEGER }));
    const minMoves = finishers.length > 0 ? Math.min(...finishers.map((entry) => entry.moves)) : null;
    const winners = minMoves === null ? [] : finishers.filter((entry) => entry.moves === minMoves).map((entry) => entry.id);
    return {
        ...state,
        phase: game_1.GamePhase.END,
        currentTurn: null,
        winner: winners.length === 1 ? winners[0] : null,
        draw: winners.length === 1 ? null : true,
        turnMessage: winners.length === 1 ? `${state.players[winners[0]]?.displayName || '플레이어'} 승리` : '공동 우승',
    };
}
//# sourceMappingURL=gameTurn.js.map