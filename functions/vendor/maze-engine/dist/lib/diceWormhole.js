"use strict";
// GENERATED FILE. Edit the canonical source under src/ and regenerate.
// Source: src/lib/diceWormhole.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.DICE_WORMHOLE_FALLBACK_CHALLENGE = exports.DICE_ORIENTATION_TRANSITIONS = exports.DICE_ORIENTATIONS = exports.DICE_WORMHOLE_DIRECTIONS = exports.DICE_ORIENTATION_COUNT = exports.DICE_WORMHOLE_COMPAT_MAX_BLOCKED_CELLS = exports.DICE_WORMHOLE_COMPAT_MIN_BLOCKED_CELLS = exports.DICE_WORMHOLE_MAX_STEPS = exports.DICE_WORMHOLE_MIN_STEPS = exports.DICE_WORMHOLE_MAX_BLOCKED_CELLS = exports.DICE_WORMHOLE_MIN_BLOCKED_CELLS = exports.DICE_WORMHOLE_BOARD_SIZE = void 0;
exports.isDiceOrientationId = isDiceOrientationId;
exports.getDiceOrientationFaces = getDiceOrientationFaces;
exports.rollDiceOrientation = rollDiceOrientation;
exports.isDiceWormholePosition = isDiceWormholePosition;
exports.getDiceWormholeShortestPath = getDiceWormholeShortestPath;
exports.getDiceWormholeShortestSteps = getDiceWormholeShortestSteps;
exports.getDiceWormholeChallengeError = getDiceWormholeChallengeError;
exports.isValidDiceWormholeChallenge = isValidDiceWormholeChallenge;
exports.getNewDiceWormholeChallengeError = getNewDiceWormholeChallengeError;
exports.isValidNewDiceWormholeChallenge = isValidNewDiceWormholeChallenge;
exports.generateDiceWormholeChallenge = generateDiceWormholeChallenge;
exports.DICE_WORMHOLE_BOARD_SIZE = 4;
// V5 authored rooms are deliberately denser and require a substantially
// longer orientation-aware route than the original V4 dice rooms.
exports.DICE_WORMHOLE_MIN_BLOCKED_CELLS = 2;
exports.DICE_WORMHOLE_MAX_BLOCKED_CELLS = 4;
exports.DICE_WORMHOLE_MIN_STEPS = 9;
exports.DICE_WORMHOLE_MAX_STEPS = 12;
// V5 runtime readers still accept retained V4-difficulty challenge payloads.
// The hard V5 boundary is applied separately to every newly submitted map.
exports.DICE_WORMHOLE_COMPAT_MIN_BLOCKED_CELLS = 1;
exports.DICE_WORMHOLE_COMPAT_MAX_BLOCKED_CELLS = 4;
const DICE_WORMHOLE_LEGACY_MAX_BLOCKED_CELLS = 3;
const DICE_WORMHOLE_LEGACY_MIN_STEPS = 6;
const DICE_WORMHOLE_LEGACY_MAX_STEPS = 8;
exports.DICE_ORIENTATION_COUNT = 24;
exports.DICE_WORMHOLE_DIRECTIONS = [
    'up',
    'right',
    'down',
    'left',
];
const BASE_ORIENTATION = {
    top: 1,
    bottom: 6,
    north: 2,
    south: 5,
    east: 3,
    west: 4,
};
function rollFaces(faces, direction) {
    switch (direction) {
        case 'up':
            return {
                top: faces.south,
                bottom: faces.north,
                north: faces.top,
                south: faces.bottom,
                east: faces.east,
                west: faces.west,
            };
        case 'right':
            return {
                top: faces.west,
                bottom: faces.east,
                north: faces.north,
                south: faces.south,
                east: faces.top,
                west: faces.bottom,
            };
        case 'down':
            return {
                top: faces.north,
                bottom: faces.south,
                north: faces.bottom,
                south: faces.top,
                east: faces.east,
                west: faces.west,
            };
        case 'left':
            return {
                top: faces.east,
                bottom: faces.west,
                north: faces.north,
                south: faces.south,
                east: faces.bottom,
                west: faces.top,
            };
    }
}
function orientationKey(faces) {
    return [
        faces.top,
        faces.bottom,
        faces.north,
        faces.south,
        faces.east,
        faces.west,
    ].join(',');
}
function buildOrientationContract() {
    // The base orientation and direction order are persisted V2 wire semantics.
    // Do not reorder them without introducing another challenge version.
    const orientations = [{ ...BASE_ORIENTATION }];
    const indices = new Map([[orientationKey(BASE_ORIENTATION), 0]]);
    for (let cursor = 0; cursor < orientations.length; cursor += 1) {
        for (const direction of exports.DICE_WORMHOLE_DIRECTIONS) {
            const next = rollFaces(orientations[cursor], direction);
            const key = orientationKey(next);
            if (indices.has(key))
                continue;
            indices.set(key, orientations.length);
            orientations.push(next);
        }
    }
    if (orientations.length !== exports.DICE_ORIENTATION_COUNT) {
        throw new Error(`주사위 방향 표가 ${exports.DICE_ORIENTATION_COUNT}개가 아닙니다.`);
    }
    const frozenOrientations = orientations.map((faces) => Object.freeze({ ...faces }));
    const transitions = frozenOrientations.map((faces) => Object.freeze(Object.fromEntries(exports.DICE_WORMHOLE_DIRECTIONS.map((direction) => {
        const nextIndex = indices.get(orientationKey(rollFaces(faces, direction)));
        if (nextIndex === undefined)
            throw new Error('주사위 방향 전이를 만들 수 없습니다.');
        return [direction, nextIndex];
    }))));
    return {
        orientations: Object.freeze(frozenOrientations),
        transitions: Object.freeze(transitions),
    };
}
const ORIENTATION_CONTRACT = buildOrientationContract();
exports.DICE_ORIENTATIONS = ORIENTATION_CONTRACT.orientations;
exports.DICE_ORIENTATION_TRANSITIONS = ORIENTATION_CONTRACT.transitions;
function isDiceOrientationId(value) {
    return Number.isInteger(value) && Number(value) >= 0 && Number(value) < exports.DICE_ORIENTATION_COUNT;
}
function getDiceOrientationFaces(orientation) {
    if (!isDiceOrientationId(orientation))
        throw new RangeError('주사위 방향 값은 0~23이어야 합니다.');
    return exports.DICE_ORIENTATIONS[orientation];
}
function rollDiceOrientation(orientation, direction) {
    if (!isDiceOrientationId(orientation))
        throw new RangeError('주사위 방향 값은 0~23이어야 합니다.');
    return exports.DICE_ORIENTATION_TRANSITIONS[orientation][direction];
}
function isDiceWormholePosition(value) {
    if (!isPlainRecord(value))
        return false;
    return hasExactKeys(value, ['row', 'col'])
        && Number.isInteger(value.row)
        && Number.isInteger(value.col)
        && Number(value.row) >= 0
        && Number(value.row) < exports.DICE_WORMHOLE_BOARD_SIZE
        && Number(value.col) >= 0
        && Number(value.col) < exports.DICE_WORMHOLE_BOARD_SIZE;
}
function isPlainRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function hasExactKeys(value, expected) {
    const keys = Object.keys(value).sort();
    return keys.length === expected.length
        && [...expected].sort().every((key, index) => keys[index] === key);
}
function isDensePositionArray(value, minimum, maximum) {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
        return false;
    for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index) || !isDiceWormholePosition(value[index])) {
            return false;
        }
    }
    return true;
}
function positionKey(position) {
    return `${position.row},${position.col}`;
}
function samePosition(left, right) {
    return left.row === right.row && left.col === right.col;
}
function getDiceChallengeShapeError(value) {
    if (!isPlainRecord(value))
        return '주사위 웜홀 정보가 없습니다.';
    if (!hasExactKeys(value, [
        'version',
        'boardSize',
        'startPosition',
        'endPosition',
        'blockedCells',
        'initialOrientation',
        'targetTop',
    ]))
        return '주사위 웜홀 형식이 올바르지 않습니다.';
    if (value.version !== 2 || value.boardSize !== exports.DICE_WORMHOLE_BOARD_SIZE) {
        return '지원하지 않는 주사위 웜홀 버전 또는 크기입니다.';
    }
    if (!isDiceWormholePosition(value.startPosition) || !isDiceWormholePosition(value.endPosition)) {
        return '주사위 웜홀 시작점과 출구는 4×4 보드 안에 있어야 합니다.';
    }
    if (samePosition(value.startPosition, value.endPosition)) {
        return '주사위 웜홀 시작점과 출구는 서로 달라야 합니다.';
    }
    if (!isDensePositionArray(value.blockedCells, exports.DICE_WORMHOLE_COMPAT_MIN_BLOCKED_CELLS, exports.DICE_WORMHOLE_COMPAT_MAX_BLOCKED_CELLS)) {
        return `주사위 웜홀 장애물은 ${exports.DICE_WORMHOLE_COMPAT_MIN_BLOCKED_CELLS}~${exports.DICE_WORMHOLE_COMPAT_MAX_BLOCKED_CELLS}개여야 합니다.`;
    }
    const blockedCells = value.blockedCells;
    if (new Set(blockedCells.map(positionKey)).size !== blockedCells.length) {
        return '주사위 웜홀 장애물 칸을 중복할 수 없습니다.';
    }
    if (blockedCells.some((position) => (samePosition(position, value.startPosition)
        || samePosition(position, value.endPosition))))
        return '주사위 웜홀 시작점이나 출구를 장애물로 막을 수 없습니다.';
    if (!isDiceOrientationId(value.initialOrientation)) {
        return '주사위 웜홀의 최초 방향은 0~23이어야 합니다.';
    }
    if (!Number.isInteger(value.targetTop) || Number(value.targetTop) < 1 || Number(value.targetTop) > 6) {
        return '주사위 웜홀의 목표 윗면은 1~6이어야 합니다.';
    }
    return null;
}
function movePosition(position, direction) {
    switch (direction) {
        case 'up': return { row: position.row - 1, col: position.col };
        case 'right': return { row: position.row, col: position.col + 1 };
        case 'down': return { row: position.row + 1, col: position.col };
        case 'left': return { row: position.row, col: position.col - 1 };
    }
}
function searchStateKey(position, orientation) {
    return `${position.row},${position.col}:${orientation}`;
}
function getDiceWormholeShortestPath(challenge, progress = {
    position: challenge.startPosition,
    orientation: challenge.initialOrientation,
}) {
    if (getDiceChallengeShapeError(challenge) !== null
        || !isDiceWormholePosition(progress.position)
        || !isDiceOrientationId(progress.orientation))
        return null;
    const blocked = new Set(challenge.blockedCells.map(positionKey));
    if (blocked.has(positionKey(progress.position)))
        return null;
    const startKey = searchStateKey(progress.position, progress.orientation);
    const queue = [{
            position: { ...progress.position },
            orientation: progress.orientation,
            path: [],
        }];
    const visited = new Set([startKey]);
    while (queue.length > 0) {
        const current = queue.shift();
        if (samePosition(current.position, challenge.endPosition)
            && getDiceOrientationFaces(current.orientation).top === challenge.targetTop) {
            return current.path;
        }
        for (const direction of exports.DICE_WORMHOLE_DIRECTIONS) {
            const position = movePosition(current.position, direction);
            if (!isDiceWormholePosition(position) || blocked.has(positionKey(position)))
                continue;
            const orientation = rollDiceOrientation(current.orientation, direction);
            const key = searchStateKey(position, orientation);
            if (visited.has(key))
                continue;
            visited.add(key);
            queue.push({ position, orientation, path: [...current.path, direction] });
        }
    }
    return null;
}
function getDiceWormholeShortestSteps(challenge, progress) {
    const path = getDiceWormholeShortestPath(challenge, progress);
    return path ? path.length : null;
}
function getDiceWormholeChallengeError(value) {
    const shapeError = getDiceChallengeShapeError(value);
    if (shapeError)
        return shapeError;
    const challenge = value;
    const steps = getDiceWormholeShortestSteps(challenge);
    if (steps === null)
        return '목표 눈으로 주사위 웜홀 출구에 도달할 수 있어야 합니다.';
    const blockedCount = challenge.blockedCells.length;
    const isLegacyDifficulty = blockedCount <= DICE_WORMHOLE_LEGACY_MAX_BLOCKED_CELLS &&
        steps >= DICE_WORMHOLE_LEGACY_MIN_STEPS &&
        steps <= DICE_WORMHOLE_LEGACY_MAX_STEPS;
    const isCurrentDifficulty = blockedCount >= exports.DICE_WORMHOLE_MIN_BLOCKED_CELLS &&
        blockedCount <= exports.DICE_WORMHOLE_MAX_BLOCKED_CELLS &&
        steps >= exports.DICE_WORMHOLE_MIN_STEPS &&
        steps <= exports.DICE_WORMHOLE_MAX_STEPS;
    if (!isLegacyDifficulty && !isCurrentDifficulty) {
        return '주사위 웜홀 난이도가 지원 범위를 벗어났습니다.';
    }
    return null;
}
function isValidDiceWormholeChallenge(value) {
    return getDiceWormholeChallengeError(value) === null;
}
function getNewDiceWormholeChallengeError(value) {
    const shapeError = getDiceChallengeShapeError(value);
    if (shapeError)
        return shapeError;
    const challenge = value;
    if (challenge.blockedCells.length < exports.DICE_WORMHOLE_MIN_BLOCKED_CELLS ||
        challenge.blockedCells.length > exports.DICE_WORMHOLE_MAX_BLOCKED_CELLS) {
        return `새 주사위 웜홀 장애물은 ${exports.DICE_WORMHOLE_MIN_BLOCKED_CELLS}~${exports.DICE_WORMHOLE_MAX_BLOCKED_CELLS}개여야 합니다.`;
    }
    const steps = getDiceWormholeShortestSteps(challenge);
    if (steps === null)
        return '목표 눈으로 주사위 웜홀 출구에 도달할 수 있어야 합니다.';
    if (steps < exports.DICE_WORMHOLE_MIN_STEPS || steps > exports.DICE_WORMHOLE_MAX_STEPS) {
        return `새 주사위 웜홀 최단 동선은 ${exports.DICE_WORMHOLE_MIN_STEPS}~${exports.DICE_WORMHOLE_MAX_STEPS}행동이어야 합니다.`;
    }
    return null;
}
function isValidNewDiceWormholeChallenge(value) {
    return getNewDiceWormholeChallengeError(value) === null;
}
function clonePosition(position) {
    return { row: position.row, col: position.col };
}
function cloneDiceChallenge(challenge) {
    return {
        version: 2,
        boardSize: exports.DICE_WORMHOLE_BOARD_SIZE,
        startPosition: clonePosition(challenge.startPosition),
        endPosition: clonePosition(challenge.endPosition),
        blockedCells: challenge.blockedCells.map(clonePosition),
        initialOrientation: challenge.initialOrientation,
        targetTop: challenge.targetTop,
    };
}
exports.DICE_WORMHOLE_FALLBACK_CHALLENGE = Object.freeze({
    version: 2,
    boardSize: exports.DICE_WORMHOLE_BOARD_SIZE,
    startPosition: Object.freeze({ row: 0, col: 3 }),
    endPosition: Object.freeze({ row: 3, col: 0 }),
    blockedCells: Object.freeze([
        Object.freeze({ row: 0, col: 1 }),
        Object.freeze({ row: 2, col: 1 }),
        Object.freeze({ row: 2, col: 3 }),
    ]),
    initialOrientation: 19,
    targetTop: 1,
});
function createSeededRandom(seed) {
    let state = ((Number.isFinite(seed) ? Math.trunc(seed) : 0) >>> 0) ^ 0x9E37_79B9;
    return () => {
        state = (state + 0x6D2B_79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return (value ^ (value >>> 14)) >>> 0;
    };
}
function shuffledCells(random) {
    const cells = Array.from({ length: exports.DICE_WORMHOLE_BOARD_SIZE * exports.DICE_WORMHOLE_BOARD_SIZE }, (_, index) => ({
        row: Math.floor(index / exports.DICE_WORMHOLE_BOARD_SIZE),
        col: index % exports.DICE_WORMHOLE_BOARD_SIZE,
    }));
    for (let index = cells.length - 1; index > 0; index -= 1) {
        const swapIndex = random() % (index + 1);
        [cells[index], cells[swapIndex]] = [cells[swapIndex], cells[index]];
    }
    return cells;
}
function generateDiceWormholeChallenge(seed) {
    const random = createSeededRandom(seed);
    for (let attempt = 0; attempt < 512; attempt += 1) {
        const cells = shuffledCells(random);
        const blockedCount = exports.DICE_WORMHOLE_MIN_BLOCKED_CELLS
            + random() % (exports.DICE_WORMHOLE_MAX_BLOCKED_CELLS - exports.DICE_WORMHOLE_MIN_BLOCKED_CELLS + 1);
        const blockedCells = cells.slice(2, 2 + blockedCount).sort((left, right) => left.row - right.row || left.col - right.col);
        const candidate = {
            version: 2,
            boardSize: exports.DICE_WORMHOLE_BOARD_SIZE,
            startPosition: clonePosition(cells[0]),
            endPosition: clonePosition(cells[1]),
            blockedCells: blockedCells.map(clonePosition),
            initialOrientation: random() % exports.DICE_ORIENTATION_COUNT,
            targetTop: (1 + random() % 6),
        };
        if (isValidNewDiceWormholeChallenge(candidate))
            return candidate;
    }
    return cloneDiceChallenge(exports.DICE_WORMHOLE_FALLBACK_CHALLENGE);
}
//# sourceMappingURL=diceWormhole.js.map