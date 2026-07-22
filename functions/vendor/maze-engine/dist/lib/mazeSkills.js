"use strict";
// GENERATED FILE. Edit the canonical source under src/ and regenerate.
// Source: src/lib/mazeSkills.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAZE_SKILL_DEFINITIONS = exports.MAZE_SKILL_IDS = exports.RANKED_MAZE_SKILL_LOADOUT = exports.MAX_MAZE_SKILL_LOADOUT = exports.DEFAULT_MAZE_BOARD_SIZE = void 0;
exports.isMazeSkillId = isMazeSkillId;
exports.isMazeDirection = isMazeDirection;
exports.normalizeMazeBoardSize = normalizeMazeBoardSize;
exports.isMazePosition = isMazePosition;
exports.isSameMazePosition = isSameMazePosition;
exports.moveMazePosition = moveMazePosition;
exports.mazeWallSegmentKey = mazeWallSegmentKey;
exports.isMazeWallActive = isMazeWallActive;
exports.getBlockingMazeWalls = getBlockingMazeWalls;
exports.findSafeMazePath = findSafeMazePath;
exports.hasSafeMazeGoalPath = hasSafeMazeGoalPath;
exports.normalizeMazeSkillLoadout = normalizeMazeSkillLoadout;
exports.normalizeMazeSkillState = normalizeMazeSkillState;
exports.createMazeSkillState = createMazeSkillState;
exports.consumeMazeSkill = consumeMazeSkill;
exports.getScoutPulseReveals = getScoutPulseReveals;
exports.resolveScoutPulse = resolveScoutPulse;
exports.resolveBreach = resolveBreach;
exports.resolveAnchor = resolveAnchor;
exports.resolveDash = resolveDash;
exports.DEFAULT_MAZE_BOARD_SIZE = 6;
exports.MAX_MAZE_SKILL_LOADOUT = 1;
exports.RANKED_MAZE_SKILL_LOADOUT = 1;
exports.MAZE_SKILL_IDS = ['scoutPulse', 'breach', 'anchor', 'dash'];
exports.MAZE_SKILL_DEFINITIONS = {
    scoutPulse: {
        id: 'scoutPulse',
        label: '정찰 파동',
        description: '현재 위치 3x3 범위의 진짜 벽과 미사용 위장벽을 벽으로 공개합니다.',
        activation: 'active',
        targeting: 'none',
        balance: {
            useLimit: 1,
            turnCost: 1,
            failureConsumesUse: false,
            rankedLoadoutCost: 1,
            targetNetTurnValue: [0, 4],
            safetyRule: '정상적인 보드 내 위치에서만 사용',
        },
    },
    breach: {
        id: 'breach',
        label: '돌파',
        description: '강철벽을 제외한 벽 하나를 통과해 인접 칸으로 이동합니다.',
        activation: 'active',
        targeting: 'direction',
        balance: {
            useLimit: 1,
            turnCost: 1,
            failureConsumesUse: false,
            rankedLoadoutCost: 1,
            targetNetTurnValue: [1, 5],
            safetyRule: '통과 대상이 벽 하나이고 도착 칸에서 목표 경로가 남아야 함',
        },
    },
    anchor: {
        id: 'anchor',
        label: '공간 닻',
        description: '첫 강제 이동을 무효화하고 정상적으로 진입한 칸에 남습니다.',
        activation: 'passive',
        targeting: 'forcedMovement',
        balance: {
            useLimit: 1,
            turnCost: 0,
            failureConsumesUse: false,
            rankedLoadoutCost: 1,
            targetNetTurnValue: [1, 6],
            safetyRule: '지뢰·웜홀·빙결·바람·거울·가시 강제 이동에만 반응',
        },
    },
    dash: {
        id: 'dash',
        label: '질주',
        description: '같은 방향의 열린 두 구간을 지나 2칸을 1턴에 이동합니다.',
        activation: 'active',
        targeting: 'direction',
        balance: {
            useLimit: 1,
            turnCost: 1,
            failureConsumesUse: false,
            rankedLoadoutCost: 1,
            targetNetTurnValue: [0, 1],
            safetyRule: '두 구간이 실제로 열려 있고 두 번째 칸에서 목표 경로가 남아야 함',
        },
    },
};
const DIRECTIONS = ['up', 'right', 'down', 'left'];
const FORCED_MOVEMENT_SOURCES = [
    'mine',
    'wormhole',
    'ice',
    'wind',
    'mirror',
    'thorn',
];
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isMazeSkillId(value) {
    return typeof value === 'string' && exports.MAZE_SKILL_IDS.includes(value);
}
function isMazeDirection(value) {
    return typeof value === 'string' && DIRECTIONS.includes(value);
}
function normalizeMazeBoardSize(value) {
    return Number.isInteger(value) && Number(value) >= 2 && Number(value) <= 64
        ? Number(value)
        : exports.DEFAULT_MAZE_BOARD_SIZE;
}
function isMazePosition(value, boardSize = exports.DEFAULT_MAZE_BOARD_SIZE) {
    if (!isRecord(value))
        return false;
    const size = normalizeMazeBoardSize(boardSize);
    return Number.isInteger(value.row) &&
        Number.isInteger(value.col) &&
        Number(value.row) >= 0 &&
        Number(value.row) < size &&
        Number(value.col) >= 0 &&
        Number(value.col) < size;
}
function isSameMazePosition(a, b) {
    return a.row === b.row && a.col === b.col;
}
function moveMazePosition(position, direction) {
    switch (direction) {
        case 'up':
            return { row: position.row - 1, col: position.col };
        case 'right':
            return { row: position.row, col: position.col + 1 };
        case 'down':
            return { row: position.row + 1, col: position.col };
        case 'left':
            return { row: position.row, col: position.col - 1 };
    }
}
function cellIndex(position, boardSize) {
    return position.row * boardSize + position.col;
}
function positionFromIndex(index, boardSize) {
    return { row: Math.floor(index / boardSize), col: index % boardSize };
}
function mazeWallSegmentKey(position, direction, boardSize = exports.DEFAULT_MAZE_BOARD_SIZE) {
    const size = normalizeMazeBoardSize(boardSize);
    if (!isMazePosition(position, size) || !isMazeDirection(direction))
        return null;
    const target = moveMazePosition(position, direction);
    if (!isMazePosition(target, size))
        return null;
    const endpoints = [cellIndex(position, size), cellIndex(target, size)].sort((a, b) => a - b);
    return `${endpoints[0]}:${endpoints[1]}`;
}
function canonicalWallDescriptor(segmentKey, boardSize) {
    const [firstText, secondText] = segmentKey.split(':');
    const first = positionFromIndex(Number(firstText), boardSize);
    const second = positionFromIndex(Number(secondText), boardSize);
    return {
        position: first,
        direction: second.row === first.row ? 'right' : 'down',
    };
}
function consumedWallSetHas(consumed, id) {
    if (!consumed)
        return false;
    if ('has' in consumed && typeof consumed.has === 'function')
        return consumed.has(id);
    return !!consumed[id];
}
function isMazeWallActive(wall, consumedWallIds, ignoredWallIds) {
    return wall.active !== false &&
        !wall.consumed &&
        !consumedWallSetHas(consumedWallIds, wall.id) &&
        !ignoredWallIds?.has(wall.id);
}
function getBlockingMazeWalls(board, position, direction) {
    const size = normalizeMazeBoardSize(board.boardSize);
    const segmentKey = mazeWallSegmentKey(position, direction, size);
    if (!segmentKey || !Array.isArray(board.walls))
        return [];
    return board.walls.filter((wall) => isMazeWallActive(wall, board.consumedWallIds) &&
        mazeWallSegmentKey(wall.position, wall.direction, size) === segmentKey);
}
function blockedSegmentKeys(walls, boardSize, consumedWallIds, ignoredWallIds) {
    const blocked = new Set();
    for (const wall of walls || []) {
        if (!isMazeWallActive(wall, consumedWallIds, ignoredWallIds))
            continue;
        const key = mazeWallSegmentKey(wall.position, wall.direction, boardSize);
        if (key)
            blocked.add(key);
    }
    return blocked;
}
function findSafeMazePath(start, goal, walls, options = {}) {
    const boardSize = normalizeMazeBoardSize(options.boardSize);
    if (!isMazePosition(start, boardSize) || !isMazePosition(goal, boardSize))
        return null;
    if (isSameMazePosition(start, goal))
        return [{ ...start }];
    const blocked = blockedSegmentKeys(walls, boardSize, options.consumedWallIds, options.ignoredWallIds);
    const totalCells = boardSize * boardSize;
    const previous = new Int32Array(totalCells);
    previous.fill(-1);
    const startIndex = cellIndex(start, boardSize);
    const goalIndex = cellIndex(goal, boardSize);
    previous[startIndex] = startIndex;
    const queue = new Int32Array(totalCells);
    let head = 0;
    let tail = 0;
    queue[tail++] = startIndex;
    while (head < tail) {
        const currentIndex = queue[head++];
        const current = positionFromIndex(currentIndex, boardSize);
        for (const direction of DIRECTIONS) {
            const next = moveMazePosition(current, direction);
            if (!isMazePosition(next, boardSize))
                continue;
            const nextIndex = cellIndex(next, boardSize);
            if (previous[nextIndex] !== -1)
                continue;
            const key = mazeWallSegmentKey(current, direction, boardSize);
            if (!key || blocked.has(key))
                continue;
            previous[nextIndex] = currentIndex;
            if (nextIndex === goalIndex) {
                const reversed = [positionFromIndex(goalIndex, boardSize)];
                let cursor = goalIndex;
                while (cursor !== startIndex) {
                    cursor = previous[cursor];
                    reversed.push(positionFromIndex(cursor, boardSize));
                }
                return reversed.reverse();
            }
            queue[tail++] = nextIndex;
        }
    }
    return null;
}
function hasSafeMazeGoalPath(start, board) {
    return !!findSafeMazePath(start, board.goal, board.walls, {
        boardSize: board.boardSize,
        consumedWallIds: board.consumedWallIds,
    });
}
function normalizeMazeSkillLoadout(value) {
    const source = Array.isArray(value) ? value : isMazeSkillId(value) ? [value] : [];
    const normalized = [];
    for (const candidate of source) {
        if (!isMazeSkillId(candidate) || normalized.includes(candidate))
            continue;
        normalized.push(candidate);
        if (normalized.length >= exports.MAX_MAZE_SKILL_LOADOUT)
            break;
    }
    return normalized;
}
function normalizeMazeSkillState(value) {
    const raw = isRecord(value) ? value : {};
    const rawConsumed = isRecord(raw.consumed) ? raw.consumed : {};
    const consumed = {};
    for (const id of exports.MAZE_SKILL_IDS) {
        if (rawConsumed[id] === true)
            consumed[id] = true;
    }
    return {
        version: 1,
        loadout: normalizeMazeSkillLoadout(raw.loadout),
        consumed,
    };
}
function createMazeSkillState(loadout) {
    return normalizeMazeSkillState({ loadout, consumed: {} });
}
function consumeMazeSkill(value, skillId) {
    const state = normalizeMazeSkillState(value);
    if (!state.loadout.includes(skillId))
        return { ok: false, reason: 'notEquipped', state };
    if (state.consumed[skillId])
        return { ok: false, reason: 'alreadyConsumed', state };
    return {
        ok: true,
        state: {
            ...state,
            consumed: { ...state.consumed, [skillId]: true },
        },
    };
}
function skillFailure(skillId, reason, state) {
    return { ok: false, skillId, reason, turnsSpent: 0, state };
}
function beginSkill(value, skillId) {
    return consumeMazeSkill(value, skillId);
}
function getScoutPulseReveals(input) {
    const boardSize = normalizeMazeBoardSize(input.board.boardSize);
    if (!isMazePosition(input.position, boardSize))
        return [];
    const bySegment = new Map();
    for (const wall of input.board.walls || []) {
        if (!isMazeWallActive(wall, input.board.consumedWallIds))
            continue;
        const key = mazeWallSegmentKey(wall.position, wall.direction, boardSize);
        if (!key)
            continue;
        const descriptor = canonicalWallDescriptor(key, boardSize);
        const target = moveMazePosition(descriptor.position, descriptor.direction);
        const touchesPulse = [descriptor.position, target].some((position) => Math.abs(position.row - input.position.row) <= 1 &&
            Math.abs(position.col - input.position.col) <= 1);
        if (!touchesPulse)
            continue;
        const existing = bySegment.get(key);
        if (existing) {
            if (!existing.sourceWallIds.includes(wall.id))
                existing.sourceWallIds.push(wall.id);
        }
        else {
            bySegment.set(key, {
                segmentKey: key,
                position: descriptor.position,
                direction: descriptor.direction,
                apparentKind: 'wall',
                sourceWallIds: [wall.id],
            });
        }
    }
    return [...bySegment.values()].sort((a, b) => a.segmentKey.localeCompare(b.segmentKey));
}
function resolveScoutPulse(value, input) {
    const state = normalizeMazeSkillState(value);
    const boardSize = normalizeMazeBoardSize(input.board.boardSize);
    if (!isMazePosition(input.position, boardSize)) {
        return skillFailure('scoutPulse', 'invalidOrigin', state);
    }
    const consumption = beginSkill(state, 'scoutPulse');
    if (!consumption.ok) {
        return skillFailure('scoutPulse', consumption.reason, consumption.state);
    }
    return {
        ok: true,
        skillId: 'scoutPulse',
        turnsSpent: 1,
        state: consumption.state,
        reveals: getScoutPulseReveals(input),
    };
}
function distinctBlockingKinds(walls) {
    return [...new Set(walls.map((wall) => wall.kind))];
}
function resolveBreach(value, input) {
    const state = normalizeMazeSkillState(value);
    const boardSize = normalizeMazeBoardSize(input.board.boardSize);
    if (!isMazePosition(input.position, boardSize)) {
        return skillFailure('breach', 'invalidOrigin', state);
    }
    if (!isMazeDirection(input.direction)) {
        return skillFailure('breach', 'invalidDirection', state);
    }
    const target = moveMazePosition(input.position, input.direction);
    if (!isMazePosition(target, boardSize)) {
        return skillFailure('breach', 'outOfBounds', state);
    }
    const blockingWalls = getBlockingMazeWalls(input.board, input.position, input.direction);
    if (blockingWalls.length === 0)
        return skillFailure('breach', 'noWall', state);
    const kinds = distinctBlockingKinds(blockingWalls);
    if (kinds.includes('steelWall'))
        return skillFailure('breach', 'steelWall', state);
    if (kinds.length !== 1)
        return skillFailure('breach', 'multipleWalls', state);
    if (!hasSafeMazeGoalPath(target, input.board)) {
        return skillFailure('breach', 'unsafeGoalPath', state);
    }
    const consumption = beginSkill(state, 'breach');
    if (!consumption.ok)
        return skillFailure('breach', consumption.reason, consumption.state);
    return {
        ok: true,
        skillId: 'breach',
        turnsSpent: 1,
        state: consumption.state,
        origin: { ...input.position },
        position: target,
        direction: input.direction,
        wallKind: kinds[0],
        bypassedWallIds: blockingWalls.map((wall) => wall.id),
    };
}
function resolveAnchor(value, input) {
    const state = normalizeMazeSkillState(value);
    const boardSize = normalizeMazeBoardSize(input.boardSize);
    if (!FORCED_MOVEMENT_SOURCES.includes(input.source)) {
        return skillFailure('anchor', 'unsupportedForcedMovement', state);
    }
    if (!isMazePosition(input.from, boardSize) || !isMazePosition(input.entered, boardSize)) {
        return skillFailure('anchor', 'invalidEntry', state);
    }
    const entryDistance = Math.abs(input.from.row - input.entered.row) +
        Math.abs(input.from.col - input.entered.col);
    if (entryDistance !== 1)
        return skillFailure('anchor', 'invalidEntry', state);
    const consumption = beginSkill(state, 'anchor');
    if (!consumption.ok)
        return skillFailure('anchor', consumption.reason, consumption.state);
    return {
        ok: true,
        skillId: 'anchor',
        turnsSpent: 0,
        state: consumption.state,
        position: { ...input.entered },
        negatedSource: input.source,
        discardedDestination: isMazePosition(input.forcedDestination, boardSize)
            ? { ...input.forcedDestination }
            : undefined,
        consumeSourceEffect: true,
    };
}
function resolveDash(value, input) {
    const state = normalizeMazeSkillState(value);
    const boardSize = normalizeMazeBoardSize(input.board.boardSize);
    if (!isMazePosition(input.position, boardSize)) {
        return skillFailure('dash', 'invalidOrigin', state);
    }
    if (!isMazeDirection(input.direction)) {
        return skillFailure('dash', 'invalidDirection', state);
    }
    const first = moveMazePosition(input.position, input.direction);
    if (!isMazePosition(first, boardSize)) {
        return skillFailure('dash', 'outOfBounds', state);
    }
    if (getBlockingMazeWalls(input.board, input.position, input.direction).length > 0) {
        return skillFailure('dash', 'blockedSegment', state);
    }
    const stopAtFirst = input.stopAtFirst || isSameMazePosition(first, input.board.goal);
    if (stopAtFirst && !hasSafeMazeGoalPath(first, input.board)) {
        return skillFailure('dash', 'unsafeGoalPath', state);
    }
    const second = moveMazePosition(first, input.direction);
    if (!stopAtFirst) {
        if (!isMazePosition(second, boardSize))
            return skillFailure('dash', 'outOfBounds', state);
        if (getBlockingMazeWalls(input.board, first, input.direction).length > 0) {
            return skillFailure('dash', 'blockedSegment', state);
        }
        if (!hasSafeMazeGoalPath(second, input.board)) {
            return skillFailure('dash', 'unsafeGoalPath', state);
        }
    }
    const consumption = beginSkill(state, 'dash');
    if (!consumption.ok)
        return skillFailure('dash', consumption.reason, consumption.state);
    return {
        ok: true,
        skillId: 'dash',
        turnsSpent: 1,
        state: consumption.state,
        origin: { ...input.position },
        position: stopAtFirst ? first : second,
        direction: input.direction,
        via: stopAtFirst ? [first] : [first, second],
    };
}
//# sourceMappingURL=mazeSkills.js.map