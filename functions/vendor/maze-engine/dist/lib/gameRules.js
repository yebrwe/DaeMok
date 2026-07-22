"use strict";
// GENERATED FILE. Edit the canonical source under src/ and regenerate.
// Source: src/lib/gameRules.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.gameRuleSnapshotsEqual = exports.createGameRuleSnapshot = void 0;
exports.createCanonicalGameRuleSnapshot = createCanonicalGameRuleSnapshot;
exports.validateGameRuleSnapshot = validateGameRuleSnapshot;
exports.isValidGameRuleSnapshot = isValidGameRuleSnapshot;
exports.areGameRuleSnapshotsEqual = areGameRuleSnapshotsEqual;
exports.isValidMapForRuleSnapshot = isValidMapForRuleSnapshot;
exports.isValidNewMapForRuleSnapshot = isValidNewMapForRuleSnapshot;
exports.normalizeNewMapForRuleSnapshot = normalizeNewMapForRuleSnapshot;
const gameUtils_1 = require("./gameUtils");
const mazeSkills_1 = require("./mazeSkills");
const SNAPSHOT_KEYS = [
    'version',
    'wallBudget',
    'runnerGearWallBudget',
    'itemCosts',
    'itemLimits',
    'maxSkillLoadout',
    'skillIds',
];
const CANONICAL_ITEM_TYPES = Object.keys(gameUtils_1.ITEM_COSTS);
const CANONICAL_RULE_TEMPLATE = {
    version: gameUtils_1.GAME_RULES_VERSION,
    wallBudget: gameUtils_1.MAX_OBSTACLES,
    runnerGearWallBudget: gameUtils_1.RUNNER_GEAR_WALL_BUDGET,
    itemCosts: { ...gameUtils_1.ITEM_COSTS },
    itemLimits: { ...gameUtils_1.ITEM_LIMITS },
    maxSkillLoadout: mazeSkills_1.MAX_MAZE_SKILL_LOADOUT,
    skillIds: [...gameUtils_1.MAZE_SKILL_IDS],
};
Object.freeze(CANONICAL_RULE_TEMPLATE.itemCosts);
Object.freeze(CANONICAL_RULE_TEMPLATE.itemLimits);
Object.freeze(CANONICAL_RULE_TEMPLATE.skillIds);
Object.freeze(CANONICAL_RULE_TEMPLATE);
function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function hasExactKeys(record, expected) {
    const keys = Reflect.ownKeys(record);
    return keys.length === expected.length &&
        expected.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}
function validateNumberRecord(value, canonical, label, issues) {
    if (!isPlainRecord(value)) {
        issues.push(`${label}:record`);
        return false;
    }
    if (!hasExactKeys(value, CANONICAL_ITEM_TYPES)) {
        issues.push(`${label}:keys`);
        return false;
    }
    let valid = true;
    for (const itemType of CANONICAL_ITEM_TYPES) {
        if (!Object.is(value[itemType], canonical[itemType])) {
            issues.push(`${label}:${itemType}`);
            valid = false;
        }
    }
    return valid;
}
function validateSkillIds(value, issues) {
    if (!Array.isArray(value)) {
        issues.push('skillIds:array');
        return false;
    }
    if (value.length !== CANONICAL_RULE_TEMPLATE.skillIds.length) {
        issues.push('skillIds:length');
        return false;
    }
    const arrayKeys = Reflect.ownKeys(value);
    const expectedArrayKeys = new Set([
        'length',
        ...Array.from({ length: value.length }, (_, index) => String(index)),
    ]);
    if (arrayKeys.length !== value.length + 1 ||
        !arrayKeys.every((key) => typeof key === 'string' && expectedArrayKeys.has(key)) ||
        !Array.from({ length: value.length }, (_, index) => index).every((index) => Object.prototype.hasOwnProperty.call(value, index)) ||
        value.some((skillId, index) => skillId !== CANONICAL_RULE_TEMPLATE.skillIds[index])) {
        issues.push('skillIds:order');
        return false;
    }
    if (new Set(value).size !== value.length) {
        issues.push('skillIds:duplicate');
        return false;
    }
    return true;
}
function createCanonicalGameRuleSnapshot() {
    return {
        version: CANONICAL_RULE_TEMPLATE.version,
        wallBudget: CANONICAL_RULE_TEMPLATE.wallBudget,
        runnerGearWallBudget: CANONICAL_RULE_TEMPLATE.runnerGearWallBudget,
        itemCosts: { ...CANONICAL_RULE_TEMPLATE.itemCosts },
        itemLimits: { ...CANONICAL_RULE_TEMPLATE.itemLimits },
        maxSkillLoadout: CANONICAL_RULE_TEMPLATE.maxSkillLoadout,
        skillIds: [...CANONICAL_RULE_TEMPLATE.skillIds],
    };
}
exports.createGameRuleSnapshot = createCanonicalGameRuleSnapshot;
function validateGameRuleSnapshot(value) {
    const issues = [];
    if (!isPlainRecord(value))
        return { valid: false, issues: ['snapshot:record'] };
    if (!hasExactKeys(value, SNAPSHOT_KEYS))
        issues.push('snapshot:keys');
    if (!Object.is(value.version, CANONICAL_RULE_TEMPLATE.version))
        issues.push('version');
    if (!Object.is(value.wallBudget, CANONICAL_RULE_TEMPLATE.wallBudget))
        issues.push('wallBudget');
    if (!Object.is(value.runnerGearWallBudget, CANONICAL_RULE_TEMPLATE.runnerGearWallBudget))
        issues.push('runnerGearWallBudget');
    if (!Object.is(value.maxSkillLoadout, CANONICAL_RULE_TEMPLATE.maxSkillLoadout)) {
        issues.push('maxSkillLoadout');
    }
    validateNumberRecord(value.itemCosts, CANONICAL_RULE_TEMPLATE.itemCosts, 'itemCosts', issues);
    validateNumberRecord(value.itemLimits, CANONICAL_RULE_TEMPLATE.itemLimits, 'itemLimits', issues);
    validateSkillIds(value.skillIds, issues);
    return { valid: issues.length === 0, issues };
}
function isValidGameRuleSnapshot(value) {
    return validateGameRuleSnapshot(value).valid;
}
function areGameRuleSnapshotsEqual(left, right) {
    if (!isValidGameRuleSnapshot(left) || !isValidGameRuleSnapshot(right))
        return false;
    if (left.version !== right.version ||
        left.wallBudget !== right.wallBudget ||
        left.runnerGearWallBudget !== right.runnerGearWallBudget ||
        left.maxSkillLoadout !== right.maxSkillLoadout ||
        left.skillIds.length !== right.skillIds.length) {
        return false;
    }
    for (let index = 0; index < left.skillIds.length; index += 1) {
        if (left.skillIds[index] !== right.skillIds[index])
            return false;
    }
    return CANONICAL_ITEM_TYPES.every((itemType) => left.itemCosts[itemType] === right.itemCosts[itemType] &&
        left.itemLimits[itemType] === right.itemLimits[itemType]);
}
exports.gameRuleSnapshotsEqual = areGameRuleSnapshotsEqual;
function countUniqueWalls(obstacles) {
    const unique = [];
    for (const obstacle of obstacles) {
        if (!unique.some((existing) => (0, gameUtils_1.isSameWallSegment)(existing.position, existing.direction, obstacle.position, obstacle.direction))) {
            unique.push(obstacle);
        }
    }
    return unique.length;
}
function isValidMapForRuleSnapshot(map, snapshot) {
    if (!isValidGameRuleSnapshot(snapshot) || !map || typeof map !== 'object')
        return false;
    if (map.rulesVersion !== snapshot.version)
        return false;
    if (typeof map.skillLoadout !== 'string' || !snapshot.skillIds.includes(map.skillLoadout)) {
        return false;
    }
    if (snapshot.maxSkillLoadout !== 1)
        return false;
    if (!(0, gameUtils_1.isValidMap)(map, snapshot.version))
        return false;
    const itemCounts = {};
    let itemCost = 0;
    for (const item of (0, gameUtils_1.getMapItems)(map)) {
        if (!Object.prototype.hasOwnProperty.call(snapshot.itemCosts, item.type) ||
            !Object.prototype.hasOwnProperty.call(snapshot.itemLimits, item.type)) {
            return false;
        }
        itemCounts[item.type] = (itemCounts[item.type] || 0) + 1;
        if (itemCounts[item.type] > snapshot.itemLimits[item.type])
            return false;
        itemCost += snapshot.itemCosts[item.type];
    }
    const wallBudget = (0, gameUtils_1.getMapRunnerGear)(map) === 'none'
        ? snapshot.wallBudget
        : snapshot.runnerGearWallBudget;
    return countUniqueWalls(map.obstacles || []) + itemCost <= wallBudget;
}
/**
 * Validation used only when a map is about to be saved or submitted. The
 * compatibility validator above continues accepting old V3 radar/skill maps
 * for read-only rendering and in-flight legacy matches.
 */
function isValidNewMapForRuleSnapshot(map, snapshot) {
    if (!isValidGameRuleSnapshot(snapshot) || !map)
        return false;
    return (0, gameUtils_1.isValidNewMap)(map, snapshot.version)
        && isValidMapForRuleSnapshot(map, snapshot);
}
/** Normalizes the retired skill field, then applies the strict write boundary. */
function normalizeNewMapForRuleSnapshot(map, snapshot) {
    if (!map || !isValidMapForRuleSnapshot(map, snapshot))
        return null;
    const normalized = (0, gameUtils_1.normalizeNewMapForSubmission)(map);
    return isValidNewMapForRuleSnapshot(normalized, snapshot) ? normalized : null;
}
//# sourceMappingURL=gameRules.js.map