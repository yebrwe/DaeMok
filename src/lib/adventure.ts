export type RNG = () => number;

export const ADVENTURE_SAVE_VERSION = 1;
export const MAX_LEVEL = 99;
export const MAX_MASTERY_LEVEL = 50;
export const MAX_SKILL_RANK = 10;
export const MAX_ENHANCE = 10;
export const MAX_ITEM_SOCKETS = 4;
export const MAX_RUNE_STACK = 999;
export const INVENTORY_LIMIT = 60;
export const MAX_LOG_ENTRIES = 80;
export const MAX_OFFLINE_HOURS = 8;
export const BOSS_KILLS_REQUIRED = 8;
export const EXPEDITION_WAVES = 5;

export type CharacterClassId = 'vanguard' | 'ranger' | 'mystic';
export type CoreStatId = 'strength' | 'vitality' | 'defense' | 'agility';
export const SKILL_SLOTS = ['skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'skill6'] as const;
export type SkillSlot = (typeof SKILL_SLOTS)[number];
export const SKILL_LOADOUT_SIZE = 6;
export type EquipmentSlot = 'weapon' | 'armor' | 'accessory';
export type EquipmentRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type ItemTier = 'normal' | 'magic' | 'rare' | 'set' | 'unique';
export type AdventureElement = 'physical' | 'fire' | 'cold' | 'lightning' | 'poison' | 'arcane';
export type RegionId = 'sunnyField' | 'mistForest' | 'ancientRuins' | 'dragonCrater';
export type CombatAction = 'attack' | SkillSlot | 'guard' | 'potion' | 'flee';
export type CombatOutcome = 'ongoing' | 'victory' | 'defeat' | 'fled';
export type AdventureLogType = 'system' | 'combat' | 'reward' | 'growth' | 'quest';
export type EncounterMode = 'duel' | 'expedition';
export type EnemyRank = 'normal' | 'elite' | 'boss';
export type EliteAffix = 'berserker' | 'ironclad' | 'vampiric';
export type ArenaSkillKind = 'melee' | 'projectile' | 'area' | 'dash';

export type AdventureSpecialEffect =
  | {
      id: string;
      name: string;
      kind: 'onHit';
      chance: number;
      damageMultiplier: number;
      element: AdventureElement;
      chainTargets?: number;
      lifeStealPercent?: number;
    }
  | {
      id: string;
      name: string;
      kind: 'onKill';
      chance: number;
      healPercent?: number;
      explosionDamageMultiplier?: number;
      cooldownReductionSeconds?: number;
      element?: AdventureElement;
    }
  | {
      id: string;
      name: string;
      kind: 'onCast';
      chance: number;
      skill?: SkillSlot;
      echoDamageMultiplier?: number;
      cooldownRefundSeconds?: number;
    }
  | {
      id: string;
      name: string;
      kind: 'lowLife';
      threshold: number;
      damageMultiplier: number;
      damageTakenMultiplier: number;
      lifeOnHit?: number;
    }
  | {
      id: string;
      name: string;
      kind: 'projectile';
      additionalProjectiles: number;
      pierce: number;
      speedMultiplier: number;
      damageMultiplier: number;
    }
  | {
      id: string;
      name: string;
      kind: 'elemental';
      element: Exclude<AdventureElement, 'physical'>;
      damageMultiplier: number;
      penetration: number;
    }
  | {
      id: string;
      name: string;
      kind: 'skillModifier';
      skill: SkillSlot;
      damageMultiplier: number;
      cooldownMultiplier: number;
      rangeMultiplier: number;
    };

export type AdventureSpecialEffectList = readonly [AdventureSpecialEffect, ...AdventureSpecialEffect[]];

export const ELITE_AFFIX_IDS: readonly EliteAffix[] = ['berserker', 'ironclad', 'vampiric'];

export const ELITE_AFFIX_LABELS: Record<EliteAffix, string> = {
  berserker: '광전',
  ironclad: '철갑',
  vampiric: '흡혈',
};

export interface CoreStats {
  strength: number;
  vitality: number;
  defense: number;
  agility: number;
}

export interface EquipmentStats {
  maxHp: number;
  attack: number;
  defense: number;
  crit: number;
}

export interface DerivedStats extends EquipmentStats {
  power: number;
}

export interface SkillDefinition {
  id: SkillSlot;
  name: string;
  description: string;
  unlockLevel: number;
  cooldown: number;
  maxRank: number;
  arena: ArenaSkillMetadata;
}

export interface ArenaSkillMetadata {
  kind: ArenaSkillKind;
  damageMultiplier: number;
  range: number;
  projectileKey: string | null;
  effectKey: string;
  animationKey: string;
  projectileCount?: number;
  pierce?: number;
  healingRatio?: number;
}

export interface CharacterClassDefinition {
  id: CharacterClassId;
  name: string;
  title: string;
  description: string;
  icon: string;
  baseMaxHp: number;
  baseAttack: number;
  baseDefense: number;
  baseCrit: number;
  startingStats: CoreStats;
  skills: Record<SkillSlot, SkillDefinition>;
}

export const CORE_STAT_LABELS: Record<CoreStatId, string> = {
  strength: '힘',
  vitality: '체력',
  defense: '수호',
  agility: '민첩',
};

export const EQUIPMENT_SLOT_LABELS: Record<EquipmentSlot, string> = {
  weapon: '무기',
  armor: '방어구',
  accessory: '장신구',
};

export const RARITY_LABELS: Record<EquipmentRarity, string> = {
  common: '일반',
  uncommon: '마법',
  rare: '희귀',
  epic: '세트',
  legendary: '고유',
};

export const ITEM_TIER_IDS: readonly ItemTier[] = ['normal', 'magic', 'rare', 'set', 'unique'];

export const ITEM_TIER_LABELS: Record<ItemTier, string> = {
  normal: '일반',
  magic: '마법',
  rare: '희귀',
  set: '세트',
  unique: '고유',
};

export const ITEM_TIER_BY_RARITY: Record<EquipmentRarity, ItemTier> = {
  common: 'normal',
  uncommon: 'magic',
  rare: 'rare',
  epic: 'set',
  legendary: 'unique',
};

export const RARITY_BY_ITEM_TIER: Record<ItemTier, EquipmentRarity> = {
  normal: 'common',
  magic: 'uncommon',
  rare: 'rare',
  set: 'epic',
  unique: 'legendary',
};

export const COMBAT_ACTION_LABELS: Record<CombatAction, string> = {
  attack: '공격',
  skill1: '기술 1',
  skill2: '기술 2',
  skill3: '기술 3',
  skill4: '기술 4',
  skill5: '기술 5',
  skill6: '기술 6',
  guard: '방어',
  potion: '물약',
  flee: '후퇴',
};

export const CLASS_IDS: readonly CharacterClassId[] = ['vanguard', 'ranger', 'mystic'];

export function isSkillSlot(value: unknown): value is SkillSlot {
  return typeof value === 'string' && SKILL_SLOTS.includes(value as SkillSlot);
}

function createSkillSlotRecord<T>(factory: (slot: SkillSlot, index: number) => T): Record<SkillSlot, T> {
  return Object.fromEntries(SKILL_SLOTS.map((slot, index) => [slot, factory(slot, index)])) as Record<SkillSlot, T>;
}

export const SKILL_REGISTRY: Record<CharacterClassId, Record<SkillSlot, SkillDefinition>> = {
  vanguard: {
    skill1: {
      id: 'skill1',
      name: '방패 강타',
      description: '강하게 타격하고 일정 확률로 적의 반격을 막습니다.',
      unlockLevel: 1,
      cooldown: 2,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'melee', damageMultiplier: 1.15, range: 1.6, projectileKey: null, effectKey: 'shield-impact', animationKey: 'shield-bash' },
    },
    skill2: {
      id: 'skill2',
      name: '불굴의 함성',
      description: '적을 공격하고 잃은 체력을 회복하며 받는 피해를 줄입니다.',
      unlockLevel: 5,
      cooldown: 4,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'area', damageMultiplier: 0.86, range: 3.2, projectileKey: null, effectKey: 'iron-roar', animationKey: 'battle-cry', healingRatio: 0.1 },
    },
    skill3: {
      id: 'skill3',
      name: '회전 베기',
      description: '검을 크게 휘둘러 주변의 적을 한꺼번에 베어냅니다.',
      unlockLevel: 9,
      cooldown: 3,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'area', damageMultiplier: 1.34, range: 2.8, projectileKey: null, effectKey: 'steel-whirl', animationKey: 'whirlwind-slash' },
    },
    skill4: {
      id: 'skill4',
      name: '쇄도 돌격',
      description: '방패를 앞세워 돌진하고 경로의 적을 밀어냅니다.',
      unlockLevel: 14,
      cooldown: 4,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'dash', damageMultiplier: 1.56, range: 5, projectileKey: null, effectKey: 'shield-rush', animationKey: 'shield-charge' },
    },
    skill5: {
      id: 'skill5',
      name: '강철 폭풍',
      description: '연속 검격으로 전방 넓은 범위의 적을 몰아칩니다.',
      unlockLevel: 20,
      cooldown: 5,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'area', damageMultiplier: 1.86, range: 3.6, projectileKey: null, effectKey: 'steel-tempest', animationKey: 'heavy-combo' },
    },
    skill6: {
      id: 'skill6',
      name: '최후의 성채',
      description: '수호의 힘을 폭발시켜 주변을 초토화하고 방어 태세를 취합니다.',
      unlockLevel: 30,
      cooldown: 7,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'area', damageMultiplier: 2.42, range: 4.2, projectileKey: null, effectKey: 'last-bastion', animationKey: 'fortress-slam' },
    },
  },
  ranger: {
    skill1: {
      id: 'skill1',
      name: '연속 사격',
      description: '두 발의 화살을 빠르게 발사해 각각 피해를 줍니다.',
      unlockLevel: 1,
      cooldown: 2,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'projectile', damageMultiplier: 1.2, range: 9, projectileKey: 'wind-arrow', effectKey: 'double-shot', animationKey: 'rapid-shot', projectileCount: 2 },
    },
    skill2: {
      id: 'skill2',
      name: '약점 포착',
      description: '적의 약점을 노려 높은 치명타 확률로 큰 피해를 줍니다.',
      unlockLevel: 5,
      cooldown: 4,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'projectile', damageMultiplier: 1.68, range: 11, projectileKey: 'piercing-arrow', effectKey: 'weak-point', animationKey: 'power-shot', pierce: 4 },
    },
    skill3: {
      id: 'skill3',
      name: '부채꼴 사격',
      description: '여러 발의 화살을 부채꼴로 퍼뜨려 다수의 적을 공격합니다.',
      unlockLevel: 9,
      cooldown: 3,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'area', damageMultiplier: 1.32, range: 7.5, projectileKey: 'fan-arrow', effectKey: 'fan-volley', animationKey: 'spread-shot' },
    },
    skill4: {
      id: 'skill4',
      name: '바람걸음',
      description: '빠르게 이동하며 지나친 적에게 바람의 상처를 남깁니다.',
      unlockLevel: 14,
      cooldown: 4,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'dash', damageMultiplier: 1.18, range: 6.5, projectileKey: null, effectKey: 'wind-step', animationKey: 'evasive-dash' },
    },
    skill5: {
      id: 'skill5',
      name: '화살비',
      description: '지정한 지역에 화살을 쏟아부어 적 무리를 제압합니다.',
      unlockLevel: 20,
      cooldown: 5,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'area', damageMultiplier: 1.82, range: 8.5, projectileKey: 'rain-arrow', effectKey: 'arrow-rain', animationKey: 'sky-volley' },
    },
    skill6: {
      id: 'skill6',
      name: '폭풍 관통화살',
      description: '폭풍을 두른 화살이 일직선의 적과 방어를 꿰뚫습니다.',
      unlockLevel: 30,
      cooldown: 7,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'projectile', damageMultiplier: 2.54, range: 13, projectileKey: 'storm-arrow', effectKey: 'storm-pierce', animationKey: 'storm-shot', pierce: 8 },
    },
  },
  mystic: {
    skill1: {
      id: 'skill1',
      name: '마력탄',
      description: '적의 방어력을 대부분 무시하는 응축된 마력을 발사합니다.',
      unlockLevel: 1,
      cooldown: 2,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'projectile', damageMultiplier: 1.16, range: 9.5, projectileKey: 'mana-bolt', effectKey: 'arcane-hit', animationKey: 'quick-cast' },
    },
    skill2: {
      id: 'skill2',
      name: '별빛 폭발',
      description: '별빛을 폭발시켜 큰 피해를 주고 체력을 회복합니다.',
      unlockLevel: 5,
      cooldown: 4,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'area', damageMultiplier: 1.58, range: 4.5, projectileKey: null, effectKey: 'starlight-burst', animationKey: 'star-cast', healingRatio: 0.06 },
    },
    skill3: {
      id: 'skill3',
      name: '서리 고리',
      description: '차가운 마력을 터뜨려 주변의 적을 얼어붙게 합니다.',
      unlockLevel: 9,
      cooldown: 3,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'area', damageMultiplier: 1.26, range: 4, projectileKey: null, effectKey: 'frost-ring', animationKey: 'frost-cast' },
    },
    skill4: {
      id: 'skill4',
      name: '점멸 폭발',
      description: '순간이동한 자리에 마력 폭발을 남겨 적의 진형을 무너뜨립니다.',
      unlockLevel: 14,
      cooldown: 4,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'dash', damageMultiplier: 1.38, range: 6, projectileKey: null, effectKey: 'blink-burst', animationKey: 'blink-cast' },
    },
    skill5: {
      id: 'skill5',
      name: '별운석',
      description: '별의 파편을 낙하시켜 넓은 지역에 강력한 피해를 줍니다.',
      unlockLevel: 20,
      cooldown: 5,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'area', damageMultiplier: 1.94, range: 6.5, projectileKey: 'star-meteor', effectKey: 'meteor-impact', animationKey: 'meteor-cast' },
    },
    skill6: {
      id: 'skill6',
      name: '성좌 붕괴',
      description: '응축한 성좌를 붕괴시켜 전장을 뒤덮는 마력 폭발을 일으킵니다.',
      unlockLevel: 30,
      cooldown: 7,
      maxRank: MAX_SKILL_RANK,
      arena: { kind: 'area', damageMultiplier: 2.58, range: 7.5, projectileKey: null, effectKey: 'constellation-collapse', animationKey: 'ultimate-cast' },
    },
  },
};

export function getClassSkills(classId: CharacterClassId): readonly SkillDefinition[] {
  return SKILL_SLOTS.map((slot) => SKILL_REGISTRY[classId][slot]);
}

export function getAvailableSkillSlots(
  state: Pick<AdventureState, 'classId' | 'level' | 'skillRanks'>,
): SkillSlot[] {
  return SKILL_SLOTS.filter((slot) => (
    state.level >= SKILL_REGISTRY[state.classId][slot].unlockLevel
    && (state.skillRanks[slot] ?? 0) > 0
  ));
}

export const CLASS_DEFINITIONS: Record<CharacterClassId, CharacterClassDefinition> = {
  vanguard: {
    id: 'vanguard',
    name: '선봉기사',
    title: '강철의 수호자',
    description: '높은 체력과 방어력으로 정면에서 버티는 근접 전사입니다.',
    icon: 'shield',
    baseMaxHp: 48,
    baseAttack: 5,
    baseDefense: 2,
    baseCrit: 3,
    startingStats: { strength: 4, vitality: 6, defense: 5, agility: 2 },
    skills: SKILL_REGISTRY.vanguard,
  },
  ranger: {
    id: 'ranger',
    name: '바람사수',
    title: '바람을 읽는 추적자',
    description: '빠른 연속 공격과 높은 치명타 확률로 적을 제압합니다.',
    icon: 'bow-arrow',
    baseMaxHp: 43,
    baseAttack: 6,
    baseDefense: 1,
    baseCrit: 9,
    startingStats: { strength: 5, vitality: 4, defense: 3, agility: 7 },
    skills: SKILL_REGISTRY.ranger,
  },
  mystic: {
    id: 'mystic',
    name: '별빛술사',
    title: '별의 힘을 다루는 현자',
    description: '방어를 꿰뚫는 마법과 회복을 함께 사용하는 주문사입니다.',
    icon: 'sparkles',
    baseMaxHp: 40,
    baseAttack: 7,
    baseDefense: 1,
    baseCrit: 6,
    startingStats: { strength: 6, vitality: 4, defense: 2, agility: 4 },
    skills: SKILL_REGISTRY.mystic,
  },
};

export interface EnemyDefinition {
  id: string;
  regionId: RegionId;
  name: string;
  description: string;
  icon: string;
  level: number;
  maxHp: number;
  attack: number;
  defense: number;
  crit: number;
  exp: number;
  masteryExp: number;
  goldMin: number;
  goldMax: number;
  dropChance: number;
  boss: boolean;
}

export interface RegionDefinition {
  id: RegionId;
  name: string;
  description: string;
  icon: string;
  unlockLevel: number;
  recommendedPower: number;
  enemyIds: readonly [string, string, string];
  bossId: string;
}

export const REGION_IDS: readonly RegionId[] = ['sunnyField', 'mistForest', 'ancientRuins', 'dragonCrater'];

export const ENEMY_DEFINITIONS: Record<string, EnemyDefinition> = {
  field_slime: {
    id: 'field_slime', regionId: 'sunnyField', name: '햇살 슬라임', description: '햇빛을 머금은 말랑한 마물입니다.', icon: 'droplet',
    level: 1, maxHp: 42, attack: 10, defense: 2, crit: 2, exp: 18, masteryExp: 5, goldMin: 10, goldMax: 17, dropChance: 0.22, boss: false,
  },
  field_boar: {
    id: 'field_boar', regionId: 'sunnyField', name: '들판 멧돼지', description: '거친 돌진으로 여행자를 위협합니다.', icon: 'beef',
    level: 2, maxHp: 55, attack: 12, defense: 3, crit: 4, exp: 23, masteryExp: 6, goldMin: 12, goldMax: 20, dropChance: 0.24, boss: false,
  },
  field_bandit: {
    id: 'field_bandit', regionId: 'sunnyField', name: '떠돌이 약탈자', description: '초보 모험가의 주머니를 노리는 약탈자입니다.', icon: 'swords',
    level: 3, maxHp: 61, attack: 13, defense: 4, crit: 6, exp: 27, masteryExp: 7, goldMin: 15, goldMax: 25, dropChance: 0.27, boss: false,
  },
  field_boss: {
    id: 'field_boss', regionId: 'sunnyField', name: '황금갈기 왕멧돼지', description: '들판의 무리를 이끄는 거대한 왕멧돼지입니다.', icon: 'crown',
    level: 4, maxHp: 145, attack: 15, defense: 5, crit: 7, exp: 85, masteryExp: 24, goldMin: 70, goldMax: 95, dropChance: 1, boss: true,
  },
  forest_wolf: {
    id: 'forest_wolf', regionId: 'mistForest', name: '안개 늑대', description: '안개 사이를 소리 없이 달리는 포식자입니다.', icon: 'paw-print',
    level: 5, maxHp: 102, attack: 20, defense: 7, crit: 8, exp: 48, masteryExp: 12, goldMin: 28, goldMax: 42, dropChance: 0.28, boss: false,
  },
  forest_spider: {
    id: 'forest_spider', regionId: 'mistForest', name: '독안개 거미', description: '독을 머금은 실로 움직임을 방해합니다.', icon: 'bug',
    level: 6, maxHp: 92, attack: 23, defense: 6, crit: 10, exp: 53, masteryExp: 13, goldMin: 31, goldMax: 47, dropChance: 0.3, boss: false,
  },
  forest_treant: {
    id: 'forest_treant', regionId: 'mistForest', name: '뒤틀린 나무정령', description: '오래된 숲의 분노가 나무에 깃들었습니다.', icon: 'trees',
    level: 8, maxHp: 132, attack: 22, defense: 10, crit: 4, exp: 62, masteryExp: 15, goldMin: 37, goldMax: 55, dropChance: 0.32, boss: false,
  },
  forest_boss: {
    id: 'forest_boss', regionId: 'mistForest', name: '천년 수호목', description: '숲의 중심을 지키며 모든 침입자를 뿌리로 묶습니다.', icon: 'tree-pine',
    level: 10, maxHp: 315, attack: 28, defense: 13, crit: 6, exp: 220, masteryExp: 58, goldMin: 180, goldMax: 240, dropChance: 1, boss: true,
  },
  ruins_sentinel: {
    id: 'ruins_sentinel', regionId: 'ancientRuins', name: '고대 파수병', description: '멈추지 않는 고대의 명령을 수행하는 병사입니다.', icon: 'landmark',
    level: 12, maxHp: 225, attack: 34, defense: 16, crit: 7, exp: 105, masteryExp: 24, goldMin: 66, goldMax: 91, dropChance: 0.34, boss: false,
  },
  ruins_gargoyle: {
    id: 'ruins_gargoyle', regionId: 'ancientRuins', name: '균열 가고일', description: '석상인 척 숨어 있다 날카로운 발톱을 휘두릅니다.', icon: 'mountain',
    level: 14, maxHp: 248, attack: 38, defense: 17, crit: 10, exp: 121, masteryExp: 27, goldMin: 74, goldMax: 105, dropChance: 0.36, boss: false,
  },
  ruins_mage: {
    id: 'ruins_mage', regionId: 'ancientRuins', name: '망각의 주술사', description: '사라진 왕국의 저주를 되풀이하는 망령입니다.', icon: 'flame',
    level: 16, maxHp: 218, attack: 43, defense: 14, crit: 13, exp: 138, masteryExp: 31, goldMin: 84, goldMax: 118, dropChance: 0.38, boss: false,
  },
  ruins_boss: {
    id: 'ruins_boss', regionId: 'ancientRuins', name: '잊힌 왕의 갑주', description: '왕의 집념만 남아 움직이는 거대한 갑주입니다.', icon: 'shield',
    level: 19, maxHp: 610, attack: 49, defense: 23, crit: 10, exp: 510, masteryExp: 125, goldMin: 420, goldMax: 540, dropChance: 1, boss: true,
  },
  crater_drake: {
    id: 'crater_drake', regionId: 'dragonCrater', name: '화염 비룡', description: '용의 불꽃을 닮은 숨결을 내뿜습니다.', icon: 'flame-kindling',
    level: 22, maxHp: 430, attack: 55, defense: 28, crit: 11, exp: 215, masteryExp: 45, goldMin: 145, goldMax: 195, dropChance: 0.4, boss: false,
  },
  crater_golem: {
    id: 'crater_golem', regionId: 'dragonCrater', name: '용암 골렘', description: '굳은 용암 갑옷이 공격을 튕겨냅니다.', icon: 'gem',
    level: 25, maxHp: 520, attack: 58, defense: 35, crit: 6, exp: 252, masteryExp: 51, goldMin: 170, goldMax: 225, dropChance: 0.42, boss: false,
  },
  crater_cultist: {
    id: 'crater_cultist', regionId: 'dragonCrater', name: '붉은 비늘 사도', description: '잠든 용을 깨우려는 위험한 숭배자입니다.', icon: 'wand-sparkles',
    level: 28, maxHp: 465, attack: 66, defense: 29, crit: 16, exp: 286, masteryExp: 58, goldMin: 188, goldMax: 255, dropChance: 0.44, boss: false,
  },
  crater_boss: {
    id: 'crater_boss', regionId: 'dragonCrater', name: '홍염룡 아르카드', description: '분화구 아래에서 깨어난 고대의 화염룡입니다.', icon: 'badge-flame',
    level: 32, maxHp: 1250, attack: 78, defense: 42, crit: 14, exp: 1250, masteryExp: 280, goldMin: 1100, goldMax: 1450, dropChance: 1, boss: true,
  },
};

export const REGION_DEFINITIONS: Record<RegionId, RegionDefinition> = {
  sunnyField: {
    id: 'sunnyField', name: '햇살 들판', description: '왕도 밖에 펼쳐진 초보 모험가의 사냥터입니다.', icon: 'sun',
    unlockLevel: 1, recommendedPower: 45, enemyIds: ['field_slime', 'field_boar', 'field_bandit'], bossId: 'field_boss',
  },
  mistForest: {
    id: 'mistForest', name: '안개숲', description: '시야를 가리는 짙은 안개와 맹수가 도사리는 숲입니다.', icon: 'trees',
    unlockLevel: 5, recommendedPower: 90, enemyIds: ['forest_wolf', 'forest_spider', 'forest_treant'], bossId: 'forest_boss',
  },
  ancientRuins: {
    id: 'ancientRuins', name: '고대 왕국의 폐허', description: '멸망한 왕국의 병사와 저주가 잠들지 못한 장소입니다.', icon: 'landmark',
    unlockLevel: 12, recommendedPower: 175, enemyIds: ['ruins_sentinel', 'ruins_gargoyle', 'ruins_mage'], bossId: 'ruins_boss',
  },
  dragonCrater: {
    id: 'dragonCrater', name: '용의 분화구', description: '뜨거운 재와 용의 기운이 뒤섞인 최상위 사냥터입니다.', icon: 'volcano',
    unlockLevel: 22, recommendedPower: 310, enemyIds: ['crater_drake', 'crater_golem', 'crater_cultist'], bossId: 'crater_boss',
  },
};

export interface EquipmentDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  slot: EquipmentSlot;
  regionId: RegionId;
  requiredClassId?: CharacterClassId;
  baseStats: EquipmentStats;
}

const zeroEquipmentStats = (): EquipmentStats => ({ maxHp: 0, attack: 0, defense: 0, crit: 0 });

export const EQUIPMENT_DEFINITIONS: readonly EquipmentDefinition[] = [
  { id: 'field_vanguard_weapon', name: '수련용 장검', description: '기사단 훈련소에서 사용하는 튼튼한 장검입니다.', icon: 'sword', slot: 'weapon', regionId: 'sunnyField', requiredClassId: 'vanguard', baseStats: { ...zeroEquipmentStats(), attack: 5, defense: 1 } },
  { id: 'field_ranger_weapon', name: '산들바람 활', description: '가볍고 다루기 쉬운 초심자의 활입니다.', icon: 'bow-arrow', slot: 'weapon', regionId: 'sunnyField', requiredClassId: 'ranger', baseStats: { ...zeroEquipmentStats(), attack: 6, crit: 2 } },
  { id: 'field_mystic_weapon', name: '별가루 지팡이', description: '작은 별빛이 맺힌 견습 술사의 지팡이입니다.', icon: 'wand-sparkles', slot: 'weapon', regionId: 'sunnyField', requiredClassId: 'mystic', baseStats: { ...zeroEquipmentStats(), attack: 7, maxHp: 4 } },
  { id: 'field_armor', name: '튼튼한 가죽옷', description: '들판의 가죽으로 만든 가벼운 방어구입니다.', icon: 'shirt', slot: 'armor', regionId: 'sunnyField', baseStats: { ...zeroEquipmentStats(), maxHp: 12, defense: 3 } },
  { id: 'field_accessory', name: '민들레 부적', description: '작은 행운을 불러온다는 들꽃 부적입니다.', icon: 'clover', slot: 'accessory', regionId: 'sunnyField', baseStats: { ...zeroEquipmentStats(), maxHp: 7, crit: 2 } },
  { id: 'forest_vanguard_weapon', name: '수호목 대검', description: '수호목의 단단한 심재로 만든 대검입니다.', icon: 'sword', slot: 'weapon', regionId: 'mistForest', requiredClassId: 'vanguard', baseStats: { ...zeroEquipmentStats(), attack: 12, defense: 3 } },
  { id: 'forest_ranger_weapon', name: '안개추적자 활', description: '안개 속 표적의 기척을 따라가는 장궁입니다.', icon: 'bow-arrow', slot: 'weapon', regionId: 'mistForest', requiredClassId: 'ranger', baseStats: { ...zeroEquipmentStats(), attack: 14, crit: 4 } },
  { id: 'forest_mystic_weapon', name: '월광 가지', description: '달빛을 저장하는 고목의 가지입니다.', icon: 'wand-sparkles', slot: 'weapon', regionId: 'mistForest', requiredClassId: 'mystic', baseStats: { ...zeroEquipmentStats(), attack: 16, maxHp: 10 } },
  { id: 'forest_armor', name: '안개늑대 외투', description: '안개늑대의 털로 만든 따뜻한 외투입니다.', icon: 'shirt', slot: 'armor', regionId: 'mistForest', baseStats: { ...zeroEquipmentStats(), maxHp: 28, defense: 8 } },
  { id: 'forest_accessory', name: '수호목 씨앗', description: '미약하지만 끊임없이 생명력을 내뿜습니다.', icon: 'sprout', slot: 'accessory', regionId: 'mistForest', baseStats: { ...zeroEquipmentStats(), maxHp: 18, crit: 4 } },
  { id: 'ruins_vanguard_weapon', name: '왕국 근위검', description: '잊힌 왕국 근위대의 문장이 새겨진 검입니다.', icon: 'sword', slot: 'weapon', regionId: 'ancientRuins', requiredClassId: 'vanguard', baseStats: { ...zeroEquipmentStats(), attack: 24, defense: 7 } },
  { id: 'ruins_ranger_weapon', name: '유물 파쇄궁', description: '고대 석재마저 꿰뚫는 강궁입니다.', icon: 'bow-arrow', slot: 'weapon', regionId: 'ancientRuins', requiredClassId: 'ranger', baseStats: { ...zeroEquipmentStats(), attack: 28, crit: 7 } },
  { id: 'ruins_mystic_weapon', name: '망각의 홀', description: '사라진 왕국의 기억을 마력으로 바꾸는 홀입니다.', icon: 'wand-sparkles', slot: 'weapon', regionId: 'ancientRuins', requiredClassId: 'mystic', baseStats: { ...zeroEquipmentStats(), attack: 31, maxHp: 22 } },
  { id: 'ruins_armor', name: '고대 수호갑', description: '마법이 깃든 금속판을 이어 만든 갑옷입니다.', icon: 'shield', slot: 'armor', regionId: 'ancientRuins', baseStats: { ...zeroEquipmentStats(), maxHp: 55, defense: 16 } },
  { id: 'ruins_accessory', name: '왕가의 인장', description: '옛 왕가의 권능이 남은 낡은 인장입니다.', icon: 'gem', slot: 'accessory', regionId: 'ancientRuins', baseStats: { ...zeroEquipmentStats(), attack: 7, maxHp: 30, crit: 6 } },
  { id: 'crater_vanguard_weapon', name: '용아 대검', description: '고대 용의 이빨을 벼려 만든 거대한 검입니다.', icon: 'sword', slot: 'weapon', regionId: 'dragonCrater', requiredClassId: 'vanguard', baseStats: { ...zeroEquipmentStats(), attack: 45, defense: 12 } },
  { id: 'crater_ranger_weapon', name: '홍염룡 장궁', description: '시위를 당기면 불꽃의 궤적이 남는 장궁입니다.', icon: 'bow-arrow', slot: 'weapon', regionId: 'dragonCrater', requiredClassId: 'ranger', baseStats: { ...zeroEquipmentStats(), attack: 52, crit: 11 } },
  { id: 'crater_mystic_weapon', name: '용심장 지팡이', description: '용의 심장 조각에서 끝없는 마력이 흐릅니다.', icon: 'wand-sparkles', slot: 'weapon', regionId: 'dragonCrater', requiredClassId: 'mystic', baseStats: { ...zeroEquipmentStats(), attack: 58, maxHp: 42 } },
  { id: 'crater_armor', name: '붉은 비늘 갑주', description: '용의 비늘을 겹쳐 열기와 충격을 막습니다.', icon: 'shield', slot: 'armor', regionId: 'dragonCrater', baseStats: { ...zeroEquipmentStats(), maxHp: 105, defense: 29 } },
  { id: 'crater_accessory', name: '불멸의 불씨', description: '꺼지지 않는 작은 불꽃이 힘을 북돋습니다.', icon: 'flame', slot: 'accessory', regionId: 'dragonCrater', baseStats: { maxHp: 62, attack: 13, defense: 0, crit: 9 } },
];

export const EQUIPMENT_BY_ID: Readonly<Record<string, EquipmentDefinition>> = Object.fromEntries(
  EQUIPMENT_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export interface GearModifierDefinition {
  id: string;
  name: string;
  description: string;
  statBonus: EquipmentStats;
  statScale: number;
}

export interface GearQualityDefinition {
  id: GearQuality;
  name: string;
  statScale: number;
  valueScale: number;
}

export type GearQuality = 'standard' | 'refined' | 'masterwork';

export const GEAR_BASE_FAMILIES = EQUIPMENT_DEFINITIONS;

export const GEAR_MATERIALS: readonly GearModifierDefinition[] = [
  { id: 'oak', name: '참나무', description: '생명력이 깃든 가벼운 재료', statBonus: { maxHp: 5, attack: 0, defense: 1, crit: 0 }, statScale: 0.94 },
  { id: 'iron', name: '강철', description: '균형 잡힌 표준 금속', statBonus: { maxHp: 0, attack: 2, defense: 2, crit: 0 }, statScale: 1 },
  { id: 'silver', name: '은빛', description: '마력을 잘 전달하는 금속', statBonus: { maxHp: 2, attack: 3, defense: 0, crit: 1 }, statScale: 1.04 },
  { id: 'moonstone', name: '월석', description: '달빛을 품은 희귀 광석', statBonus: { maxHp: 7, attack: 3, defense: 1, crit: 1 }, statScale: 1.08 },
  { id: 'obsidian', name: '흑요석', description: '날카롭고 단단한 화산석', statBonus: { maxHp: 0, attack: 5, defense: 2, crit: 1 }, statScale: 1.12 },
  { id: 'mithril', name: '미스릴', description: '가볍고 강인한 마법 금속', statBonus: { maxHp: 5, attack: 5, defense: 3, crit: 2 }, statScale: 1.17 },
  { id: 'dragonbone', name: '용골', description: '용의 힘이 남은 뼈', statBonus: { maxHp: 12, attack: 7, defense: 3, crit: 1 }, statScale: 1.22 },
  { id: 'starsteel', name: '성철', description: '별빛에서 태어난 최고급 금속', statBonus: { maxHp: 8, attack: 8, defense: 5, crit: 3 }, statScale: 1.28 },
];

export const GEAR_PREFIXES: readonly GearModifierDefinition[] = [
  { id: 'sturdy', name: '튼튼한', description: '체력과 방어에 집중된', statBonus: { maxHp: 10, attack: 0, defense: 2, crit: 0 }, statScale: 1 },
  { id: 'sharp', name: '예리한', description: '공격력을 높인', statBonus: { maxHp: 0, attack: 5, defense: 0, crit: 1 }, statScale: 1 },
  { id: 'swift', name: '신속한', description: '치명타에 집중된', statBonus: { maxHp: 0, attack: 2, defense: 0, crit: 3 }, statScale: 1 },
  { id: 'guardian', name: '수호자의', description: '방어력을 크게 높인', statBonus: { maxHp: 4, attack: 0, defense: 5, crit: 0 }, statScale: 1.01 },
  { id: 'fierce', name: '맹렬한', description: '공격 성능을 극대화한', statBonus: { maxHp: 0, attack: 7, defense: -1, crit: 1 }, statScale: 1.02 },
  { id: 'blessed', name: '축복받은', description: '모든 능력이 안정적인', statBonus: { maxHp: 6, attack: 2, defense: 2, crit: 1 }, statScale: 1.03 },
  { id: 'ancient', name: '고대의', description: '오래된 힘을 간직한', statBonus: { maxHp: 8, attack: 4, defense: 3, crit: 1 }, statScale: 1.05 },
  { id: 'mythic', name: '신화적인', description: '한계를 넘어선 힘의', statBonus: { maxHp: 12, attack: 6, defense: 4, crit: 2 }, statScale: 1.08 },
];

export const GEAR_SUFFIXES: readonly GearModifierDefinition[] = [
  { id: 'life', name: '생명', description: '생명력을 북돋는 힘', statBonus: { maxHp: 14, attack: 0, defense: 0, crit: 0 }, statScale: 1 },
  { id: 'power', name: '힘', description: '파괴력을 북돋는 힘', statBonus: { maxHp: 0, attack: 6, defense: 0, crit: 0 }, statScale: 1 },
  { id: 'fortress', name: '철벽', description: '공격을 견디는 힘', statBonus: { maxHp: 0, attack: 0, defense: 6, crit: 0 }, statScale: 1 },
  { id: 'wind', name: '바람', description: '빈틈을 포착하는 힘', statBonus: { maxHp: 0, attack: 0, defense: 0, crit: 4 }, statScale: 1 },
  { id: 'flame', name: '불꽃', description: '뜨거운 공격의 힘', statBonus: { maxHp: 0, attack: 5, defense: 0, crit: 2 }, statScale: 1.01 },
  { id: 'moon', name: '달빛', description: '부드러운 회복의 힘', statBonus: { maxHp: 10, attack: 2, defense: 2, crit: 0 }, statScale: 1.02 },
  { id: 'king', name: '왕', description: '위엄 있는 균형의 힘', statBonus: { maxHp: 8, attack: 3, defense: 3, crit: 1 }, statScale: 1.04 },
  { id: 'dragon', name: '용', description: '압도적인 용의 힘', statBonus: { maxHp: 14, attack: 6, defense: 4, crit: 2 }, statScale: 1.07 },
];

export const GEAR_QUALITIES: Readonly<Record<GearQuality, GearQualityDefinition>> = {
  standard: { id: 'standard', name: '표준품', statScale: 1, valueScale: 1 },
  refined: { id: 'refined', name: '정제품', statScale: 1.1, valueScale: 1.35 },
  masterwork: { id: 'masterwork', name: '명품', statScale: 1.22, valueScale: 1.8 },
};

export const GEAR_QUALITY_IDS: readonly GearQuality[] = ['standard', 'refined', 'masterwork'];
export const RARITY_IDS: readonly EquipmentRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export type GearAffixKind = 'prefix' | 'suffix';

export interface GearAffixPoolEntry {
  id: string;
  kind: GearAffixKind;
  minItemLevel: number;
  maxItemLevel: number;
  weight: number;
  slots: readonly EquipmentSlot[];
  tiers: readonly ItemTier[];
}

const ALL_EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ['weapon', 'armor', 'accessory'];
const AFFIX_ITEM_TIERS: readonly ItemTier[] = ['magic', 'rare', 'set', 'unique'];
const AFFIX_UNLOCK_LEVELS = [1, 1, 1, 6, 10, 14, 22, 32] as const;
const AFFIX_WEIGHTS = [100, 96, 92, 72, 54, 38, 22, 10] as const;

export const GEAR_AFFIX_POOLS: Readonly<Record<GearAffixKind, readonly GearAffixPoolEntry[]>> = {
  prefix: GEAR_PREFIXES.map((affix, index) => ({
    id: affix.id,
    kind: 'prefix' as const,
    minItemLevel: AFFIX_UNLOCK_LEVELS[index] ?? 1,
    maxItemLevel: MAX_LEVEL,
    weight: AFFIX_WEIGHTS[index] ?? 1,
    slots: ALL_EQUIPMENT_SLOTS,
    tiers: AFFIX_ITEM_TIERS,
  })),
  suffix: GEAR_SUFFIXES.map((affix, index) => ({
    id: affix.id,
    kind: 'suffix' as const,
    minItemLevel: AFFIX_UNLOCK_LEVELS[index] ?? 1,
    maxItemLevel: MAX_LEVEL,
    weight: AFFIX_WEIGHTS[index] ?? 1,
    slots: ALL_EQUIPMENT_SLOTS,
    tiers: AFFIX_ITEM_TIERS,
  })),
};

export function getGearAffixPool(
  kind: GearAffixKind,
  itemLevel: number,
  slot: EquipmentSlot,
  tier: ItemTier,
): readonly GearAffixPoolEntry[] {
  const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(itemLevel)));
  if (tier === 'normal') return [];
  return GEAR_AFFIX_POOLS[kind].filter((entry) => (
    entry.minItemLevel <= safeLevel
    && entry.maxItemLevel >= safeLevel
    && entry.slots.includes(slot)
    && entry.tiers.includes(tier)
  ));
}

export type ItemTierDropWeights = Record<ItemTier, number>;

export const ITEM_TIER_DROP_WEIGHTS: Readonly<ItemTierDropWeights> = {
  normal: 5_650,
  magic: 2_750,
  rare: 1_300,
  set: 250,
  unique: 50,
};

export function getItemTierDropWeights(regionId: RegionId, boss = false, elite = false): ItemTierDropWeights {
  const regionIndex = Math.max(0, REGION_IDS.indexOf(regionId));
  const highTierBoost = 1 + regionIndex * 0.28 + (elite ? 1.2 : 0) + (boss ? 2.8 : 0);
  return {
    normal: boss ? 0 : Math.max(500, ITEM_TIER_DROP_WEIGHTS.normal - regionIndex * 450 - (elite ? 1_600 : 0)),
    magic: boss ? 800 : ITEM_TIER_DROP_WEIGHTS.magic,
    rare: Math.round(ITEM_TIER_DROP_WEIGHTS.rare * (1 + regionIndex * 0.12 + (elite ? 0.45 : 0) + (boss ? 0.8 : 0))),
    set: Math.round(ITEM_TIER_DROP_WEIGHTS.set * highTierBoost),
    unique: Math.round(ITEM_TIER_DROP_WEIGHTS.unique * highTierBoost),
  };
}

export interface AdventurePassiveModifiers {
  damageBonus?: number;
  damageTakenReduction?: number;
  attackSpeedBonus?: number;
  movementSpeedBonus?: number;
  cooldownReduction?: number;
  lifeOnHit?: number;
  lifeOnKill?: number;
  critChanceBonus?: number;
  critDamageBonus?: number;
  projectileSpeedBonus?: number;
  areaBonus?: number;
}

export const UNIQUE_ITEM_IDS = [
  'oathbreaker',
  'nightpiercer',
  'cinderOracle',
  'plagueEdge',
  'bloodforgedAegis',
  'frostboundCarapace',
  'stormhide',
  'graveward',
  'executionersHourglass',
  'seraphTear',
  'voidEye',
  'emberCrown',
] as const;

export type UniqueItemId = (typeof UNIQUE_ITEM_IDS)[number];

export interface UniqueItemDefinition {
  id: UniqueItemId;
  name: string;
  description: string;
  slot: EquipmentSlot;
  requiredClassId?: CharacterClassId;
  passive: AdventurePassiveModifiers;
  effects: AdventureSpecialEffectList;
}

export const UNIQUE_ITEM_DEFINITIONS: Readonly<Record<UniqueItemId, UniqueItemDefinition>> = {
  oathbreaker: {
    id: 'oathbreaker', name: '맹세파괴자', description: '돌진할수록 칼날이 무거워지는 금단의 검입니다.', slot: 'weapon', requiredClassId: 'vanguard',
    passive: { damageBonus: 0.1, lifeOnHit: 2 },
    effects: [
      { id: 'oathbreaker-impact', name: '파기된 맹세', kind: 'onHit', chance: 0.18, damageMultiplier: 1.65, element: 'physical', chainTargets: 1 },
      { id: 'oathbreaker-charge', name: '멈추지 않는 쇄도', kind: 'skillModifier', skill: 'skill4', damageMultiplier: 1.42, cooldownMultiplier: 0.78, rangeMultiplier: 1.25 },
    ],
  },
  nightpiercer: {
    id: 'nightpiercer', name: '밤을 꿰뚫는 자', description: '화살이 그림자 사이에서 갈라지는 장궁입니다.', slot: 'weapon', requiredClassId: 'ranger',
    passive: { attackSpeedBonus: 0.12, projectileSpeedBonus: 0.18 },
    effects: [
      { id: 'nightpiercer-volley', name: '그림자 분열', kind: 'projectile', additionalProjectiles: 2, pierce: 1, speedMultiplier: 1.16, damageMultiplier: 0.86 },
      { id: 'nightpiercer-venom', name: '월식 독', kind: 'elemental', element: 'poison', damageMultiplier: 1.28, penetration: 0.14 },
    ],
  },
  cinderOracle: {
    id: 'cinderOracle', name: '잿불 예언자의 홀', description: '주문이 끝난 자리에 한 번 더 불꽃이 되살아납니다.', slot: 'weapon', requiredClassId: 'mystic',
    passive: { cooldownReduction: 0.08, areaBonus: 0.12 },
    effects: [
      { id: 'cinder-oracle-echo', name: '재점화', kind: 'onCast', chance: 0.24, echoDamageMultiplier: 0.72, cooldownRefundSeconds: 0.4 },
      { id: 'cinder-oracle-fire', name: '예언의 불', kind: 'elemental', element: 'fire', damageMultiplier: 1.35, penetration: 0.16 },
    ],
  },
  plagueEdge: {
    id: 'plagueEdge', name: '역병의 칼끝', description: '상처를 타고 독이 다른 적에게 번지는 무기입니다.', slot: 'weapon',
    passive: { damageBonus: 0.06, attackSpeedBonus: 0.08 },
    effects: [
      { id: 'plague-edge-spread', name: '부패 전염', kind: 'onHit', chance: 0.22, damageMultiplier: 1.28, element: 'poison', chainTargets: 3, lifeStealPercent: 0.02 },
    ],
  },
  bloodforgedAegis: {
    id: 'bloodforgedAegis', name: '혈철 방벽', description: '치명상에 가까울수록 피를 강철로 바꾸는 갑주입니다.', slot: 'armor',
    passive: { damageTakenReduction: 0.08, lifeOnKill: 3 },
    effects: [
      { id: 'bloodforged-last-stand', name: '혈철의 최후', kind: 'lowLife', threshold: 0.35, damageMultiplier: 1.32, damageTakenMultiplier: 0.68, lifeOnHit: 3 },
      { id: 'bloodforged-feast', name: '승자의 피', kind: 'onKill', chance: 1, healPercent: 0.025 },
    ],
  },
  frostboundCarapace: {
    id: 'frostboundCarapace', name: '빙결각 갑피', description: '냉기가 공격자와 피격자의 움직임을 함께 늦춥니다.', slot: 'armor',
    passive: { damageTakenReduction: 0.11 },
    effects: [
      { id: 'frostbound-retort', name: '서리 반향', kind: 'onHit', chance: 0.16, damageMultiplier: 1.15, element: 'cold', chainTargets: 2 },
      { id: 'frostbound-core', name: '빙점 핵', kind: 'elemental', element: 'cold', damageMultiplier: 1.2, penetration: 0.12 },
    ],
  },
  stormhide: {
    id: 'stormhide', name: '폭풍가죽', description: '빠르게 움직일수록 전류가 갑주 표면에 축적됩니다.', slot: 'armor',
    passive: { movementSpeedBonus: 0.14, attackSpeedBonus: 0.07 },
    effects: [
      { id: 'stormhide-arc', name: '축전 방출', kind: 'onHit', chance: 0.2, damageMultiplier: 1.22, element: 'lightning', chainTargets: 4 },
    ],
  },
  graveward: {
    id: 'graveward', name: '묘지기의 성의', description: '쓰러진 적의 잔향이 잠시 방패가 됩니다.', slot: 'armor',
    passive: { lifeOnKill: 5, damageTakenReduction: 0.06 },
    effects: [
      { id: 'graveward-shell', name: '죽음의 외피', kind: 'onKill', chance: 0.3, healPercent: 0.04, explosionDamageMultiplier: 0.65, element: 'arcane' },
    ],
  },
  executionersHourglass: {
    id: 'executionersHourglass', name: '집행자의 모래시계', description: '처치의 순간마다 기술의 시간이 거꾸로 흐릅니다.', slot: 'accessory',
    passive: { cooldownReduction: 0.1, critChanceBonus: 4 },
    effects: [
      { id: 'executioner-rewind', name: '사형 집행', kind: 'onKill', chance: 0.36, cooldownReductionSeconds: 1.8 },
      { id: 'executioner-finisher', name: '마지막 한 수', kind: 'skillModifier', skill: 'skill6', damageMultiplier: 1.3, cooldownMultiplier: 0.9, rangeMultiplier: 1.12 },
    ],
  },
  seraphTear: {
    id: 'seraphTear', name: '세라프의 눈물', description: '생명이 위태로울 때 빛이 상처를 붙잡습니다.', slot: 'accessory',
    passive: { lifeOnHit: 2, damageTakenReduction: 0.05 },
    effects: [
      { id: 'seraph-mercy', name: '최후의 자비', kind: 'lowLife', threshold: 0.28, damageMultiplier: 1.12, damageTakenMultiplier: 0.58, lifeOnHit: 6 },
    ],
  },
  voidEye: {
    id: 'voidEye', name: '공허의 눈', description: '투사체가 공간의 접힌 틈을 건너 다시 나타납니다.', slot: 'accessory',
    passive: { projectileSpeedBonus: 0.12, cooldownReduction: 0.05 },
    effects: [
      { id: 'void-eye-fold', name: '공간 접기', kind: 'projectile', additionalProjectiles: 1, pierce: 2, speedMultiplier: 1.28, damageMultiplier: 1.02 },
      { id: 'void-eye-cast', name: '공허 복창', kind: 'onCast', chance: 0.14, echoDamageMultiplier: 0.55 },
    ],
  },
  emberCrown: {
    id: 'emberCrown', name: '꺼지지 않는 왕관', description: '적이 쓰러질 때마다 잿불 고리가 번져 나갑니다.', slot: 'accessory',
    passive: { damageBonus: 0.08, areaBonus: 0.16 },
    effects: [
      { id: 'ember-crown-nova', name: '왕의 장작더미', kind: 'onKill', chance: 0.42, explosionDamageMultiplier: 1.05, element: 'fire' },
      { id: 'ember-crown-flame', name: '불멸의 불씨', kind: 'elemental', element: 'fire', damageMultiplier: 1.24, penetration: 0.1 },
    ],
  },
};

export const SET_ITEM_IDS = ['ironCovenant', 'windstalker', 'astralRite', 'ashenPilgrim', 'graveborn', 'tempest'] as const;
export type SetItemId = (typeof SET_ITEM_IDS)[number];

export interface SetBonusDefinition {
  pieces: 2 | 3;
  passive: AdventurePassiveModifiers;
  effects: readonly AdventureSpecialEffect[];
}

export interface SetItemDefinition {
  id: SetItemId;
  name: string;
  description: string;
  requiredClassId?: CharacterClassId;
  bonuses: readonly SetBonusDefinition[];
}

export const SET_ITEM_DEFINITIONS: Readonly<Record<SetItemId, SetItemDefinition>> = {
  ironCovenant: {
    id: 'ironCovenant', name: '강철 맹약', description: '전열을 무너뜨리지 않는 기사단의 유산입니다.', requiredClassId: 'vanguard',
    bonuses: [
      { pieces: 2, passive: { damageTakenReduction: 0.09, lifeOnHit: 2 }, effects: [] },
      { pieces: 3, passive: { damageBonus: 0.12 }, effects: [{ id: 'iron-covenant-fortress', name: '움직이는 성채', kind: 'skillModifier', skill: 'skill6', damageMultiplier: 1.35, cooldownMultiplier: 0.82, rangeMultiplier: 1.2 }] },
    ],
  },
  windstalker: {
    id: 'windstalker', name: '바람추적자', description: '거리를 벌릴수록 화살이 더 빠르게 갈라집니다.', requiredClassId: 'ranger',
    bonuses: [
      { pieces: 2, passive: { movementSpeedBonus: 0.1, projectileSpeedBonus: 0.15 }, effects: [] },
      { pieces: 3, passive: { critChanceBonus: 5 }, effects: [{ id: 'windstalker-split', name: '바람의 갈래', kind: 'projectile', additionalProjectiles: 2, pierce: 1, speedMultiplier: 1.2, damageMultiplier: 0.9 }] },
    ],
  },
  astralRite: {
    id: 'astralRite', name: '성좌 의식', description: '연속 주문이 별의 잔상을 남기는 술사 장비입니다.', requiredClassId: 'mystic',
    bonuses: [
      { pieces: 2, passive: { cooldownReduction: 0.09, areaBonus: 0.1 }, effects: [] },
      { pieces: 3, passive: { damageBonus: 0.1 }, effects: [{ id: 'astral-rite-echo', name: '별의 복창', kind: 'onCast', chance: 0.2, echoDamageMultiplier: 0.68, cooldownRefundSeconds: 0.25 }] },
    ],
  },
  ashenPilgrim: {
    id: 'ashenPilgrim', name: '잿길 순례자', description: '불길을 지나며 공격과 이동을 이어 가는 방랑자의 세트입니다.',
    bonuses: [
      { pieces: 2, passive: { movementSpeedBonus: 0.08, damageBonus: 0.06 }, effects: [{ id: 'ashen-pilgrim-fire', name: '잿길', kind: 'elemental', element: 'fire', damageMultiplier: 1.16, penetration: 0.08 }] },
      { pieces: 3, passive: { attackSpeedBonus: 0.1 }, effects: [{ id: 'ashen-pilgrim-kindle', name: '불씨 수확', kind: 'onKill', chance: 0.3, explosionDamageMultiplier: 0.72, element: 'fire' }] },
    ],
  },
  graveborn: {
    id: 'graveborn', name: '무덤에서 난 자', description: '약해질수록 생명력을 다시 긁어모으는 세트입니다.',
    bonuses: [
      { pieces: 2, passive: { lifeOnKill: 4, damageTakenReduction: 0.05 }, effects: [] },
      { pieces: 3, passive: { damageBonus: 0.08 }, effects: [{ id: 'graveborn-hunger', name: '되살아난 굶주림', kind: 'lowLife', threshold: 0.4, damageMultiplier: 1.28, damageTakenMultiplier: 0.76, lifeOnHit: 3 }] },
    ],
  },
  tempest: {
    id: 'tempest', name: '폭풍의 중심', description: '연쇄 번개와 투사체를 함께 강화하는 세트입니다.',
    bonuses: [
      { pieces: 2, passive: { attackSpeedBonus: 0.08, projectileSpeedBonus: 0.1 }, effects: [{ id: 'tempest-current', name: '전류 집중', kind: 'elemental', element: 'lightning', damageMultiplier: 1.17, penetration: 0.09 }] },
      { pieces: 3, passive: { cooldownReduction: 0.06 }, effects: [{ id: 'tempest-chain', name: '폭풍 연쇄', kind: 'onHit', chance: 0.2, damageMultiplier: 1.2, element: 'lightning', chainTargets: 3 }] },
    ],
  },
};

export const RUNE_IDS = [
  'ember', 'tide', 'gale', 'stone', 'thorn',
  'dawn', 'dusk', 'blood', 'ward', 'echo',
  'void', 'storm', 'frost', 'venom', 'crown',
] as const;

export type RuneId = (typeof RUNE_IDS)[number];

export interface RuneDefinition {
  id: RuneId;
  name: string;
  minItemLevel: number;
  dropWeight: number;
  passive: AdventurePassiveModifiers;
}

export const RUNE_DEFINITIONS: Readonly<Record<RuneId, RuneDefinition>> = {
  ember: { id: 'ember', name: '잿불 룬', minItemLevel: 1, dropWeight: 120, passive: { damageBonus: 0.015 } },
  tide: { id: 'tide', name: '밀물 룬', minItemLevel: 1, dropWeight: 118, passive: { lifeOnHit: 1 } },
  gale: { id: 'gale', name: '돌풍 룬', minItemLevel: 1, dropWeight: 116, passive: { attackSpeedBonus: 0.015 } },
  stone: { id: 'stone', name: '반석 룬', minItemLevel: 1, dropWeight: 114, passive: { damageTakenReduction: 0.01 } },
  thorn: { id: 'thorn', name: '가시 룬', minItemLevel: 5, dropWeight: 100, passive: { critChanceBonus: 1 } },
  dawn: { id: 'dawn', name: '여명 룬', minItemLevel: 8, dropWeight: 92, passive: { cooldownReduction: 0.01 } },
  dusk: { id: 'dusk', name: '황혼 룬', minItemLevel: 10, dropWeight: 86, passive: { critDamageBonus: 0.025 } },
  blood: { id: 'blood', name: '혈맥 룬', minItemLevel: 12, dropWeight: 80, passive: { lifeOnKill: 2 } },
  ward: { id: 'ward', name: '수호 룬', minItemLevel: 14, dropWeight: 72, passive: { damageTakenReduction: 0.015 } },
  echo: { id: 'echo', name: '메아리 룬', minItemLevel: 17, dropWeight: 62, passive: { cooldownReduction: 0.015 } },
  void: { id: 'void', name: '공허 룬', minItemLevel: 20, dropWeight: 52, passive: { areaBonus: 0.025 } },
  storm: { id: 'storm', name: '폭풍 룬', minItemLevel: 23, dropWeight: 42, passive: { projectileSpeedBonus: 0.035 } },
  frost: { id: 'frost', name: '서리 룬', minItemLevel: 26, dropWeight: 34, passive: { damageTakenReduction: 0.02 } },
  venom: { id: 'venom', name: '맹독 룬', minItemLevel: 29, dropWeight: 26, passive: { damageBonus: 0.025 } },
  crown: { id: 'crown', name: '왕관 룬', minItemLevel: 32, dropWeight: 14, passive: { critChanceBonus: 2, critDamageBonus: 0.04 } },
};

export const RUNE_WORD_IDS = [
  'wildfire', 'bulwark', 'undertow', 'horizon', 'bloodrush',
  'afterimage', 'blackSun', 'winterMaw', 'stormCage', 'venomSpiral',
  'kingsRoad', 'lastLight', 'gravePulse', 'skybreaker', 'deepCurrent',
  'thornPact', 'voidChoir', 'frozenStep', 'redHarvest', 'crownfall',
] as const;

export type RuneWordId = (typeof RUNE_WORD_IDS)[number];

export interface RuneWordDefinition {
  id: RuneWordId;
  name: string;
  runes: readonly RuneId[];
  slots: readonly EquipmentSlot[];
  passive: AdventurePassiveModifiers;
  effects: AdventureSpecialEffectList;
}

export const RUNE_WORD_RECIPES: readonly RuneWordDefinition[] = [
  { id: 'wildfire', name: '들불', runes: ['ember', 'gale'], slots: ['weapon'], passive: { attackSpeedBonus: 0.08 }, effects: [{ id: 'runeword-wildfire', name: '불씨 난사', kind: 'elemental', element: 'fire', damageMultiplier: 1.22, penetration: 0.08 }] },
  { id: 'bulwark', name: '성벽', runes: ['stone', 'ward'], slots: ['armor'], passive: { damageTakenReduction: 0.1 }, effects: [{ id: 'runeword-bulwark', name: '무너지지 않음', kind: 'lowLife', threshold: 0.4, damageMultiplier: 1.08, damageTakenMultiplier: 0.7, lifeOnHit: 2 }] },
  { id: 'undertow', name: '역조', runes: ['tide', 'void'], slots: ['weapon', 'accessory'], passive: { lifeOnHit: 2 }, effects: [{ id: 'runeword-undertow', name: '되감는 파도', kind: 'onHit', chance: 0.16, damageMultiplier: 1.3, element: 'cold', lifeStealPercent: 0.025 }] },
  { id: 'horizon', name: '수평선', runes: ['dawn', 'gale'], slots: ['weapon', 'accessory'], passive: { projectileSpeedBonus: 0.15 }, effects: [{ id: 'runeword-horizon', name: '먼 사격', kind: 'projectile', additionalProjectiles: 1, pierce: 1, speedMultiplier: 1.2, damageMultiplier: 0.96 }] },
  { id: 'bloodrush', name: '핏빛 질주', runes: ['blood', 'gale'], slots: ['weapon', 'armor'], passive: { movementSpeedBonus: 0.1 }, effects: [{ id: 'runeword-bloodrush', name: '포식 질주', kind: 'onKill', chance: 0.32, healPercent: 0.025, cooldownReductionSeconds: 0.5 }] },
  { id: 'afterimage', name: '잔상', runes: ['echo', 'dusk'], slots: ['weapon', 'accessory'], passive: { cooldownReduction: 0.06 }, effects: [{ id: 'runeword-afterimage', name: '재현', kind: 'onCast', chance: 0.18, echoDamageMultiplier: 0.62, cooldownRefundSeconds: 0.2 }] },
  { id: 'blackSun', name: '검은 태양', runes: ['void', 'ember', 'dusk'], slots: ['weapon'], passive: { areaBonus: 0.15, damageBonus: 0.06 }, effects: [{ id: 'runeword-black-sun', name: '암흑 점화', kind: 'onKill', chance: 0.35, explosionDamageMultiplier: 0.92, element: 'arcane' }] },
  { id: 'winterMaw', name: '겨울의 아가리', runes: ['frost', 'thorn'], slots: ['weapon', 'armor'], passive: { damageTakenReduction: 0.04 }, effects: [{ id: 'runeword-winter-maw', name: '동상', kind: 'elemental', element: 'cold', damageMultiplier: 1.26, penetration: 0.12 }] },
  { id: 'stormCage', name: '폭풍 감옥', runes: ['storm', 'ward'], slots: ['armor', 'accessory'], passive: { attackSpeedBonus: 0.05 }, effects: [{ id: 'runeword-storm-cage', name: '연쇄 감전', kind: 'onHit', chance: 0.2, damageMultiplier: 1.18, element: 'lightning', chainTargets: 4 }] },
  { id: 'venomSpiral', name: '맹독 나선', runes: ['venom', 'gale', 'thorn'], slots: ['weapon'], passive: { damageBonus: 0.08 }, effects: [{ id: 'runeword-venom-spiral', name: '독침 회전', kind: 'projectile', additionalProjectiles: 2, pierce: 0, speedMultiplier: 1.08, damageMultiplier: 0.82 }] },
  { id: 'kingsRoad', name: '왕도', runes: ['crown', 'dawn'], slots: ['armor', 'accessory'], passive: { critChanceBonus: 5, critDamageBonus: 0.12 }, effects: [{ id: 'runeword-kings-road', name: '왕의 명령', kind: 'onCast', chance: 0.14, echoDamageMultiplier: 0.74 }] },
  { id: 'lastLight', name: '마지막 빛', runes: ['dawn', 'blood', 'ward'], slots: ['armor'], passive: { lifeOnKill: 4 }, effects: [{ id: 'runeword-last-light', name: '생존의 광휘', kind: 'lowLife', threshold: 0.3, damageMultiplier: 1.2, damageTakenMultiplier: 0.62, lifeOnHit: 5 }] },
  { id: 'gravePulse', name: '무덤 맥동', runes: ['dusk', 'blood'], slots: ['armor', 'accessory'], passive: { lifeOnKill: 3 }, effects: [{ id: 'runeword-grave-pulse', name: '시체 파동', kind: 'onKill', chance: 0.28, explosionDamageMultiplier: 0.86, element: 'poison' }] },
  { id: 'skybreaker', name: '하늘파쇄', runes: ['storm', 'stone', 'crown'], slots: ['weapon'], passive: { damageBonus: 0.1 }, effects: [{ id: 'runeword-skybreaker', name: '낙뢰 강타', kind: 'onHit', chance: 0.17, damageMultiplier: 1.55, element: 'lightning', chainTargets: 2 }] },
  { id: 'deepCurrent', name: '심해류', runes: ['tide', 'frost', 'echo'], slots: ['accessory'], passive: { cooldownReduction: 0.08, lifeOnHit: 2 }, effects: [{ id: 'runeword-deep-current', name: '깊은 복창', kind: 'onCast', chance: 0.2, echoDamageMultiplier: 0.58, cooldownRefundSeconds: 0.6 }] },
  { id: 'thornPact', name: '가시 맹약', runes: ['thorn', 'blood', 'stone'], slots: ['armor'], passive: { damageTakenReduction: 0.07, critChanceBonus: 3 }, effects: [{ id: 'runeword-thorn-pact', name: '피의 가시', kind: 'onHit', chance: 0.22, damageMultiplier: 1.2, element: 'physical', lifeStealPercent: 0.035 }] },
  { id: 'voidChoir', name: '공허 합창', runes: ['void', 'echo', 'crown'], slots: ['weapon', 'accessory'], passive: { areaBonus: 0.18 }, effects: [{ id: 'runeword-void-choir', name: '다중 복창', kind: 'onCast', chance: 0.24, echoDamageMultiplier: 0.66, cooldownRefundSeconds: 0.25 }] },
  { id: 'frozenStep', name: '빙결 보폭', runes: ['frost', 'gale'], slots: ['armor', 'accessory'], passive: { movementSpeedBonus: 0.12 }, effects: [{ id: 'runeword-frozen-step', name: '서리 궤적', kind: 'elemental', element: 'cold', damageMultiplier: 1.18, penetration: 0.15 }] },
  { id: 'redHarvest', name: '붉은 수확', runes: ['blood', 'venom', 'dusk'], slots: ['weapon'], passive: { lifeOnKill: 5, critDamageBonus: 0.08 }, effects: [{ id: 'runeword-red-harvest', name: '처형 수확', kind: 'onKill', chance: 0.4, healPercent: 0.035, explosionDamageMultiplier: 0.6, element: 'poison' }] },
  { id: 'crownfall', name: '왕관 추락', runes: ['crown', 'stone', 'ember'], slots: ['weapon', 'accessory'], passive: { damageBonus: 0.12, cooldownReduction: 0.04 }, effects: [{ id: 'runeword-crownfall', name: '왕권 붕괴', kind: 'skillModifier', skill: 'skill6', damageMultiplier: 1.38, cooldownMultiplier: 0.84, rangeMultiplier: 1.18 }] },
];

export const RUNE_WORD_BY_ID: Readonly<Record<RuneWordId, RuneWordDefinition>> = Object.fromEntries(
  RUNE_WORD_RECIPES.map((recipe) => [recipe.id, recipe]),
) as Record<RuneWordId, RuneWordDefinition>;

const createEmptyRuneInventory = (): Record<RuneId, number> => Object.fromEntries(
  RUNE_IDS.map((runeId) => [runeId, 0]),
) as Record<RuneId, number>;
const GEAR_VARIETY_TAIL = GEAR_PREFIXES.length * GEAR_SUFFIXES.length * RARITY_IDS.length * GEAR_QUALITY_IDS.length;
const materialVarietiesForRegion = (regionId: RegionId): number => Math.min(GEAR_MATERIALS.length, 3 + REGION_IDS.indexOf(regionId) * 2);
const classItemVarieties = (classId: CharacterClassId): number => GEAR_BASE_FAMILIES
  .filter((base) => !base.requiredClassId || base.requiredClassId === classId)
  .reduce((total, base) => total + materialVarietiesForRegion(base.regionId) * GEAR_VARIETY_TAIL, 0);

export const TOTAL_ITEM_VARIETIES = Math.min(...CLASS_IDS.map(classItemVarieties));
export const TOTAL_GLOBAL_ITEM_VARIETIES = GEAR_BASE_FAMILIES.reduce(
  (total, base) => total + materialVarietiesForRegion(base.regionId) * GEAR_VARIETY_TAIL,
  0,
);

export interface EquipmentInstance {
  instanceId: string;
  itemKey: string;
  definitionId: string;
  materialId: string;
  prefixId: string;
  suffixId: string;
  rarity: EquipmentRarity;
  tier: ItemTier;
  quality: GearQuality;
  itemLevel: number;
  level: number;
  enhance: number;
  stats: EquipmentStats;
  socketCount: number;
  socketedRunes: RuneId[];
  setId: SetItemId | null;
  uniqueId: UniqueItemId | null;
  acquiredAt: number;
}

export interface EnemyInstance {
  definitionId: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  crit: number;
  challengeTier: number;
  boss: boolean;
  rank: EnemyRank;
  affixes: EliteAffix[];
}

export interface CombatState {
  id: string;
  enemy: EnemyInstance;
  turn: number;
  cooldowns: Record<SkillSlot, number>;
  startedAt: number;
  lastAction: CombatAction | null;
  mode: EncounterMode;
  wave: number;
  totalWaves: number;
  eliteKills: number;
}

export interface ArenaCheckpointState {
  runId: string;
  checkpoint: number;
  wave: number;
  totalWaves: number;
  outcome: 'ongoing' | 'victory' | 'defeat';
}

export interface MasteryState {
  level: number;
  exp: number;
}

export interface AdventureLogEntry {
  id: string;
  at: number;
  type: AdventureLogType;
  text: string;
}

export interface AdventureStatistics {
  battlesWon: number;
  battlesLost: number;
  totalKills: number;
  bossesKilled: number;
  damageDealt: number;
  damageTaken: number;
  goldEarned: number;
  goldSpent: number;
  potionsUsed: number;
  equipmentFound: number;
  equipmentSold: number;
  enhancements: number;
  skillUpgrades: number;
  offlineKills: number;
}

export interface AdventureState {
  version: number;
  resetGeneration: number;
  name: string;
  classId: CharacterClassId;
  level: number;
  exp: number;
  mastery: MasteryState;
  gold: number;
  hp: number;
  baseStats: CoreStats;
  statPoints: number;
  skillPoints: number;
  skillRanks: Record<SkillSlot, number>;
  skillLoadout: Array<SkillSlot | null>;
  equipment: Record<EquipmentSlot, EquipmentInstance | null>;
  inventory: EquipmentInstance[];
  runeInventory: Record<RuneId, number>;
  potions: number;
  currentRegionId: RegionId;
  combat: CombatState | null;
  arenaCheckpoint: ArenaCheckpointState | null;
  killCounts: Record<string, number>;
  bossKills: Record<RegionId, number>;
  discoveredItemKeys: string[];
  claimedQuestIds: string[];
  logs: AdventureLogEntry[];
  statistics: AdventureStatistics;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
}

export interface QuestReward {
  gold: number;
  exp: number;
  potions: number;
}

export type QuestObjective =
  | { type: 'totalKills'; target: number }
  | { type: 'level'; target: number }
  | { type: 'masteryLevel'; target: number }
  | { type: 'goldEarned'; target: number }
  | { type: 'bossKills'; target: number; regionId: RegionId }
  | { type: 'enhancements'; target: number }
  | { type: 'collection'; target: number };

export interface QuestDefinition {
  id: string;
  name: string;
  description: string;
  objective: QuestObjective;
  reward: QuestReward;
}

export const QUEST_DEFINITIONS: readonly QuestDefinition[] = [
  { id: 'first_hunt', name: '첫 사냥', description: '몬스터 1마리를 처치하세요.', objective: { type: 'totalKills', target: 1 }, reward: { gold: 80, exp: 35, potions: 1 } },
  { id: 'field_hunter', name: '들판 정리', description: '몬스터 10마리를 처치하세요.', objective: { type: 'totalKills', target: 10 }, reward: { gold: 220, exp: 90, potions: 2 } },
  { id: 'level_five', name: '숙련 모험가', description: '캐릭터 레벨 5를 달성하세요.', objective: { type: 'level', target: 5 }, reward: { gold: 350, exp: 140, potions: 2 } },
  { id: 'field_boss', name: '들판의 지배자', description: '황금갈기 왕멧돼지를 처치하세요.', objective: { type: 'bossKills', target: 1, regionId: 'sunnyField' }, reward: { gold: 500, exp: 220, potions: 3 } },
  { id: 'mastery_five', name: '직업의 이해', description: '직업 숙련도 5레벨을 달성하세요.', objective: { type: 'masteryLevel', target: 5 }, reward: { gold: 600, exp: 260, potions: 3 } },
  { id: 'earn_gold', name: '모험 자금', description: '누적 골드 획득량 5,000을 달성하세요.', objective: { type: 'goldEarned', target: 5000 }, reward: { gold: 1000, exp: 450, potions: 4 } },
  { id: 'enhance_three', name: '대장장이의 단골', description: '장비 강화를 누적 3회 진행하세요.', objective: { type: 'enhancements', target: 3 }, reward: { gold: 750, exp: 320, potions: 2 } },
  { id: 'forest_boss', name: '안개를 걷어낸 자', description: '천년 수호목을 처치하세요.', objective: { type: 'bossKills', target: 1, regionId: 'mistForest' }, reward: { gold: 1400, exp: 620, potions: 5 } },
  { id: 'ruins_boss', name: '왕국의 해방', description: '잊힌 왕의 갑주를 처치하세요.', objective: { type: 'bossKills', target: 1, regionId: 'ancientRuins' }, reward: { gold: 3200, exp: 1250, potions: 7 } },
  { id: 'dragon_boss', name: '용을 넘어선 자', description: '홍염룡 아르카드를 처치하세요.', objective: { type: 'bossKills', target: 1, regionId: 'dragonCrater' }, reward: { gold: 9000, exp: 3600, potions: 10 } },
  { id: 'collection_ten', name: '초보 수집가', description: '장비 도감 10종을 발견하세요.', objective: { type: 'collection', target: 10 }, reward: { gold: 400, exp: 180, potions: 2 } },
  { id: 'collection_hundred', name: '왕국의 수집가', description: '장비 도감 100종을 발견하세요.', objective: { type: 'collection', target: 100 }, reward: { gold: 3000, exp: 1200, potions: 6 } },
  { id: 'collection_thousand', name: '만물의 기록자', description: '장비 도감 1,000종을 발견하세요.', objective: { type: 'collection', target: 1000 }, reward: { gold: 25000, exp: 9000, potions: 20 } },
];

export const QUEST_BY_ID: Readonly<Record<string, QuestDefinition>> = Object.fromEntries(
  QUEST_DEFINITIONS.map((quest) => [quest.id, quest]),
);

export interface QuestProgress {
  quest: QuestDefinition;
  current: number;
  target: number;
  ratio: number;
  completed: boolean;
  claimed: boolean;
}

export interface CombatReward {
  exp: number;
  masteryExp: number;
  gold: number;
  drop: EquipmentInstance | null;
  runeDrop: RuneId | null;
  autoSoldGold: number;
  levelUps: number;
  masteryLevelUps: number;
  wave: number;
  totalWaves: number;
  enemyRank: EnemyRank;
  expeditionComplete: boolean;
}

export interface OfflineProgress {
  elapsedMs: number;
  cappedMs: number;
  hours: number;
  estimatedKills: number;
  exp: number;
  masteryExp: number;
  gold: number;
  regionId: RegionId;
  efficiency: number;
}

export interface AdventureResult {
  ok: boolean;
  state: AdventureState;
  events: string[];
  message?: string;
  outcome?: CombatOutcome;
  reward?: CombatReward;
  offlineProgress?: OfflineProgress;
}

export interface StartEncounterOptions {
  boss?: boolean;
  enemyId?: string;
  mode?: EncounterMode;
}

export interface ArenaKillOptions {
  runId?: string;
  checkpoint?: number;
  /** Damage received since the previous persisted arena checkpoint. */
  damageTaken?: number;
  /** Damage dealt since the previous persisted arena checkpoint. */
  damageDealt?: number;
  /** Authoritative local arena HP after damage, life-on-hit, and kill effects settle. */
  remainingHp?: number;
  elite?: boolean;
  rank?: Exclude<EnemyRank, 'boss'>;
  affixes?: readonly EliteAffix[];
  wave?: number;
  totalWaves?: number;
  /** Keeps a checkpointed real-time field run open while monsters replenish naturally. */
  continuous?: boolean;
  /** True only for the final rewarded enemy of the final wave. */
  expeditionComplete?: boolean;
}

export interface ArenaDefeatOptions {
  runId?: string;
  checkpoint?: number;
  /** Damage received since the previous persisted arena checkpoint. */
  damageTaken?: number;
  /** Damage dealt since the previous persisted arena checkpoint. */
  damageDealt?: number;
  wave?: number;
  totalWaves?: number;
}

const EMPTY_EQUIPMENT: Record<EquipmentSlot, null> = { weapon: null, armor: null, accessory: null };

const emptyStatistics = (): AdventureStatistics => ({
  battlesWon: 0,
  battlesLost: 0,
  totalKills: 0,
  bossesKilled: 0,
  damageDealt: 0,
  damageTaken: 0,
  goldEarned: 0,
  goldSpent: 0,
  potionsUsed: 0,
  equipmentFound: 0,
  equipmentSold: 0,
  enhancements: 0,
  skillUpgrades: 0,
  offlineKills: 0,
});

function createKillCounts(): Record<string, number> {
  return Object.fromEntries(Object.keys(ENEMY_DEFINITIONS).map((id) => [id, 0]));
}

function createBossKills(): Record<RegionId, number> {
  return { sunnyField: 0, mistForest: 0, ancientRuins: 0, dragonCrater: 0 };
}

function createLogId(now: number, index: number): string {
  return `log-${Math.floor(now).toString(36)}-${index.toString(36)}`;
}

export function createInitialState(classId: CharacterClassId = 'vanguard', name = '이름 없는 모험가', now = Date.now()): AdventureState {
  const selectedClass = CLASS_DEFINITIONS[classId] ? classId : 'vanguard';
  const selectedName = name.trim().slice(0, 16) || '이름 없는 모험가';
  const state: AdventureState = {
    version: ADVENTURE_SAVE_VERSION,
    resetGeneration: 0,
    name: selectedName,
    classId: selectedClass,
    level: 1,
    exp: 0,
    mastery: { level: 1, exp: 0 },
    gold: 120,
    hp: 1,
    baseStats: { ...CLASS_DEFINITIONS[selectedClass].startingStats },
    statPoints: 0,
    skillPoints: 0,
    skillRanks: createSkillSlotRecord((slot) => slot === 'skill1' ? 1 : 0),
    skillLoadout: ['skill1', null, null, null, null, null],
    equipment: { ...EMPTY_EQUIPMENT },
    inventory: [],
    runeInventory: createEmptyRuneInventory(),
    potions: 3,
    currentRegionId: 'sunnyField',
    combat: null,
    arenaCheckpoint: null,
    killCounts: createKillCounts(),
    bossKills: createBossKills(),
    discoveredItemKeys: [],
    claimedQuestIds: [],
    logs: [{ id: createLogId(now, 0), at: now, type: 'system', text: '모험가 길드에 등록했습니다. 첫 사냥을 시작해 보세요.' }],
    statistics: emptyStatistics(),
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
  };
  return { ...state, hp: deriveStats(state).maxHp };
}

export function expNeeded(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  const safeLevel = Math.max(1, Math.floor(level));
  return Math.floor(58 + 34 * Math.pow(safeLevel, 1.52));
}

export function masteryExpNeeded(level: number): number {
  if (level >= MAX_MASTERY_LEVEL) return 0;
  const safeLevel = Math.max(1, Math.floor(level));
  return Math.floor(90 + 52 * Math.pow(safeLevel, 1.38));
}

export interface GrowthProgress {
  level: number;
  exp: number;
  needed: number;
  ratio: number;
  maxed: boolean;
}

export function getLevelProgress(state: AdventureState): GrowthProgress {
  const needed = expNeeded(state.level);
  return { level: state.level, exp: state.exp, needed, ratio: needed > 0 ? Math.min(1, state.exp / needed) : 1, maxed: state.level >= MAX_LEVEL };
}

export function getMasteryProgress(state: AdventureState): GrowthProgress {
  const needed = masteryExpNeeded(state.mastery.level);
  return {
    level: state.mastery.level,
    exp: state.mastery.exp,
    needed,
    ratio: needed > 0 ? Math.min(1, state.mastery.exp / needed) : 1,
    maxed: state.mastery.level >= MAX_MASTERY_LEVEL,
  };
}

function addEquipmentStats(target: EquipmentStats, addition: EquipmentStats): EquipmentStats {
  return {
    maxHp: target.maxHp + addition.maxHp,
    attack: target.attack + addition.attack,
    defense: target.defense + addition.defense,
    crit: target.crit + addition.crit,
  };
}

export function getEffectiveEquipmentStats(item: EquipmentInstance): EquipmentStats {
  const enhance = Math.max(0, Math.min(MAX_ENHANCE, Math.floor(item.enhance)));
  const scale = 1 + enhance * 0.09;
  return {
    maxHp: item.stats.maxHp > 0 ? Math.floor(item.stats.maxHp * scale) + enhance * 2 : 0,
    attack: item.stats.attack > 0 ? Math.floor(item.stats.attack * scale) + Math.floor(enhance / 3) : 0,
    defense: item.stats.defense > 0 ? Math.floor(item.stats.defense * scale) + Math.floor(enhance / 3) : 0,
    crit: item.stats.crit > 0 ? item.stats.crit + Math.floor(enhance / 2) : 0,
  };
}

export function getTotalEquipmentStats(state: Pick<AdventureState, 'equipment'>): EquipmentStats {
  let total = zeroEquipmentStats();
  for (const slot of Object.keys(state.equipment) as EquipmentSlot[]) {
    const item = state.equipment[slot];
    if (item) total = addEquipmentStats(total, getEffectiveEquipmentStats(item));
  }
  return total;
}

export function deriveStats(state: Pick<AdventureState, 'classId' | 'level' | 'mastery' | 'baseStats' | 'skillRanks' | 'equipment'>): DerivedStats {
  const classDefinition = CLASS_DEFINITIONS[state.classId];
  const gear = getTotalEquipmentStats(state);
  const levelGrowth = Math.max(0, state.level - 1);
  const masteryGrowth = Math.max(0, state.mastery.level - 1);
  const maxHp = Math.floor(
    classDefinition.baseMaxHp + state.baseStats.vitality * 7 + levelGrowth * 5 + masteryGrowth * 2 + gear.maxHp,
  );
  const attack = Math.floor(
    classDefinition.baseAttack + state.baseStats.strength * 2 + levelGrowth * 1.25 + masteryGrowth * 0.6 + gear.attack,
  );
  const defense = Math.floor(
    classDefinition.baseDefense + state.baseStats.defense * 1.45 + levelGrowth * 0.65 + masteryGrowth * 0.35 + gear.defense,
  );
  const crit = Math.min(60, Math.floor(classDefinition.baseCrit + state.baseStats.agility * 0.75 + masteryGrowth * 0.12 + gear.crit));
  const skillPower = SKILL_SLOTS.reduce(
    (total, slot, index) => total + (state.skillRanks[slot] ?? 0) * (index + 2),
    0,
  );
  const power = Math.floor(maxHp * 0.22 + attack * 2.7 + defense * 2.2 + crit * 1.1 + skillPower);
  return { maxHp, attack, defense, crit, power };
}

export interface AdventureResolvedEffect {
  sourceType: 'unique' | 'set' | 'runeWord';
  sourceId: string;
  active: boolean;
  effect: AdventureSpecialEffect;
}

export interface AdventureCombatModifiers {
  damageMultiplier: number;
  damageTakenMultiplier: number;
  attackSpeedMultiplier: number;
  movementSpeedMultiplier: number;
  cooldownMultiplier: number;
  critChanceBonus: number;
  critDamageBonus: number;
  lifeOnHit: number;
  lifeOnKill: number;
  projectileCountBonus: number;
  projectilePierceBonus: number;
  projectileSpeedMultiplier: number;
  projectileDamageMultiplier: number;
  areaMultiplier: number;
  elementalDamageMultipliers: Record<AdventureElement, number>;
  elementalPenetration: Record<AdventureElement, number>;
  skillDamageMultipliers: Record<SkillSlot, number>;
  skillCooldownMultipliers: Record<SkillSlot, number>;
  skillRangeMultipliers: Record<SkillSlot, number>;
  effects: AdventureResolvedEffect[];
  activeRuneWords: RuneWordId[];
  activeSetBonuses: Array<{ setId: SetItemId; pieces: 2 | 3 }>;
  uniqueItems: UniqueItemId[];
}

export interface ResolveAdventureCombatModifierOptions {
  hpRatio?: number;
}

function createElementRecord(value: number): Record<AdventureElement, number> {
  return { physical: value, fire: value, cold: value, lightning: value, poison: value, arcane: value };
}

function applyPassiveModifiers(target: AdventureCombatModifiers, passive: AdventurePassiveModifiers): void {
  target.damageMultiplier *= 1 + Math.max(-0.9, passive.damageBonus ?? 0);
  target.damageTakenMultiplier *= 1 - clamp(passive.damageTakenReduction ?? 0, 0, 0.75);
  target.attackSpeedMultiplier *= 1 + Math.max(-0.75, passive.attackSpeedBonus ?? 0);
  target.movementSpeedMultiplier *= 1 + Math.max(-0.75, passive.movementSpeedBonus ?? 0);
  target.cooldownMultiplier *= 1 - clamp(passive.cooldownReduction ?? 0, 0, 0.75);
  target.lifeOnHit += Math.max(0, passive.lifeOnHit ?? 0);
  target.lifeOnKill += Math.max(0, passive.lifeOnKill ?? 0);
  target.critChanceBonus += passive.critChanceBonus ?? 0;
  target.critDamageBonus += passive.critDamageBonus ?? 0;
  target.projectileSpeedMultiplier *= 1 + Math.max(-0.75, passive.projectileSpeedBonus ?? 0);
  target.areaMultiplier *= 1 + Math.max(-0.75, passive.areaBonus ?? 0);
}

function applySpecialEffect(
  target: AdventureCombatModifiers,
  sourceType: AdventureResolvedEffect['sourceType'],
  sourceId: string,
  effect: AdventureSpecialEffect,
  hpRatio: number,
): void {
  const active = effect.kind !== 'lowLife' || hpRatio <= effect.threshold;
  target.effects.push({ sourceType, sourceId, active, effect });
  if (!active) return;
  if (effect.kind === 'lowLife') {
    target.damageMultiplier *= effect.damageMultiplier;
    target.damageTakenMultiplier *= effect.damageTakenMultiplier;
    target.lifeOnHit += effect.lifeOnHit ?? 0;
  } else if (effect.kind === 'projectile') {
    target.projectileCountBonus += effect.additionalProjectiles;
    target.projectilePierceBonus += effect.pierce;
    target.projectileSpeedMultiplier *= effect.speedMultiplier;
    target.projectileDamageMultiplier *= effect.damageMultiplier;
  } else if (effect.kind === 'elemental') {
    target.elementalDamageMultipliers[effect.element] *= effect.damageMultiplier;
    target.elementalPenetration[effect.element] += effect.penetration;
  } else if (effect.kind === 'skillModifier') {
    target.skillDamageMultipliers[effect.skill] *= effect.damageMultiplier;
    target.skillCooldownMultipliers[effect.skill] *= effect.cooldownMultiplier;
    target.skillRangeMultipliers[effect.skill] *= effect.rangeMultiplier;
  }
}

export function resolveAdventureCombatModifiers(
  state: Pick<AdventureState, 'equipment' | 'hp' | 'classId' | 'level' | 'mastery' | 'baseStats' | 'skillRanks'>,
  options: ResolveAdventureCombatModifierOptions = {},
): AdventureCombatModifiers {
  const maxHp = deriveStats(state).maxHp;
  const hpRatio = clamp(options.hpRatio ?? state.hp / Math.max(1, maxHp), 0, 1);
  const modifiers: AdventureCombatModifiers = {
    damageMultiplier: 1,
    damageTakenMultiplier: 1,
    attackSpeedMultiplier: 1,
    movementSpeedMultiplier: 1,
    cooldownMultiplier: 1,
    critChanceBonus: 0,
    critDamageBonus: 0,
    lifeOnHit: 0,
    lifeOnKill: 0,
    projectileCountBonus: 0,
    projectilePierceBonus: 0,
    projectileSpeedMultiplier: 1,
    projectileDamageMultiplier: 1,
    areaMultiplier: 1,
    elementalDamageMultipliers: createElementRecord(1),
    elementalPenetration: createElementRecord(0),
    skillDamageMultipliers: createSkillSlotRecord(() => 1),
    skillCooldownMultipliers: createSkillSlotRecord(() => 1),
    skillRangeMultipliers: createSkillSlotRecord(() => 1),
    effects: [],
    activeRuneWords: [],
    activeSetBonuses: [],
    uniqueItems: [],
  };
  const setCounts = new Map<SetItemId, number>();

  for (const slot of ALL_EQUIPMENT_SLOTS) {
    const item = state.equipment[slot];
    if (!item) continue;
    const tier = ITEM_TIER_BY_RARITY[item.rarity];
    const base = EQUIPMENT_BY_ID[item.definitionId];
    if (tier === 'unique' && base) {
      const uniqueId = item.uniqueId
        && UNIQUE_ITEM_DEFINITIONS[item.uniqueId]
        && isUniqueCompatible(UNIQUE_ITEM_DEFINITIONS[item.uniqueId], base, state.classId)
        ? item.uniqueId
        : selectUniqueItemId(item.itemKey, base);
      const unique = UNIQUE_ITEM_DEFINITIONS[uniqueId];
      modifiers.uniqueItems.push(uniqueId);
      applyPassiveModifiers(modifiers, unique.passive);
      for (const effect of unique.effects) applySpecialEffect(modifiers, 'unique', uniqueId, effect, hpRatio);
    }
    if (
      tier === 'set'
      && item.setId
      && SET_ITEM_DEFINITIONS[item.setId]
      && (!SET_ITEM_DEFINITIONS[item.setId].requiredClassId || SET_ITEM_DEFINITIONS[item.setId].requiredClassId === state.classId)
    ) {
      setCounts.set(item.setId, (setCounts.get(item.setId) ?? 0) + 1);
    }
    for (const runeId of item.socketedRunes ?? []) {
      const rune = RUNE_DEFINITIONS[runeId];
      if (rune) applyPassiveModifiers(modifiers, rune.passive);
    }
    const runeWord = resolveRuneWord({ ...item, tier });
    if (runeWord) {
      modifiers.activeRuneWords.push(runeWord.id);
      applyPassiveModifiers(modifiers, runeWord.passive);
      for (const effect of runeWord.effects) applySpecialEffect(modifiers, 'runeWord', runeWord.id, effect, hpRatio);
    }
  }

  for (const [setId, count] of setCounts) {
    const set = SET_ITEM_DEFINITIONS[setId];
    for (const bonus of set.bonuses) {
      if (count < bonus.pieces) continue;
      modifiers.activeSetBonuses.push({ setId, pieces: bonus.pieces });
      applyPassiveModifiers(modifiers, bonus.passive);
      for (const effect of bonus.effects) applySpecialEffect(modifiers, 'set', `${setId}:${bonus.pieces}`, effect, hpRatio);
    }
  }

  modifiers.damageTakenMultiplier = clamp(modifiers.damageTakenMultiplier, 0.1, 3);
  modifiers.cooldownMultiplier = clamp(modifiers.cooldownMultiplier, 0.25, 3);
  return modifiers;
}

export const RARITY_STAT_MULTIPLIERS: Record<EquipmentRarity, number> = {
  common: 1,
  uncommon: 1.13,
  rare: 1.31,
  epic: 1.56,
  legendary: 1.9,
};

export const RARITY_VALUE_MULTIPLIERS: Record<EquipmentRarity, number> = {
  common: 1,
  uncommon: 1.7,
  rare: 3.2,
  epic: 6.5,
  legendary: 14,
};

const MATERIAL_BY_ID: Readonly<Record<string, GearModifierDefinition>> = Object.fromEntries(
  GEAR_MATERIALS.map((part) => [part.id, part]),
);
const PREFIX_BY_ID: Readonly<Record<string, GearModifierDefinition>> = Object.fromEntries(
  GEAR_PREFIXES.map((part) => [part.id, part]),
);
const SUFFIX_BY_ID: Readonly<Record<string, GearModifierDefinition>> = Object.fromEntries(
  GEAR_SUFFIXES.map((part) => [part.id, part]),
);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeRandom(rng: RNG): number {
  const value = rng();
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 0.999999999999);
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function weightedPick<T>(items: readonly T[], weightFor: (item: T) => number, rng: RNG): T {
  const total = items.reduce((sum, item) => sum + Math.max(0, weightFor(item)), 0);
  if (total <= 0) return pickOne(items, rng);
  let cursor = safeRandom(rng) * total;
  for (const item of items) {
    cursor -= Math.max(0, weightFor(item));
    if (cursor < 0) return item;
  }
  return items[items.length - 1];
}

function isUniqueCompatible(
  unique: UniqueItemDefinition,
  base: EquipmentDefinition,
  classId?: CharacterClassId,
): boolean {
  return unique.slot === base.slot
    && (!unique.requiredClassId || unique.requiredClassId === classId || unique.requiredClassId === base.requiredClassId);
}

function selectUniqueItemId(itemKey: string, base: EquipmentDefinition): UniqueItemId {
  const candidates = UNIQUE_ITEM_IDS.filter((id) => {
    const definition = UNIQUE_ITEM_DEFINITIONS[id];
    return isUniqueCompatible(definition, base, base.requiredClassId);
  });
  const fallback = UNIQUE_ITEM_IDS.find((id) => UNIQUE_ITEM_DEFINITIONS[id].slot === base.slot) ?? UNIQUE_ITEM_IDS[0];
  return candidates.length > 0 ? candidates[stableHash(`${itemKey}:unique`) % candidates.length] : fallback;
}

function selectSetItemId(itemKey: string, classId?: CharacterClassId): SetItemId {
  const candidates = SET_ITEM_IDS.filter((id) => {
    const definition = SET_ITEM_DEFINITIONS[id];
    return !definition.requiredClassId || definition.requiredClassId === classId;
  });
  const pool = candidates.length > 0 ? candidates : SET_ITEM_IDS.filter((id) => !SET_ITEM_DEFINITIONS[id].requiredClassId);
  return pool[stableHash(`${itemKey}:set`) % pool.length];
}

export function deriveItemSocketCount(itemKey: string, tier: ItemTier, slot: EquipmentSlot): number {
  const hash = stableHash(`${itemKey}:${slot}:sockets`);
  if (tier === 'normal') return 2 + (hash % 2);
  if (tier === 'magic') return hash % 100 < 68 ? 1 + (hash % 2) : 0;
  if (tier === 'rare') return hash % 100 < 82 ? 1 + (hash % 2) : 0;
  if (tier === 'set') return 1 + (hash % 2);
  return 1;
}

export function resolveRuneWord(
  item: Pick<EquipmentInstance, 'definitionId' | 'tier' | 'socketCount' | 'socketedRunes'>,
): RuneWordDefinition | null {
  if (item.tier !== 'normal' || item.socketedRunes.length !== item.socketCount || item.socketCount < 2) return null;
  const slot = EQUIPMENT_BY_ID[item.definitionId]?.slot;
  if (!slot) return null;
  return RUNE_WORD_RECIPES.find((recipe) => (
    recipe.slots.includes(slot)
    && recipe.runes.length === item.socketedRunes.length
    && recipe.runes.every((runeId, index) => runeId === item.socketedRunes[index])
  )) ?? null;
}

export function randomInt(rng: RNG, min: number, max: number): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return low + Math.floor(safeRandom(rng) * (high - low + 1));
}

function pickOne<T>(items: readonly T[], rng: RNG): T {
  return items[Math.floor(safeRandom(rng) * items.length)];
}

function makeInstanceId(prefix: string, now: number, rng: RNG): string {
  const randomPart = Math.floor(safeRandom(rng) * 0x100000000).toString(36);
  return `${prefix}-${Math.floor(now).toString(36)}-${randomPart}`;
}

export function createItemKey(
  definitionId: string,
  materialId: string,
  prefixId: string,
  suffixId: string,
  rarity: EquipmentRarity,
  quality: GearQuality,
): string {
  return [definitionId, materialId, prefixId, suffixId, rarity, quality].join(':');
}

export interface GearDisplay {
  itemKey: string;
  name: string;
  description: string;
  icon: string;
  slot: EquipmentSlot;
  slotLabel: string;
  rarity: EquipmentRarity;
  rarityLabel: string;
  tier: ItemTier;
  tierLabel: string;
  quality: GearQuality;
  qualityLabel: string;
  requiredClassId?: CharacterClassId;
  regionId: RegionId;
  setId: SetItemId | null;
  uniqueId: UniqueItemId | null;
  runeWordId: RuneWordId | null;
}

export function getGearDisplay(item: EquipmentInstance): GearDisplay {
  const base = EQUIPMENT_BY_ID[item.definitionId] ?? EQUIPMENT_DEFINITIONS[0];
  const material = MATERIAL_BY_ID[item.materialId] ?? GEAR_MATERIALS[0];
  const prefix = PREFIX_BY_ID[item.prefixId] ?? GEAR_PREFIXES[0];
  const suffix = SUFFIX_BY_ID[item.suffixId] ?? GEAR_SUFFIXES[0];
  const quality = GEAR_QUALITIES[item.quality] ?? GEAR_QUALITIES.standard;
  const tier = ITEM_TIER_BY_RARITY[item.rarity];
  const uniqueId = tier === 'unique'
    ? (item.uniqueId && UNIQUE_ITEM_DEFINITIONS[item.uniqueId] && isUniqueCompatible(UNIQUE_ITEM_DEFINITIONS[item.uniqueId], base)
        ? item.uniqueId
        : selectUniqueItemId(item.itemKey, base))
    : null;
  const setId = tier === 'set' && item.setId && SET_ITEM_DEFINITIONS[item.setId] ? item.setId : null;
  const unique = uniqueId ? UNIQUE_ITEM_DEFINITIONS[uniqueId] : null;
  const set = setId ? SET_ITEM_DEFINITIONS[setId] : null;
  const runeWord = resolveRuneWord({ ...item, tier });
  const qualityPrefix = item.quality === 'standard' ? '' : `${quality.name} `;
  const generatedName = tier === 'normal'
    ? `${qualityPrefix}${material.name} ${base.name}`
    : `${qualityPrefix}${prefix.name} ${material.name} ${base.name} · ${suffix.name}`;
  const generatedDescription = tier === 'normal'
    ? `${material.description}로 만든 소켓 바탕 장비입니다.`
    : `${material.description}, ${prefix.description} 장비에 ${suffix.description}이 깃들었습니다.`;
  return {
    itemKey: item.itemKey,
    name: runeWord
      ? `${runeWord.name} ${base.name}`
      : unique
        ? unique.name
        : set
          ? `${set.name} ${base.name}`
          : generatedName,
    description: runeWord?.effects[0].name
      ? `${runeWord.name} 룬어: ${runeWord.effects[0].name} 효과가 활성화됩니다.`
      : unique?.description ?? set?.description ?? generatedDescription,
    icon: base.icon,
    slot: base.slot,
    slotLabel: EQUIPMENT_SLOT_LABELS[base.slot],
    rarity: item.rarity,
    rarityLabel: ITEM_TIER_LABELS[tier],
    tier,
    tierLabel: ITEM_TIER_LABELS[tier],
    quality: item.quality,
    qualityLabel: quality.name,
    requiredClassId: base.requiredClassId,
    regionId: base.regionId,
    setId,
    uniqueId,
    runeWordId: runeWord?.id ?? null,
  };
}

export function getGearDisplayFromItemKey(itemKey: string): GearDisplay | null {
  const [definitionId, materialId, prefixId, suffixId, rarityValue, qualityValue, ...rest] = itemKey.split(':');
  if (rest.length > 0) return null;
  if (!EQUIPMENT_BY_ID[definitionId] || !MATERIAL_BY_ID[materialId] || !PREFIX_BY_ID[prefixId] || !SUFFIX_BY_ID[suffixId]) return null;
  if (GEAR_MATERIALS.findIndex((material) => material.id === materialId) >= materialVarietiesForRegion(EQUIPMENT_BY_ID[definitionId].regionId)) return null;
  if (!RARITY_IDS.includes(rarityValue as EquipmentRarity) || !GEAR_QUALITY_IDS.includes(qualityValue as GearQuality)) return null;
  const rarity = rarityValue as EquipmentRarity;
  const tier = ITEM_TIER_BY_RARITY[rarity];
  const base = EQUIPMENT_BY_ID[definitionId];
  const setId = tier === 'set' ? selectSetItemId(itemKey, base.requiredClassId) : null;
  const uniqueId = tier === 'unique' ? selectUniqueItemId(itemKey, base) : null;
  const placeholder: EquipmentInstance = {
    instanceId: '도감',
    itemKey,
    definitionId,
    materialId,
    prefixId,
    suffixId,
    rarity,
    tier,
    quality: qualityValue as GearQuality,
    itemLevel: 1,
    level: 1,
    enhance: 0,
    stats: zeroEquipmentStats(),
    socketCount: deriveItemSocketCount(itemKey, tier, base.slot),
    socketedRunes: [],
    setId,
    uniqueId,
    acquiredAt: 0,
  };
  return getGearDisplay(placeholder);
}

export function rollItemTier(rng: RNG, regionId: RegionId, boss = false, elite = false): ItemTier {
  const weights = getItemTierDropWeights(regionId, boss, elite);
  return weightedPick(ITEM_TIER_IDS, (tier) => weights[tier], rng);
}

function rollRarity(rng: RNG, regionId: RegionId, boss: boolean): EquipmentRarity {
  return RARITY_BY_ITEM_TIER[rollItemTier(rng, regionId, boss)];
}

function rollQuality(rng: RNG, boss: boolean): GearQuality {
  const roll = safeRandom(rng) - (boss ? 0.12 : 0);
  if (roll < 0.08) return 'masterwork';
  if (roll < 0.36) return 'refined';
  return 'standard';
}

function calculateGeneratedStats(
  base: EquipmentDefinition,
  material: GearModifierDefinition,
  prefix: GearModifierDefinition,
  suffix: GearModifierDefinition,
  rarity: EquipmentRarity,
  quality: GearQuality,
  level: number,
): EquipmentStats {
  const regionLevel = REGION_DEFINITIONS[base.regionId].unlockLevel;
  const levelScale = 1 + Math.max(0, level - regionLevel) * 0.018;
  const tier = ITEM_TIER_BY_RARITY[rarity];
  const hasAffixes = tier !== 'normal';
  const componentScale = material.statScale * (hasAffixes ? prefix.statScale * suffix.statScale : 1);
  const totalScale = RARITY_STAT_MULTIPLIERS[rarity] * GEAR_QUALITIES[quality].statScale * levelScale * componentScale;
  const additiveScale = 0.7 + REGION_IDS.indexOf(base.regionId) * 0.42;
  const valueFor = (stat: keyof EquipmentStats): number => {
    const affixBonus = hasAffixes ? prefix.statBonus[stat] + suffix.statBonus[stat] : 0;
    const raw = base.baseStats[stat] + (material.statBonus[stat] + affixBonus) * additiveScale;
    return Math.max(0, Math.round(raw * totalScale));
  };
  return { maxHp: valueFor('maxHp'), attack: valueFor('attack'), defense: valueFor('defense'), crit: valueFor('crit') };
}

export interface GenerateGearOptions {
  classId: CharacterClassId;
  regionId: RegionId;
  level: number;
  slot?: EquipmentSlot;
  forcedRarity?: EquipmentRarity;
  forcedTier?: ItemTier;
  forcedQuality?: GearQuality;
  boss?: boolean;
  now?: number;
  rng?: RNG;
}

export function generateGear(options: GenerateGearOptions): EquipmentInstance {
  const rng = options.rng ?? Math.random;
  const now = options.now ?? Date.now();
  const validClassId = CLASS_DEFINITIONS[options.classId] ? options.classId : 'vanguard';
  const validRegionId = REGION_DEFINITIONS[options.regionId] ? options.regionId : 'sunnyField';
  let pool = EQUIPMENT_DEFINITIONS.filter(
    (definition) => definition.regionId === validRegionId && (!definition.requiredClassId || definition.requiredClassId === validClassId),
  );
  if (options.slot) pool = pool.filter((definition) => definition.slot === options.slot);
  if (pool.length === 0) {
    pool = EQUIPMENT_DEFINITIONS.filter(
      (definition) => !definition.requiredClassId || definition.requiredClassId === validClassId,
    );
  }
  const base = pickOne(pool, rng);
  const regionIndex = REGION_IDS.indexOf(validRegionId);
  const materialPool = GEAR_MATERIALS.slice(0, Math.min(GEAR_MATERIALS.length, 3 + regionIndex * 2));
  const material = pickOne(materialPool, rng);
  const rarity = options.forcedRarity
    ?? (options.forcedTier ? RARITY_BY_ITEM_TIER[options.forcedTier] : rollRarity(rng, validRegionId, Boolean(options.boss)));
  const tier = ITEM_TIER_BY_RARITY[rarity];
  const quality = options.forcedQuality ?? rollQuality(rng, Boolean(options.boss));
  const itemLevel = clamp(Math.floor(options.level), 1, MAX_LEVEL);
  const prefixPool = getGearAffixPool('prefix', itemLevel, base.slot, tier);
  const suffixPool = getGearAffixPool('suffix', itemLevel, base.slot, tier);
  const prefixEntry = prefixPool.length > 0 ? weightedPick(prefixPool, (entry) => entry.weight, rng) : GEAR_AFFIX_POOLS.prefix[0];
  const suffixEntry = suffixPool.length > 0 ? weightedPick(suffixPool, (entry) => entry.weight, rng) : GEAR_AFFIX_POOLS.suffix[0];
  const prefix = PREFIX_BY_ID[prefixEntry.id];
  const suffix = SUFFIX_BY_ID[suffixEntry.id];
  const itemKey = createItemKey(base.id, material.id, prefix.id, suffix.id, rarity, quality);
  const setId = tier === 'set' ? selectSetItemId(itemKey, validClassId) : null;
  const uniqueId = tier === 'unique' ? selectUniqueItemId(itemKey, base) : null;
  return {
    instanceId: makeInstanceId('gear', now, rng),
    itemKey,
    definitionId: base.id,
    materialId: material.id,
    prefixId: prefix.id,
    suffixId: suffix.id,
    rarity,
    tier,
    quality,
    itemLevel,
    level: itemLevel,
    enhance: 0,
    stats: calculateGeneratedStats(base, material, prefix, suffix, rarity, quality, itemLevel),
    socketCount: deriveItemSocketCount(itemKey, tier, base.slot),
    socketedRunes: [],
    setId,
    uniqueId,
    acquiredAt: now,
  };
}

export function getEnhancementCost(item: EquipmentInstance): number {
  if (item.enhance >= MAX_ENHANCE) return 0;
  const rarityScale = RARITY_VALUE_MULTIPLIERS[item.rarity];
  const qualityScale = GEAR_QUALITIES[item.quality].valueScale;
  return Math.max(40, Math.floor((36 + item.level * 13) * rarityScale * qualityScale * Math.pow(item.enhance + 1, 1.42)));
}

export function getGearSellPrice(item: EquipmentInstance): number {
  const rarityScale = RARITY_VALUE_MULTIPLIERS[item.rarity];
  const qualityScale = GEAR_QUALITIES[item.quality].valueScale;
  const enhancementValue = item.enhance > 0 ? getEnhancementCost({ ...item, enhance: item.enhance - 1 }) * 0.28 : 0;
  return Math.max(8, Math.floor((10 + item.level * 7) * rarityScale * qualityScale + enhancementValue));
}

function appendLogs(state: AdventureState, events: readonly string[], type: AdventureLogType, now: number): AdventureState {
  if (events.length === 0) return { ...state, version: ADVENTURE_SAVE_VERSION, updatedAt: now, lastActiveAt: now };
  const entries = events.map((text, index) => ({ id: createLogId(now, state.logs.length + index), at: now, type, text }));
  return {
    ...state,
    version: ADVENTURE_SAVE_VERSION,
    logs: [...state.logs, ...entries].slice(-MAX_LOG_ENTRIES),
    updatedAt: now,
    lastActiveAt: now,
  };
}

function successfulResult(
  state: AdventureState,
  events: string[],
  now: number,
  type: AdventureLogType,
  extras: Partial<Omit<AdventureResult, 'ok' | 'state' | 'events'>> = {},
): AdventureResult {
  return { ok: true, state: appendLogs(state, events, type, now), events, ...extras };
}

function failedResult(state: AdventureState, message: string): AdventureResult {
  return { ok: false, state, events: [], message };
}

interface GrowthGrantResult {
  state: AdventureState;
  levelUps: number;
  events: string[];
}

function grantExperience(state: AdventureState, amount: number): GrowthGrantResult {
  let level = state.level;
  let exp = state.exp + Math.max(0, Math.floor(amount));
  let levelUps = 0;
  const oldMaxHp = deriveStats(state).maxHp;
  while (level < MAX_LEVEL) {
    const needed = expNeeded(level);
    if (needed <= 0 || exp < needed) break;
    exp -= needed;
    level += 1;
    levelUps += 1;
  }
  if (level >= MAX_LEVEL) exp = 0;
  let next: AdventureState = {
    ...state,
    level,
    exp,
    statPoints: state.statPoints + levelUps * 3,
    skillPoints: state.skillPoints + levelUps,
  };
  if (levelUps > 0) {
    const newMaxHp = deriveStats(next).maxHp;
    next = { ...next, hp: Math.min(newMaxHp, next.hp + Math.max(0, newMaxHp - oldMaxHp)) };
  }
  return {
    state: next,
    levelUps,
    events: levelUps > 0 ? [`레벨 ${level} 달성! 능력치 포인트 ${levelUps * 3}개와 스킬 포인트 ${levelUps}개를 얻었습니다.`] : [],
  };
}

function grantMasteryExperience(state: AdventureState, amount: number): GrowthGrantResult {
  let level = state.mastery.level;
  let exp = state.mastery.exp + Math.max(0, Math.floor(amount));
  let levelUps = 0;
  while (level < MAX_MASTERY_LEVEL) {
    const needed = masteryExpNeeded(level);
    if (needed <= 0 || exp < needed) break;
    exp -= needed;
    level += 1;
    levelUps += 1;
  }
  if (level >= MAX_MASTERY_LEVEL) exp = 0;
  return {
    state: { ...state, mastery: { level, exp }, skillPoints: state.skillPoints + levelUps },
    levelUps,
    events: levelUps > 0 ? [`${CLASS_DEFINITIONS[state.classId].name} 숙련도 ${level} 달성! 스킬 포인트 ${levelUps}개를 얻었습니다.`] : [],
  };
}

export interface EquipmentDisplay extends GearDisplay {
  stats: EquipmentStats;
  value: number;
  enhance: number;
  level: number;
}

export function getEquipmentDisplay(item: EquipmentInstance): EquipmentDisplay {
  return {
    ...getGearDisplay(item),
    stats: getEffectiveEquipmentStats(item),
    value: getGearSellPrice(item),
    enhance: item.enhance,
    level: item.level,
  };
}

export function getSkillUpgradeCost(state: AdventureState, skill: SkillSlot): number {
  if (!isSkillSlot(skill)) return 0;
  const rank = state.skillRanks[skill] ?? 0;
  const definition = CLASS_DEFINITIONS[state.classId].skills[skill];
  if (rank >= definition.maxRank) return 0;
  return 1;
}

export function allocateStat(state: AdventureState, stat: CoreStatId, amount = 1, now = Date.now()): AdventureResult {
  if (state.combat) return failedResult(state, '전투 중에는 능력치를 배분할 수 없습니다.');
  if (!Object.prototype.hasOwnProperty.call(CORE_STAT_LABELS, stat)) return failedResult(state, '올바르지 않은 능력치입니다.');
  const points = Math.floor(amount);
  if (points < 1) return failedResult(state, '배분할 포인트는 1 이상이어야 합니다.');
  if (state.statPoints < points) return failedResult(state, '능력치 포인트가 부족합니다.');
  const oldMaxHp = deriveStats(state).maxHp;
  let next: AdventureState = {
    ...state,
    statPoints: state.statPoints - points,
    baseStats: { ...state.baseStats, [stat]: state.baseStats[stat] + points },
  };
  const newMaxHp = deriveStats(next).maxHp;
  if (newMaxHp > oldMaxHp) next = { ...next, hp: Math.min(newMaxHp, next.hp + newMaxHp - oldMaxHp) };
  const event = `${CORE_STAT_LABELS[stat]}에 ${points}포인트를 배분했습니다.`;
  return successfulResult(next, [event], now, 'growth');
}

export function upgradeSkill(state: AdventureState, skill: SkillSlot, now = Date.now()): AdventureResult {
  if (state.combat) return failedResult(state, '전투 중에는 기술을 강화할 수 없습니다.');
  if (!isSkillSlot(skill)) return failedResult(state, '올바르지 않은 기술입니다.');
  const definition = CLASS_DEFINITIONS[state.classId].skills[skill];
  if (state.level < definition.unlockLevel) return failedResult(state, `레벨 ${definition.unlockLevel}에 해금되는 기술입니다.`);
  const currentRank = state.skillRanks[skill] ?? 0;
  if (currentRank >= definition.maxRank) return failedResult(state, '이미 최고 등급인 기술입니다.');
  const cost = getSkillUpgradeCost(state, skill);
  if (state.skillPoints < cost) return failedResult(state, '스킬 포인트가 부족합니다.');
  const nextRank = currentRank + 1;
  const skillLoadout = [...state.skillLoadout];
  if (currentRank === 0 && !skillLoadout.includes(skill)) {
    const emptyIndex = skillLoadout.findIndex((entry) => entry === null);
    if (emptyIndex >= 0) skillLoadout[emptyIndex] = skill;
  }
  const next: AdventureState = {
    ...state,
    skillPoints: state.skillPoints - cost,
    skillRanks: { ...state.skillRanks, [skill]: nextRank },
    skillLoadout,
    statistics: {
      ...state.statistics,
      skillUpgrades: state.statistics.skillUpgrades + 1,
    },
  };
  return successfulResult(next, [`${definition.name}을(를) ${nextRank}단계로 강화했습니다.`], now, 'growth');
}

export function setSkillLoadoutSlot(
  state: AdventureState,
  index: number,
  skill: SkillSlot | null,
  now = Date.now(),
): AdventureResult {
  if (state.combat) return failedResult(state, '전투 중에는 기술 슬롯을 변경할 수 없습니다.');
  if (!Number.isInteger(index) || index < 0 || index >= SKILL_LOADOUT_SIZE) {
    return failedResult(state, '올바르지 않은 기술 슬롯입니다.');
  }
  if (skill !== null && !isSkillSlot(skill)) return failedResult(state, '올바르지 않은 기술입니다.');

  const loadout = Array.from({ length: SKILL_LOADOUT_SIZE }, (_, slotIndex) => state.skillLoadout[slotIndex] ?? null);
  const current = loadout[index] ?? null;
  if (skill === null) {
    if (!current) return failedResult(state, '비울 기술이 없습니다.');
    if (loadout.filter(Boolean).length <= 1) return failedResult(state, '최소 한 개의 기술은 장착해야 합니다.');
    loadout[index] = null;
    return successfulResult(
      { ...state, skillLoadout: loadout },
      [`${CLASS_DEFINITIONS[state.classId].skills[current].name}을(를) 전투 슬롯에서 해제했습니다.`],
      now,
      'growth',
    );
  }

  const definition = CLASS_DEFINITIONS[state.classId].skills[skill];
  if (state.level < definition.unlockLevel || (state.skillRanks[skill] ?? 0) <= 0) {
    return failedResult(state, '해금하고 습득한 기술만 장착할 수 있습니다.');
  }
  const existingIndex = loadout.indexOf(skill);
  if (existingIndex === index) return failedResult(state, '이미 이 슬롯에 장착된 기술입니다.');

  if (existingIndex >= 0) [loadout[index], loadout[existingIndex]] = [loadout[existingIndex], loadout[index]];
  else loadout[index] = skill;

  return successfulResult(
    { ...state, skillLoadout: loadout },
    [`${definition.name}을(를) 전투 슬롯 ${index + 1}에 장착했습니다.`],
    now,
    'growth',
  );
}

function findInventoryItem(state: AdventureState, instanceId: string): { item: EquipmentInstance; index: number } | null {
  const index = state.inventory.findIndex((item) => item.instanceId === instanceId);
  return index >= 0 ? { item: state.inventory[index], index } : null;
}

export function equipItem(state: AdventureState, instanceId: string, now = Date.now()): AdventureResult {
  if (state.combat) return failedResult(state, '전투 중에는 장비를 교체할 수 없습니다.');
  const found = findInventoryItem(state, instanceId);
  if (!found) return failedResult(state, '가방에서 장비를 찾을 수 없습니다.');
  const display = getGearDisplay(found.item);
  if (display.requiredClassId && display.requiredClassId !== state.classId) {
    return failedResult(state, `${CLASS_DEFINITIONS[display.requiredClassId].name} 전용 장비입니다.`);
  }
  const inventory = state.inventory.filter((_, index) => index !== found.index);
  const previous = state.equipment[display.slot];
  if (previous) inventory.push(previous);
  const next: AdventureState = {
    ...state,
    equipment: { ...state.equipment, [display.slot]: found.item },
    inventory,
  };
  const capped = { ...next, hp: Math.min(next.hp, deriveStats(next).maxHp) };
  return successfulResult(capped, [`${getGearDisplay(found.item).name}을(를) 장착했습니다.`], now, 'growth');
}

export function sellItem(state: AdventureState, instanceId: string, now = Date.now()): AdventureResult {
  if (state.combat) return failedResult(state, '전투 중에는 장비를 판매할 수 없습니다.');
  const found = findInventoryItem(state, instanceId);
  if (!found) return failedResult(state, '판매할 장비를 찾을 수 없습니다.');
  const value = getGearSellPrice(found.item);
  const next: AdventureState = {
    ...state,
    gold: state.gold + value,
    inventory: state.inventory.filter((_, index) => index !== found.index),
    statistics: {
      ...state.statistics,
      goldEarned: state.statistics.goldEarned + value,
      equipmentSold: state.statistics.equipmentSold + 1,
    },
  };
  return successfulResult(next, [`${getGearDisplay(found.item).name}을(를) 팔아 ${value.toLocaleString()} 골드를 얻었습니다.`], now, 'reward');
}

export function enhanceGear(state: AdventureState, instanceId: string, now = Date.now()): AdventureResult {
  if (state.combat) return failedResult(state, '전투 중에는 장비를 강화할 수 없습니다.');
  let target: EquipmentInstance | null = state.inventory.find((item) => item.instanceId === instanceId) ?? null;
  if (!target) {
    for (const slot of Object.keys(state.equipment) as EquipmentSlot[]) {
      if (state.equipment[slot]?.instanceId === instanceId) target = state.equipment[slot];
    }
  }
  if (!target) return failedResult(state, '강화할 장비를 찾을 수 없습니다.');
  if (target.enhance >= MAX_ENHANCE) return failedResult(state, '이미 +10 강화에 도달했습니다.');
  const cost = getEnhancementCost(target);
  if (state.gold < cost) return failedResult(state, `강화 비용이 부족합니다. (${cost.toLocaleString()} 골드)`);
  const enhanced: EquipmentInstance = { ...target, enhance: target.enhance + 1 };
  const inventory = state.inventory.map((item) => item.instanceId === instanceId ? enhanced : item);
  const equipment = { ...state.equipment };
  for (const slot of Object.keys(equipment) as EquipmentSlot[]) {
    if (equipment[slot]?.instanceId === instanceId) equipment[slot] = enhanced;
  }
  const next: AdventureState = {
    ...state,
    gold: state.gold - cost,
    inventory,
    equipment,
    statistics: {
      ...state.statistics,
      goldSpent: state.statistics.goldSpent + cost,
      enhancements: state.statistics.enhancements + 1,
    },
  };
  return successfulResult(next, [`${getGearDisplay(enhanced).name} +${enhanced.enhance} 강화에 성공했습니다.`], now, 'growth');
}

export function insertRuneIntoItem(
  state: AdventureState,
  instanceId: string,
  runeId: RuneId,
  now = Date.now(),
): AdventureResult {
  if (state.combat) return failedResult(state, '전투 중에는 룬을 장착할 수 없습니다.');
  if (!RUNE_IDS.includes(runeId)) return failedResult(state, '존재하지 않는 룬입니다.');
  if ((state.runeInventory[runeId] ?? 0) < 1) return failedResult(state, `${RUNE_DEFINITIONS[runeId].name}이 부족합니다.`);

  let target = state.inventory.find((item) => item.instanceId === instanceId) ?? null;
  if (!target) {
    for (const slot of ALL_EQUIPMENT_SLOTS) {
      if (state.equipment[slot]?.instanceId === instanceId) target = state.equipment[slot];
    }
  }
  if (!target) return failedResult(state, '룬을 장착할 장비를 찾을 수 없습니다.');
  if (target.itemLevel < RUNE_DEFINITIONS[runeId].minItemLevel) {
    return failedResult(state, `${RUNE_DEFINITIONS[runeId].name}은(는) 아이템 레벨 ${RUNE_DEFINITIONS[runeId].minItemLevel} 이상 장비에만 장착할 수 있습니다.`);
  }
  const socketCount = clamp(Math.floor(target.socketCount), 0, MAX_ITEM_SOCKETS);
  if (socketCount < 1) return failedResult(state, '이 장비에는 룬 소켓이 없습니다.');
  if (target.socketedRunes.length >= socketCount) return failedResult(state, '모든 룬 소켓이 이미 채워졌습니다.');

  const socketed: EquipmentInstance = {
    ...target,
    tier: ITEM_TIER_BY_RARITY[target.rarity],
    socketCount,
    socketedRunes: [...target.socketedRunes, runeId],
  };
  const inventory = state.inventory.map((item) => item.instanceId === instanceId ? socketed : item);
  const equipment = { ...state.equipment };
  for (const slot of ALL_EQUIPMENT_SLOTS) {
    if (equipment[slot]?.instanceId === instanceId) equipment[slot] = socketed;
  }
  const runeInventory = { ...state.runeInventory, [runeId]: state.runeInventory[runeId] - 1 };
  const runeWord = resolveRuneWord(socketed);
  const events = [`${RUNE_DEFINITIONS[runeId].name}을(를) ${getGearDisplay(socketed).name}에 순서대로 장착했습니다.`];
  if (runeWord) events.push(`룬어 '${runeWord.name}'이(가) 완성되어 ${runeWord.effects[0].name} 효과가 활성화됐습니다.`);
  return successfulResult({ ...state, inventory, equipment, runeInventory }, events, now, 'growth');
}

export const socketRune = insertRuneIntoItem;

export function isRegionUnlocked(state: Pick<AdventureState, 'level'>, regionId: RegionId): boolean {
  return state.level >= REGION_DEFINITIONS[regionId].unlockLevel;
}

export function changeRegion(state: AdventureState, regionId: RegionId, now = Date.now()): AdventureResult {
  if (state.combat) return failedResult(state, '전투 중에는 지역을 이동할 수 없습니다.');
  const region = REGION_DEFINITIONS[regionId];
  if (!region) return failedResult(state, '존재하지 않는 지역입니다.');
  if (!isRegionUnlocked(state, regionId)) return failedResult(state, `레벨 ${region.unlockLevel}에 해금되는 지역입니다.`);
  if (state.currentRegionId === regionId) return failedResult(state, '이미 머무르고 있는 지역입니다.');
  return successfulResult({ ...state, currentRegionId: regionId }, [`${region.name}(으)로 이동했습니다.`], now, 'system');
}

export type RestMethod = 'free' | 'gold';

export function getRestCost(state: AdventureState): number {
  const stats = deriveStats(state);
  const missingRatio = Math.max(0, stats.maxHp - state.hp) / stats.maxHp;
  return Math.max(20, Math.ceil((25 + state.level * 9) * missingRatio));
}

export function restAtTown(state: AdventureState, method: RestMethod = 'free', now = Date.now()): AdventureResult {
  if (state.combat) return failedResult(state, '전투 중에는 휴식할 수 없습니다.');
  const maxHp = deriveStats(state).maxHp;
  if (state.hp >= maxHp) return failedResult(state, '이미 체력이 가득합니다.');
  if (method === 'free') {
    const targetHp = Math.ceil(maxHp * 0.5);
    if (state.hp >= targetHp) return failedResult(state, '무료 응급 치료는 체력을 50%까지만 회복합니다.');
    return successfulResult({ ...state, hp: targetHp }, ['길드 응급 치료로 체력을 50%까지 회복했습니다.'], now, 'system');
  }
  const cost = getRestCost(state);
  if (state.gold < cost) return failedResult(state, `숙박비가 부족합니다. (${cost.toLocaleString()} 골드)`);
  const next: AdventureState = {
    ...state,
    hp: maxHp,
    gold: state.gold - cost,
    statistics: { ...state.statistics, goldSpent: state.statistics.goldSpent + cost },
  };
  return successfulResult(next, [`여관에서 쉬어 체력을 모두 회복했습니다. (-${cost.toLocaleString()} 골드)`], now, 'system');
}

export function getBossProgress(state: AdventureState, regionId: RegionId = state.currentRegionId): { current: number; required: number; available: boolean } {
  const region = REGION_DEFINITIONS[regionId];
  const regularKills = region.enemyIds.reduce((sum, enemyId) => sum + (state.killCounts[enemyId] ?? 0), 0);
  const required = BOSS_KILLS_REQUIRED * ((state.bossKills[regionId] ?? 0) + 1);
  return { current: Math.min(regularKills, required), required, available: regularKills >= required };
}

function questCurrentValue(state: AdventureState, objective: QuestObjective): number {
  switch (objective.type) {
    case 'totalKills': return state.statistics.totalKills;
    case 'level': return state.level;
    case 'masteryLevel': return state.mastery.level;
    case 'goldEarned': return state.statistics.goldEarned;
    case 'bossKills': return state.bossKills[objective.regionId];
    case 'enhancements': return state.statistics.enhancements;
    case 'collection': return state.discoveredItemKeys.length;
  }
}

export function getQuestProgress(state: AdventureState, questId: string): QuestProgress | null {
  const quest = QUEST_BY_ID[questId];
  if (!quest) return null;
  const current = questCurrentValue(state, quest.objective);
  const target = quest.objective.target;
  return {
    quest,
    current: Math.min(current, target),
    target,
    ratio: Math.min(1, current / target),
    completed: current >= target,
    claimed: state.claimedQuestIds.includes(questId),
  };
}

export function getAllQuestProgress(state: AdventureState): QuestProgress[] {
  return QUEST_DEFINITIONS.map((quest) => getQuestProgress(state, quest.id)).filter((progress): progress is QuestProgress => progress !== null);
}

export function claimQuest(state: AdventureState, questId: string, now = Date.now()): AdventureResult {
  const progress = getQuestProgress(state, questId);
  if (!progress) return failedResult(state, '존재하지 않는 퀘스트입니다.');
  if (progress.claimed) return failedResult(state, '이미 보상을 받은 퀘스트입니다.');
  if (!progress.completed) return failedResult(state, '아직 퀘스트 목표를 달성하지 못했습니다.');
  const reward = progress.quest.reward;
  let next: AdventureState = {
    ...state,
    gold: state.gold + reward.gold,
    potions: state.potions + reward.potions,
    claimedQuestIds: [...state.claimedQuestIds, questId],
    statistics: { ...state.statistics, goldEarned: state.statistics.goldEarned + reward.gold },
  };
  const growth = grantExperience(next, reward.exp);
  next = growth.state;
  const events = [
    `${progress.quest.name} 완료 보상: ${reward.gold.toLocaleString()} 골드, 경험치 ${reward.exp}, 물약 ${reward.potions}개`,
    ...growth.events,
  ];
  return successfulResult(next, events, now, 'quest');
}

export function getOfflineProgress(state: AdventureState, now = Date.now()): OfflineProgress {
  const maxOfflineMs = MAX_OFFLINE_HOURS * 60 * 60 * 1000;
  const elapsedMs = Math.max(0, now - state.lastActiveAt);
  const cappedMs = Math.min(elapsedMs, maxOfflineMs);
  const hours = cappedMs / 3_600_000;
  const region = REGION_DEFINITIONS[state.currentRegionId];
  const powerRatio = deriveStats(state).power / Math.max(1, region.recommendedPower);
  const efficiency = clamp(Math.sqrt(powerRatio), 0.25, 1.65);
  const estimatedKills = cappedMs < 60_000 ? 0 : Math.floor(hours * 18 * efficiency);
  const enemies = region.enemyIds.map((id) => ENEMY_DEFINITIONS[id]);
  const average = (select: (enemy: EnemyDefinition) => number): number => enemies.reduce((sum, enemy) => sum + select(enemy), 0) / enemies.length;
  return {
    elapsedMs,
    cappedMs,
    hours,
    estimatedKills,
    exp: Math.floor(estimatedKills * average((enemy) => enemy.exp) * 0.72),
    masteryExp: Math.floor(estimatedKills * average((enemy) => enemy.masteryExp) * 0.68),
    gold: Math.floor(estimatedKills * average((enemy) => (enemy.goldMin + enemy.goldMax) / 2) * 0.72),
    regionId: state.currentRegionId,
    efficiency,
  };
}

export function applyOfflineProgress(state: AdventureState, now = Date.now()): AdventureResult {
  const offlineProgress = getOfflineProgress(state, now);
  if (offlineProgress.estimatedKills <= 0) {
    const next = { ...state, updatedAt: now, lastActiveAt: now };
    return { ok: true, state: next, events: [], offlineProgress };
  }
  const region = REGION_DEFINITIONS[offlineProgress.regionId];
  const killCounts = { ...state.killCounts };
  for (let index = 0; index < region.enemyIds.length; index += 1) {
    const enemyId = region.enemyIds[index];
    const share = Math.floor(offlineProgress.estimatedKills / region.enemyIds.length) + (index < offlineProgress.estimatedKills % region.enemyIds.length ? 1 : 0);
    killCounts[enemyId] = (killCounts[enemyId] ?? 0) + share;
  }
  let next: AdventureState = {
    ...state,
    combat: null,
    gold: state.gold + offlineProgress.gold,
    killCounts,
    statistics: {
      ...state.statistics,
      battlesWon: state.statistics.battlesWon + offlineProgress.estimatedKills,
      totalKills: state.statistics.totalKills + offlineProgress.estimatedKills,
      goldEarned: state.statistics.goldEarned + offlineProgress.gold,
      offlineKills: state.statistics.offlineKills + offlineProgress.estimatedKills,
    },
  };
  const levelGrowth = grantExperience(next, offlineProgress.exp);
  next = levelGrowth.state;
  const masteryGrowth = grantMasteryExperience(next, offlineProgress.masteryExp);
  next = masteryGrowth.state;
  const events = [
    ...(state.combat ? ['자리를 비운 동안 진행 중이던 전투를 정리했습니다.'] : []),
    `자리를 비운 동안 ${REGION_DEFINITIONS[offlineProgress.regionId].name}에서 ${offlineProgress.estimatedKills}마리를 사냥했습니다.`,
    `오프라인 보상: 경험치 ${offlineProgress.exp.toLocaleString()}, 숙련 경험치 ${offlineProgress.masteryExp.toLocaleString()}, ${offlineProgress.gold.toLocaleString()} 골드`,
    ...levelGrowth.events,
    ...masteryGrowth.events,
  ];
  return successfulResult(next, events, now, 'reward', { offlineProgress });
}

function normalizeEliteAffixes(raw: unknown, limit = 2): EliteAffix[] {
  if (!Array.isArray(raw)) return [];
  const affixes: EliteAffix[] = [];
  for (const value of raw) {
    if (!ELITE_AFFIX_IDS.includes(value as EliteAffix) || affixes.includes(value as EliteAffix)) continue;
    affixes.push(value as EliteAffix);
    if (affixes.length >= limit) break;
  }
  return affixes;
}

export function getExpeditionWaveRank(wave: number): EnemyRank {
  const safeWave = clamp(Math.floor(wave), 1, EXPEDITION_WAVES);
  return safeWave === 3 || safeWave === EXPEDITION_WAVES ? 'elite' : 'normal';
}

function selectExpeditionAffixes(wave: number, rng: RNG): EliteAffix[] {
  if (getExpeditionWaveRank(wave) !== 'elite') return [];
  const count = wave === EXPEDITION_WAVES ? 2 : 1;
  const start = randomInt(rng, 0, ELITE_AFFIX_IDS.length - 1);
  return Array.from({ length: count }, (_, index) => ELITE_AFFIX_IDS[(start + index) % ELITE_AFFIX_IDS.length]);
}

function instantiateEnemy(
  definition: EnemyDefinition,
  challengeTier: number,
  requestedRank: EnemyRank = definition.boss ? 'boss' : 'normal',
  requestedAffixes: readonly EliteAffix[] = [],
): EnemyInstance {
  const tier = clamp(Math.floor(challengeTier), 0, 20);
  const rank: EnemyRank = definition.boss ? 'boss' : requestedRank === 'elite' ? 'elite' : 'normal';
  const affixes = rank === 'elite' ? normalizeEliteAffixes(requestedAffixes) : [];
  let hpScale = 1 + tier * 0.11;
  let attackScale = 1 + tier * 0.075;
  let defenseScale = attackScale;
  if (rank === 'elite') {
    hpScale *= affixes.length > 1 ? 1.7 : 1.45;
    attackScale *= affixes.length > 1 ? 1.28 : 1.2;
    defenseScale *= 1.15;
    if (affixes.includes('berserker')) {
      attackScale *= 1.22;
      defenseScale *= 0.92;
    }
    if (affixes.includes('ironclad')) {
      hpScale *= 1.12;
      defenseScale *= 1.42;
    }
  }
  const maxHp = Math.max(1, Math.floor(definition.maxHp * hpScale));
  const eliteTitle = affixes.map((affix) => ELITE_AFFIX_LABELS[affix]).join('·');
  return {
    definitionId: definition.id,
    name: eliteTitle ? `${eliteTitle} ${definition.name}` : definition.name,
    level: definition.level + tier * 2,
    hp: maxHp,
    maxHp,
    attack: Math.max(1, Math.floor(definition.attack * attackScale)),
    defense: Math.max(0, Math.floor(definition.defense * defenseScale)),
    crit: Math.min(35, definition.crit + tier),
    challengeTier: tier,
    boss: definition.boss,
    rank,
    affixes,
  };
}

function createExpeditionEnemy(
  state: AdventureState,
  wave: number,
  rng: RNG,
  preferredDefinition?: EnemyDefinition,
): EnemyInstance {
  const region = REGION_DEFINITIONS[state.currentRegionId];
  const definition = preferredDefinition ?? ENEMY_DEFINITIONS[pickOne(region.enemyIds, rng)];
  const rank = getExpeditionWaveRank(wave);
  const affixes = selectExpeditionAffixes(wave, rng);
  return instantiateEnemy(definition, state.bossKills[state.currentRegionId], rank, affixes);
}

export function startEncounter(
  state: AdventureState,
  options: StartEncounterOptions = {},
  rng: RNG = Math.random,
  now = Date.now(),
): AdventureResult {
  if (state.combat) return failedResult(state, '이미 전투가 진행 중입니다.');
  if (state.hp <= 0) return failedResult(state, '먼저 마을에서 체력을 회복해야 합니다.');
  const mode: EncounterMode = options.mode === 'expedition' ? 'expedition' : 'duel';
  if (mode === 'expedition' && options.boss) return failedResult(state, '지역 우두머리는 단독 토벌에서만 도전할 수 있습니다.');
  const region = REGION_DEFINITIONS[state.currentRegionId];
  let definition: EnemyDefinition | undefined;
  if (options.enemyId) {
    definition = ENEMY_DEFINITIONS[options.enemyId];
    if (!definition || definition.regionId !== state.currentRegionId) return failedResult(state, '이 지역에서는 만날 수 없는 적입니다.');
  } else if (options.boss) {
    definition = ENEMY_DEFINITIONS[region.bossId];
  } else {
    definition = ENEMY_DEFINITIONS[pickOne(region.enemyIds, rng)];
  }
  if (mode === 'expedition' && definition.boss) return failedResult(state, '지역 우두머리는 단독 토벌에서만 도전할 수 있습니다.');
  if (definition.boss && !getBossProgress(state, state.currentRegionId).available) {
    const progress = getBossProgress(state, state.currentRegionId);
    return failedResult(state, `보스 도전까지 일반 몬스터 ${progress.required - progress.current}마리가 더 필요합니다.`);
  }
  const enemy = mode === 'expedition'
    ? createExpeditionEnemy(state, 1, rng, definition)
    : instantiateEnemy(definition, state.bossKills[state.currentRegionId]);
  const combat: CombatState = {
    id: makeInstanceId('battle', now, rng),
    enemy,
    turn: 1,
    cooldowns: createSkillSlotRecord(() => 0),
    startedAt: now,
    lastAction: null,
    mode,
    wave: 1,
    totalWaves: mode === 'expedition' ? EXPEDITION_WAVES : 1,
    eliteKills: 0,
  };
  const tierText = enemy.challengeTier > 0 ? ` · 도전 ${enemy.challengeTier}` : '';
  const bossText = enemy.boss ? '보스 ' : '';
  const waveText = mode === 'expedition' ? `원정 1/${EXPEDITION_WAVES} · ` : '';
  return successfulResult({ ...state, combat }, [`${waveText}${bossText}${enemy.name}${tierText}와(과) 전투를 시작했습니다.`], now, 'combat', { outcome: 'ongoing' });
}

interface DamageRoll {
  damage: number;
  critical: boolean;
}

function rollDamage(
  attack: number,
  defense: number,
  critChance: number,
  rng: RNG,
  multiplier = 1,
  ignoredDefenseRatio = 0,
): DamageRoll {
  const effectiveDefense = defense * (1 - clamp(ignoredDefenseRatio, 0, 1));
  const variance = 0.9 + safeRandom(rng) * 0.2;
  const critical = safeRandom(rng) < clamp(critChance, 0, 100) / 100;
  const criticalScale = critical ? 1.65 : 1;
  const rawDamage = attack * multiplier * variance * criticalScale - effectiveDefense * 0.72;
  return { damage: Math.max(1, Math.floor(rawDamage)), critical };
}

function decreaseCooldowns(cooldowns: Record<SkillSlot, number>): Record<SkillSlot, number> {
  return createSkillSlotRecord((slot) => Math.max(0, (cooldowns[slot] ?? 0) - 1));
}

function bossDropRarity(rng: RNG): EquipmentRarity {
  const roll = safeRandom(rng);
  if (roll < 0.12) return 'legendary';
  if (roll < 0.45) return 'epic';
  return 'rare';
}

function eliteDropRarity(rng: RNG): EquipmentRarity {
  const roll = safeRandom(rng);
  if (roll < 0.1) return 'legendary';
  if (roll < 0.38) return 'epic';
  return 'rare';
}

export function getRuneDropPool(itemLevel: number): readonly RuneDefinition[] {
  const safeLevel = clamp(Math.floor(itemLevel), 1, MAX_LEVEL);
  return RUNE_IDS.map((runeId) => RUNE_DEFINITIONS[runeId]).filter((rune) => rune.minItemLevel <= safeLevel);
}

function rollRuneDrop(itemLevel: number, rng: RNG): RuneId {
  const pool = getRuneDropPool(itemLevel);
  return weightedPick(pool, (rune) => rune.dropWeight, rng).id;
}

function ensureUniqueInstanceId(state: AdventureState, item: EquipmentInstance): EquipmentInstance {
  const usedIds = new Set(state.inventory.map((candidate) => candidate.instanceId));
  for (const slot of Object.keys(state.equipment) as EquipmentSlot[]) {
    const equipped = state.equipment[slot];
    if (equipped) usedIds.add(equipped.instanceId);
  }
  if (!usedIds.has(item.instanceId)) return item;
  let suffix = 2;
  while (usedIds.has(`${item.instanceId}-${suffix}`)) suffix += 1;
  return { ...item, instanceId: `${item.instanceId}-${suffix}` };
}

interface EnemyRewardGrant {
  state: AdventureState;
  reward: CombatReward;
  events: string[];
}

function grantEnemyReward(
  state: AdventureState,
  enemy: EnemyInstance,
  damageDealt: number,
  damageTaken: number,
  battleCompleted: boolean,
  wave: number,
  totalWaves: number,
  expeditionComplete: boolean,
  events: string[],
  rng: RNG,
  now: number,
): EnemyRewardGrant {
  const definition = ENEMY_DEFINITIONS[enemy.definitionId];
  const eliteRewardScale = enemy.rank === 'elite' ? (enemy.affixes?.length > 1 ? 1.85 : 1.65) : 1;
  const rewardScale = (1 + enemy.challengeTier * 0.08) * eliteRewardScale;
  const exp = Math.floor(definition.exp * rewardScale);
  const masteryExp = Math.floor(definition.masteryExp * rewardScale);
  const baseGold = randomInt(rng, definition.goldMin, definition.goldMax);
  const gold = Math.floor(baseGold * rewardScale);
  const killCounts = { ...state.killCounts, [definition.id]: (state.killCounts[definition.id] ?? 0) + 1 };
  const bossKills = { ...state.bossKills };
  if (definition.boss) bossKills[definition.regionId] += 1;

  let drop: EquipmentInstance | null = null;
  let autoSoldGold = 0;
  let inventory = state.inventory;
  let runeInventory = state.runeInventory;
  let runeDrop: RuneId | null = null;
  let discoveredItemKeys = state.discoveredItemKeys;
  let equipmentFound = state.statistics.equipmentFound;
  const dropChance = enemy.rank === 'elite' ? Math.max(0.7, definition.dropChance) : definition.dropChance;
  if (safeRandom(rng) < dropChance) {
    drop = ensureUniqueInstanceId(state, generateGear({
      classId: state.classId,
      regionId: definition.regionId,
      level: enemy.level,
      forcedRarity: definition.boss
        ? bossDropRarity(rng)
        : enemy.rank === 'elite'
          ? eliteDropRarity(rng)
          : undefined,
      boss: definition.boss,
      now,
      rng,
    }));
    equipmentFound += 1;
    if (!discoveredItemKeys.includes(drop.itemKey)) discoveredItemKeys = [...discoveredItemKeys, drop.itemKey];
    if (inventory.length < INVENTORY_LIMIT) {
      inventory = [...inventory, drop];
      events.push(`${RARITY_LABELS[drop.rarity]} 장비 '${getGearDisplay(drop).name}'을(를) 획득했습니다.`);
    } else {
      autoSoldGold = getGearSellPrice(drop);
      events.push(`가방이 가득 차 장비를 자동 판매했습니다. (+${autoSoldGold.toLocaleString()} 골드)`);
    }
  }

  const runeDropChance = definition.boss ? 0.85 : enemy.rank === 'elite' ? 0.42 : 0.12;
  if (safeRandom(rng) < runeDropChance) {
    runeDrop = rollRuneDrop(enemy.level, rng);
    runeInventory = { ...runeInventory, [runeDrop]: Math.min(MAX_RUNE_STACK, runeInventory[runeDrop] + 1) };
    events.push(`${RUNE_DEFINITIONS[runeDrop].name}을(를) 획득했습니다.`);
  }

  let next: AdventureState = {
    ...state,
    gold: state.gold + gold + autoSoldGold,
    inventory,
    runeInventory,
    discoveredItemKeys,
    killCounts,
    bossKills,
    statistics: {
      ...state.statistics,
      battlesWon: state.statistics.battlesWon + (battleCompleted ? 1 : 0),
      totalKills: state.statistics.totalKills + 1,
      bossesKilled: state.statistics.bossesKilled + (definition.boss ? 1 : 0),
      damageDealt: state.statistics.damageDealt + Math.max(0, Math.floor(damageDealt)),
      damageTaken: state.statistics.damageTaken + Math.max(0, Math.floor(damageTaken)),
      goldEarned: state.statistics.goldEarned + gold + autoSoldGold,
      equipmentFound,
      equipmentSold: state.statistics.equipmentSold + (autoSoldGold > 0 ? 1 : 0),
    },
  };
  const levelGrowth = grantExperience(next, exp);
  next = levelGrowth.state;
  const masteryGrowth = grantMasteryExperience(next, masteryExp);
  next = masteryGrowth.state;
  events.push(`${enemy.name} 처치! 경험치 ${exp}, 숙련 경험치 ${masteryExp}, ${gold.toLocaleString()} 골드 획득`);
  events.push(...levelGrowth.events, ...masteryGrowth.events);
  return {
    state: next,
    events,
    reward: {
      exp,
      masteryExp,
      gold,
      drop,
      runeDrop,
      autoSoldGold,
      levelUps: levelGrowth.levelUps,
      masteryLevelUps: masteryGrowth.levelUps,
      wave,
      totalWaves,
      enemyRank: enemy.rank,
      expeditionComplete,
    },
  };
}

function finishVictory(
  state: AdventureState,
  combat: CombatState,
  damageDealt: number,
  events: string[],
  rng: RNG,
  now: number,
): AdventureResult {
  const definition = ENEMY_DEFINITIONS[combat.enemy.definitionId];
  const hasNextWave = combat.mode === 'expedition'
    && !definition.boss
    && combat.wave < combat.totalWaves;
  const defeatedEliteKills = combat.eliteKills + (combat.enemy.rank === 'elite' ? 1 : 0);
  const grant = grantEnemyReward(
    state,
    combat.enemy,
    damageDealt,
    0,
    !hasNextWave,
    combat.wave,
    combat.totalWaves,
    combat.mode === 'expedition' && !hasNextWave,
    events,
    rng,
    now,
  );

  let nextCombat: CombatState | null = null;
  if (hasNextWave) {
    const nextWave = combat.wave + 1;
    const enemy = createExpeditionEnemy(grant.state, nextWave, rng);
    nextCombat = {
      ...combat,
      enemy,
      wave: nextWave,
      eliteKills: defeatedEliteKills,
      lastAction: null,
    };
    grant.events.push(`원정 ${nextWave}/${combat.totalWaves} · ${enemy.name}이(가) 전장에 등장했습니다.`);
  } else if (combat.mode === 'expedition') {
    grant.events.push(`${combat.totalWaves}개 웨이브 원정을 완료했습니다.`);
  }

  const next = { ...grant.state, combat: nextCombat };
  return successfulResult(next, grant.events, now, 'combat', {
    outcome: hasNextWave ? 'ongoing' : 'victory',
    reward: grant.reward,
  });
}

interface ArenaCheckpointIdentity {
  runId: string;
  checkpoint: number;
}

interface ArenaCheckpointValidation {
  identity: ArenaCheckpointIdentity | null;
  message?: string;
}

function validateArenaCheckpoint(
  state: AdventureState,
  runId: unknown,
  checkpoint: unknown,
  wave: number,
  totalWaves: number,
): ArenaCheckpointValidation {
  if (runId == null && checkpoint == null) return { identity: null };
  if (typeof runId !== 'string' || !runId.trim() || runId.trim().length > 80) {
    return { identity: null, message: '아레나 런 ID가 올바르지 않습니다.' };
  }
  if (typeof checkpoint !== 'number' || !Number.isSafeInteger(checkpoint) || checkpoint < 1 || checkpoint > 1_000_000) {
    return { identity: null, message: '아레나 체크포인트가 올바르지 않습니다.' };
  }

  const identity = { runId: runId.trim(), checkpoint };
  const previous = state.arenaCheckpoint;
  if (!previous) {
    return identity.checkpoint === 1 && wave === 1
      ? { identity }
      : { identity: null, message: '새 아레나 런은 1번 체크포인트와 1웨이브로 시작해야 합니다.' };
  }
  if (previous.runId !== identity.runId) {
    if (previous.outcome === 'ongoing') {
      return { identity: null, message: '진행 중인 아레나 런의 ID를 바꿀 수 없습니다.' };
    }
    return identity.checkpoint === 1 && wave === 1
      ? { identity }
      : { identity: null, message: '새 아레나 런은 1번 체크포인트와 1웨이브로 시작해야 합니다.' };
  }
  if (previous.outcome !== 'ongoing') return { identity: null, message: '이미 종료된 아레나 런입니다.' };
  if (identity.checkpoint <= previous.checkpoint) return { identity: null, message: '이미 정산된 아레나 체크포인트입니다.' };
  if (identity.checkpoint !== previous.checkpoint + 1) return { identity: null, message: '아레나 체크포인트 순서가 올바르지 않습니다.' };
  if (totalWaves !== previous.totalWaves || wave < previous.wave || wave > previous.wave + 1) {
    return { identity: null, message: '아레나 웨이브 순서가 올바르지 않습니다.' };
  }
  return { identity };
}

function recordArenaCheckpoint(
  state: AdventureState,
  identity: ArenaCheckpointIdentity | null,
  wave: number,
  totalWaves: number,
  outcome: ArenaCheckpointState['outcome'],
): AdventureState {
  if (!identity) return state;
  return { ...state, arenaCheckpoint: { ...identity, wave, totalWaves, outcome } };
}

function arenaDamage(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(Math.floor(value), 0, 1_000_000_000)
    : 0;
}

// The real-time arena keeps frame state local and commits only one defeated enemy per call.
export function resolveArenaKill(
  state: AdventureState,
  enemyId: string,
  damageOrOptions: number | ArenaKillOptions = 0,
  rng: RNG = Math.random,
  now = Date.now(),
): AdventureResult {
  if (state.combat) return failedResult(state, '턴제 전투 중에는 아레나 처치 보상을 정산할 수 없습니다.');
  if (state.hp <= 0) return failedResult(state, '쓰러진 상태에서는 처치 보상을 정산할 수 없습니다.');
  const definition = ENEMY_DEFINITIONS[enemyId];
  if (!definition || definition.regionId !== state.currentRegionId) return failedResult(state, '이 전장에서 만날 수 없는 적입니다.');
  if (definition.boss && !getBossProgress(state, state.currentRegionId).available) {
    const progress = getBossProgress(state, state.currentRegionId);
    return failedResult(state, `보스 도전까지 일반 몬스터 ${progress.required - progress.current}마리가 더 필요합니다.`);
  }

  const options: ArenaKillOptions = typeof damageOrOptions === 'number'
    ? { damageTaken: damageOrOptions }
    : isRecord(damageOrOptions)
      ? damageOrOptions
      : {};
  const totalWaves = integerNumber(options.totalWaves, 1, 1, 100);
  const wave = integerNumber(options.wave, totalWaves, 1, totalWaves);
  const checkpoint = validateArenaCheckpoint(state, options.runId, options.checkpoint, wave, totalWaves);
  if (checkpoint.message) return failedResult(state, checkpoint.message);
  const rank: EnemyRank = definition.boss
    ? 'boss'
    : options.elite === true || options.rank === 'elite'
      ? 'elite'
      : 'normal';
  let affixes = rank === 'elite' ? normalizeEliteAffixes(options.affixes) : [];
  if (rank === 'elite' && affixes.length === 0) {
    affixes = selectExpeditionAffixes(wave, rng);
    if (affixes.length === 0) affixes = [pickOne(ELITE_AFFIX_IDS, rng)];
  }
  const enemy = instantiateEnemy(definition, state.bossKills[state.currentRegionId], rank, affixes);
  const damageTaken = arenaDamage(options.damageTaken);
  const damageDealt = arenaDamage(options.damageDealt);
  const suppliedRemainingHp = typeof options.remainingHp === 'number' && Number.isFinite(options.remainingHp)
    ? clamp(Math.floor(options.remainingHp), 0, deriveStats(state).maxHp)
    : null;
  if (suppliedRemainingHp === 0 || (suppliedRemainingHp === null && damageTaken >= state.hp)) {
    return resolveArenaDefeat(state, {
      runId: options.runId,
      checkpoint: options.checkpoint,
      damageTaken,
      damageDealt,
      wave,
      totalWaves,
    }, now);
  }
  const damagedState: AdventureState = {
    ...state,
    hp: suppliedRemainingHp ?? state.hp - damageTaken,
  };
  const continuousField = options.continuous === true && checkpoint.identity !== null;
  const encounterComplete = !continuousField && (
    totalWaves === 1
    || options.expeditionComplete === true
    || (!checkpoint.identity && wave === totalWaves)
  );
  const grant = grantEnemyReward(
    damagedState,
    enemy,
    damageDealt,
    damageTaken,
    encounterComplete,
    wave,
    totalWaves,
    totalWaves > 1 && encounterComplete,
    [],
    rng,
    now,
  );
  const outcome: CombatOutcome = encounterComplete ? 'victory' : 'ongoing';
  const settled = recordArenaCheckpoint(grant.state, checkpoint.identity, wave, totalWaves, outcome);
  return successfulResult({ ...settled, combat: null }, grant.events, now, 'combat', {
    outcome,
    reward: grant.reward,
  });
}

// Settles damage accumulated since the last kill checkpoint and applies the standard rescue penalty.
export function resolveArenaDefeat(
  state: AdventureState,
  damageOrOptions: number | ArenaDefeatOptions = 0,
  now = Date.now(),
): AdventureResult {
  if (state.combat) return failedResult(state, '턴제 전투 중에는 아레나 패배를 정산할 수 없습니다.');
  const options: ArenaDefeatOptions = typeof damageOrOptions === 'number'
    ? { damageTaken: damageOrOptions }
    : isRecord(damageOrOptions)
      ? damageOrOptions
      : {};
  const totalWaves = integerNumber(options.totalWaves, 1, 1, 100);
  const wave = integerNumber(options.wave, 1, 1, totalWaves);
  const checkpoint = validateArenaCheckpoint(state, options.runId, options.checkpoint, wave, totalWaves);
  if (checkpoint.message) return failedResult(state, checkpoint.message);
  const result = finishDefeat(
    state,
    arenaDamage(options.damageDealt),
    arenaDamage(options.damageTaken),
    ['필드 사냥을 종료했습니다.'],
    now,
  );
  return {
    ...result,
    state: recordArenaCheckpoint(result.state, checkpoint.identity, wave, totalWaves, 'defeat'),
  };
}

function finishDefeat(
  state: AdventureState,
  damageDealt: number,
  damageTaken: number,
  events: string[],
  now: number,
): AdventureResult {
  const recoveryHp = Math.ceil(deriveStats(state).maxHp * 0.5);
  const next: AdventureState = {
    ...state,
    hp: recoveryHp,
    combat: null,
    statistics: {
      ...state.statistics,
      battlesLost: state.statistics.battlesLost + 1,
      damageDealt: state.statistics.damageDealt + damageDealt,
      damageTaken: state.statistics.damageTaken + damageTaken,
    },
  };
  events.push(`쓰러져 모험가 길드로 구조되었습니다. 체력을 ${recoveryHp}까지 회복했습니다.`);
  return successfulResult(next, events, now, 'combat', { outcome: 'defeat' });
}

export function combatAction(
  state: AdventureState,
  action: CombatAction,
  rng: RNG = Math.random,
  now = Date.now(),
): AdventureResult {
  if (!state.combat) return failedResult(state, '진행 중인 전투가 없습니다.');
  if (!Object.prototype.hasOwnProperty.call(COMBAT_ACTION_LABELS, action)) return failedResult(state, '올바르지 않은 전투 행동입니다.');

  const stats = deriveStats(state);
  const combat = state.combat;
  const enemy = { ...combat.enemy };
  const events: string[] = [];
  let playerHp = state.hp;
  let potions = state.potions;
  let damageDealt = 0;
  let damageTaken = 0;
  let guarding = false;
  let enemyStunned = false;
  const cooldowns = decreaseCooldowns(combat.cooldowns);
  const applyDamageToEnemy = (rolledDamage: number): number => {
    const actualDamage = Math.min(enemy.hp, rolledDamage);
    enemy.hp -= actualDamage;
    damageDealt += actualDamage;
    return actualDamage;
  };

  if (action === 'flee') {
    const fleeChance = enemy.boss ? 0.08 : clamp(0.58 + state.baseStats.agility * 0.018, 0.58, 0.82);
    if (safeRandom(rng) < fleeChance) {
      events.push(`${enemy.name}에게서 무사히 후퇴했습니다.`);
      return successfulResult({ ...state, combat: null }, events, now, 'combat', { outcome: 'fled' });
    }
    events.push('후퇴에 실패했습니다.');
  } else if (action === 'potion') {
    if (potions <= 0) return failedResult(state, '사용할 회복 물약이 없습니다.');
    const heal = Math.min(stats.maxHp - playerHp, Math.max(24, Math.floor(stats.maxHp * 0.38)));
    if (heal <= 0) return failedResult(state, '체력이 가득해 물약을 사용할 수 없습니다.');
    potions -= 1;
    playerHp += heal;
    events.push(`회복 물약을 사용해 체력을 ${heal} 회복했습니다.`);
  } else if (action === 'guard') {
    guarding = true;
    events.push('자세를 낮춰 적의 공격에 대비합니다.');
  } else if (action === 'attack') {
    const hit = rollDamage(stats.attack, enemy.defense, stats.crit, rng);
    const actualDamage = applyDamageToEnemy(hit.damage);
    events.push(`${hit.critical ? '치명타! ' : ''}${enemy.name}에게 ${actualDamage} 피해를 주었습니다.`);
  } else {
    const skill = action as SkillSlot;
    const skillDefinition = CLASS_DEFINITIONS[state.classId].skills[skill];
    const rank = state.skillRanks[skill] ?? 0;
    const cooldownRemaining = combat.cooldowns[skill] ?? 0;
    if (state.level < skillDefinition.unlockLevel || rank <= 0) return failedResult(state, `레벨 ${skillDefinition.unlockLevel}에 해금되는 기술입니다.`);
    if (cooldownRemaining > 0) return failedResult(state, `${skillDefinition.name} 재사용까지 ${cooldownRemaining}턴 남았습니다.`);
    cooldowns[skill] = Math.max(1, skillDefinition.cooldown - Math.floor((rank - 1) / 4));

    if (state.classId === 'vanguard' && skill === 'skill1') {
      const hit = rollDamage(stats.attack, enemy.defense, stats.crit + rank, rng, 1.05 + rank * 0.1);
      const actualDamage = applyDamageToEnemy(hit.damage);
      enemyStunned = safeRandom(rng) < Math.min(0.65, 0.24 + rank * 0.045);
      events.push(`${skillDefinition.name}으로 ${actualDamage} 피해를 주었습니다.${enemyStunned ? ' 적의 반격을 끊었습니다.' : ''}`);
    } else if (state.classId === 'vanguard' && skill === 'skill2') {
      const hit = rollDamage(stats.attack, enemy.defense, stats.crit, rng, 0.72 + rank * 0.07);
      const heal = Math.min(stats.maxHp - playerHp, Math.floor(stats.maxHp * (0.12 + rank * 0.018)));
      const actualDamage = applyDamageToEnemy(hit.damage);
      playerHp += heal;
      guarding = true;
      events.push(`${skillDefinition.name}으로 ${actualDamage} 피해를 주고 체력을 ${heal} 회복했습니다.`);
    } else if (state.classId === 'ranger' && skill === 'skill1') {
      const first = rollDamage(stats.attack, enemy.defense, stats.crit, rng, 0.56 + rank * 0.045);
      const second = rollDamage(stats.attack, enemy.defense, stats.crit, rng, 0.56 + rank * 0.045);
      const firstDamage = applyDamageToEnemy(first.damage);
      const secondDamage = applyDamageToEnemy(second.damage);
      events.push(`${skillDefinition.name}으로 ${firstDamage + secondDamage} 피해를 주었습니다.${first.critical || second.critical ? ' 치명타가 적중했습니다!' : ''}`);
    } else if (state.classId === 'ranger' && skill === 'skill2') {
      const hit = rollDamage(stats.attack, enemy.defense, stats.crit + 35 + rank * 2, rng, 1.48 + rank * 0.12, 0.2);
      const actualDamage = applyDamageToEnemy(hit.damage);
      events.push(`${skillDefinition.name}으로 약점을 꿰뚫어 ${actualDamage} 피해를 주었습니다.`);
    } else if (state.classId === 'mystic' && skill === 'skill1') {
      const hit = rollDamage(stats.attack, enemy.defense, stats.crit + rank, rng, 1.04 + rank * 0.105, 0.72);
      const actualDamage = applyDamageToEnemy(hit.damage);
      events.push(`${skillDefinition.name}이 방어를 관통해 ${actualDamage} 피해를 주었습니다.`);
    } else if (state.classId === 'mystic' && skill === 'skill2') {
      const hit = rollDamage(stats.attack, enemy.defense, stats.crit + rank * 1.5, rng, 1.42 + rank * 0.13, 0.42);
      const heal = Math.min(stats.maxHp - playerHp, Math.floor(stats.maxHp * (0.08 + rank * 0.014)));
      const actualDamage = applyDamageToEnemy(hit.damage);
      playerHp += heal;
      events.push(`${skillDefinition.name}으로 ${actualDamage} 피해를 주고 체력을 ${heal} 회복했습니다.`);
    } else {
      const arena = skillDefinition.arena;
      const rankMultiplier = 1 + (rank - 1) * 0.055;
      const critBonus = arena.kind === 'projectile' ? 8 + rank : arena.kind === 'area' ? 3 + rank * 0.5 : rank;
      const ignoredDefenseRatio = arena.kind === 'projectile' ? 0.18 : arena.kind === 'dash' ? 0.1 : 0;
      const hit = rollDamage(
        stats.attack,
        enemy.defense,
        stats.crit + critBonus,
        rng,
        arena.damageMultiplier * rankMultiplier,
        ignoredDefenseRatio,
      );
      const actualDamage = applyDamageToEnemy(hit.damage);
      if (arena.kind === 'dash') enemyStunned = safeRandom(rng) < Math.min(0.5, 0.18 + rank * 0.025);
      if (state.classId === 'mystic' && skill === 'skill3') enemyStunned = safeRandom(rng) < Math.min(0.56, 0.22 + rank * 0.03);
      if (state.classId === 'vanguard' && skill === 'skill6') guarding = true;
      events.push(`${skillDefinition.name}으로 ${actualDamage} 피해를 주었습니다.${enemyStunned ? ' 적의 반격을 끊었습니다.' : ''}`);
    }
  }

  let intermediate: AdventureState = {
    ...state,
    hp: playerHp,
    potions,
    statistics: {
      ...state.statistics,
      potionsUsed: state.statistics.potionsUsed + (action === 'potion' ? 1 : 0),
    },
  };
  const updatedCombat: CombatState = {
    ...combat,
    enemy,
    turn: combat.turn + 1,
    cooldowns,
    lastAction: action,
  };
  if (enemy.hp <= 0) return finishVictory(intermediate, updatedCombat, damageDealt, events, rng, now);

  if (enemyStunned) {
    intermediate = { ...intermediate, combat: updatedCombat };
    intermediate = {
      ...intermediate,
      statistics: { ...intermediate.statistics, damageDealt: intermediate.statistics.damageDealt + damageDealt },
    };
    return successfulResult(intermediate, events, now, 'combat', { outcome: 'ongoing' });
  }

  const bossSpecial = enemy.boss && combat.turn % 4 === 0;
  const effectiveDefense = guarding ? stats.defense * 1.65 : stats.defense;
  const enemyHit = rollDamage(enemy.attack, effectiveDefense, enemy.crit, rng, bossSpecial ? 1.48 : 1);
  const reducedDamage = guarding ? Math.max(1, Math.floor(enemyHit.damage * 0.52)) : enemyHit.damage;
  damageTaken = reducedDamage;
  playerHp = Math.max(0, playerHp - reducedDamage);
  if (bossSpecial) events.push(`${enemy.name}의 강력한 특수 공격!`);
  events.push(`${enemyHit.critical ? '치명적인 공격! ' : ''}${enemy.name}에게 ${reducedDamage} 피해를 받았습니다.`);
  if (enemy.affixes?.includes('vampiric')) {
    const healing = Math.min(enemy.maxHp - enemy.hp, Math.max(1, Math.floor(reducedDamage * 0.22)));
    if (healing > 0) {
      enemy.hp += healing;
      events.push(`${enemy.name}이(가) 흡혈로 체력을 ${healing} 회복했습니다.`);
    }
  }
  intermediate = { ...intermediate, hp: playerHp, combat: updatedCombat };
  if (playerHp <= 0) return finishDefeat(intermediate, damageDealt, damageTaken, events, now);

  intermediate = {
    ...intermediate,
    statistics: {
      ...intermediate.statistics,
      damageDealt: intermediate.statistics.damageDealt + damageDealt,
      damageTaken: intermediate.statistics.damageTaken + damageTaken,
    },
  };
  return successfulResult(intermediate, events, now, 'combat', { outcome: 'ongoing' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function integerNumber(value: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(finiteNumber(value, fallback, min, max));
}

function stringValue(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' ? (value.trim().slice(0, maxLength) || fallback) : fallback;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

function sanitizeCoreStats(raw: unknown, fallback: CoreStats): CoreStats {
  const value = isRecord(raw) ? raw : {};
  return {
    strength: integerNumber(value.strength, fallback.strength, 1, 500),
    vitality: integerNumber(value.vitality, fallback.vitality, 1, 500),
    defense: integerNumber(value.defense, fallback.defense, 1, 500),
    agility: integerNumber(value.agility, fallback.agility, 1, 500),
  };
}

function sanitizeStatistics(raw: unknown): AdventureStatistics {
  const value = isRecord(raw) ? raw : {};
  const fallback = emptyStatistics();
  const read = (key: keyof AdventureStatistics): number => integerNumber(value[key], fallback[key], 0, Number.MAX_SAFE_INTEGER);
  return {
    battlesWon: read('battlesWon'),
    battlesLost: read('battlesLost'),
    totalKills: read('totalKills'),
    bossesKilled: read('bossesKilled'),
    damageDealt: read('damageDealt'),
    damageTaken: read('damageTaken'),
    goldEarned: read('goldEarned'),
    goldSpent: read('goldSpent'),
    potionsUsed: read('potionsUsed'),
    equipmentFound: read('equipmentFound'),
    equipmentSold: read('equipmentSold'),
    enhancements: read('enhancements'),
    skillUpgrades: read('skillUpgrades'),
    offlineKills: read('offlineKills'),
  };
}

export function sanitizeEquipmentInstance(
  raw: unknown,
  fallbackId: string,
  now: number,
  classId?: CharacterClassId,
): EquipmentInstance | null {
  if (!isRecord(raw)) return null;
  const definitionId = typeof raw.definitionId === 'string' && EQUIPMENT_BY_ID[raw.definitionId]
    ? raw.definitionId
    : typeof raw.baseId === 'string' && EQUIPMENT_BY_ID[raw.baseId]
      ? raw.baseId
      : '';
  if (!definitionId) return null;
  const base = EQUIPMENT_BY_ID[definitionId];
  const requestedMaterialId = typeof raw.materialId === 'string' && MATERIAL_BY_ID[raw.materialId] ? raw.materialId : 'iron';
  const materialId = GEAR_MATERIALS.findIndex((material) => material.id === requestedMaterialId) < materialVarietiesForRegion(base.regionId)
    ? requestedMaterialId
    : 'iron';
  const prefixId = typeof raw.prefixId === 'string' && PREFIX_BY_ID[raw.prefixId] ? raw.prefixId : 'sturdy';
  const suffixId = typeof raw.suffixId === 'string' && SUFFIX_BY_ID[raw.suffixId] ? raw.suffixId : 'life';
  const rarity = enumValue(raw.rarity, RARITY_IDS, 'common');
  const tier = ITEM_TIER_BY_RARITY[rarity];
  const quality = enumValue(raw.quality, GEAR_QUALITY_IDS, 'standard');
  const itemLevel = integerNumber(raw.itemLevel ?? raw.level, REGION_DEFINITIONS[base.regionId].unlockLevel, 1, MAX_LEVEL);
  const material = MATERIAL_BY_ID[materialId];
  const prefix = PREFIX_BY_ID[prefixId];
  const suffix = SUFFIX_BY_ID[suffixId];
  const itemKey = createItemKey(definitionId, materialId, prefixId, suffixId, rarity, quality);
  const socketCount = deriveItemSocketCount(itemKey, tier, base.slot);
  const socketedRunes: RuneId[] = [];
  if (Array.isArray(raw.socketedRunes)) {
    for (const runeId of raw.socketedRunes) {
      if (typeof runeId === 'string' && RUNE_IDS.includes(runeId as RuneId)) socketedRunes.push(runeId as RuneId);
      if (socketedRunes.length >= socketCount) break;
    }
  }
  const requestedSetId = typeof raw.setId === 'string' && SET_ITEM_DEFINITIONS[raw.setId as SetItemId]
    ? raw.setId as SetItemId
    : null;
  const requestedSet = requestedSetId ? SET_ITEM_DEFINITIONS[requestedSetId] : null;
  const setId = tier === 'set'
    ? requestedSet && (!requestedSet.requiredClassId || requestedSet.requiredClassId === classId)
      ? requestedSet.id
      : selectSetItemId(itemKey, classId ?? base.requiredClassId)
    : null;
  const requestedUniqueId = typeof raw.uniqueId === 'string' && UNIQUE_ITEM_DEFINITIONS[raw.uniqueId as UniqueItemId]
    ? raw.uniqueId as UniqueItemId
    : null;
  const requestedUnique = requestedUniqueId ? UNIQUE_ITEM_DEFINITIONS[requestedUniqueId] : null;
  const uniqueId = tier === 'unique'
    ? requestedUnique && isUniqueCompatible(requestedUnique, base, classId)
      ? requestedUnique.id
      : selectUniqueItemId(itemKey, base)
    : null;
  return {
    instanceId: stringValue(raw.instanceId ?? raw.id, fallbackId, 80),
    itemKey,
    definitionId,
    materialId,
    prefixId,
    suffixId,
    rarity,
    tier,
    quality,
    itemLevel,
    level: itemLevel,
    enhance: integerNumber(raw.enhance, 0, 0, MAX_ENHANCE),
    stats: calculateGeneratedStats(base, material, prefix, suffix, rarity, quality, itemLevel),
    socketCount,
    socketedRunes,
    setId,
    uniqueId,
    acquiredAt: integerNumber(raw.acquiredAt, now, 0, now),
  };
}

function sanitizeRuneInventory(raw: unknown): Record<RuneId, number> {
  const value = isRecord(raw) ? raw : {};
  return Object.fromEntries(RUNE_IDS.map((runeId) => [
    runeId,
    integerNumber(value[runeId], 0, 0, MAX_RUNE_STACK),
  ])) as Record<RuneId, number>;
}

function sanitizeLogs(raw: unknown, now: number): AdventureLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const validTypes: readonly AdventureLogType[] = ['system', 'combat', 'reward', 'growth', 'quest'];
  const logs: AdventureLogEntry[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (typeof entry === 'string') {
      logs.push({ id: createLogId(now, index), at: now, type: 'system', text: entry.slice(0, 240) });
    } else if (isRecord(entry) && typeof entry.text === 'string') {
      logs.push({
        id: stringValue(entry.id, createLogId(now, index), 100),
        at: integerNumber(entry.at, now, 0, now),
        type: enumValue(entry.type, validTypes, 'system'),
        text: entry.text.trim().slice(0, 240),
      });
    }
  }
  return logs.filter((entry) => entry.text.length > 0).slice(-MAX_LOG_ENTRIES);
}

function sanitizeCombat(raw: unknown, state: AdventureState, now: number): CombatState | null {
  if (!isRecord(raw) || !isRecord(raw.enemy)) return null;
  const definitionId = typeof raw.enemy.definitionId === 'string'
    ? raw.enemy.definitionId
    : typeof raw.enemy.enemyId === 'string'
      ? raw.enemy.enemyId
      : '';
  const definition = ENEMY_DEFINITIONS[definitionId];
  if (!definition || definition.regionId !== state.currentRegionId) return null;
  const requestedMode: EncounterMode = raw.mode === 'expedition' ? 'expedition' : 'duel';
  const mode: EncounterMode = definition.boss ? 'duel' : requestedMode;
  const totalWaves = mode === 'expedition' ? EXPEDITION_WAVES : 1;
  const wave = mode === 'expedition' ? integerNumber(raw.wave, 1, 1, EXPEDITION_WAVES) : 1;
  const rank: EnemyRank = definition.boss
    ? 'boss'
    : mode === 'expedition'
      ? getExpeditionWaveRank(wave)
      : 'normal';
  const requiredAffixes = rank === 'elite' ? (wave === EXPEDITION_WAVES ? 2 : 1) : 0;
  const affixes = rank === 'elite' ? normalizeEliteAffixes(raw.enemy.affixes, requiredAffixes) : [];
  for (const fallbackAffix of ELITE_AFFIX_IDS) {
    if (affixes.length >= requiredAffixes) break;
    if (!affixes.includes(fallbackAffix)) affixes.push(fallbackAffix);
  }
  const challengeTier = integerNumber(raw.enemy.challengeTier, state.bossKills[definition.regionId], 0, 20);
  const enemy = instantiateEnemy(definition, challengeTier, rank, affixes);
  enemy.hp = integerNumber(raw.enemy.hp, enemy.maxHp, 1, enemy.maxHp);
  const rawCooldowns = isRecord(raw.cooldowns) ? raw.cooldowns : {};
  const validActions: readonly CombatAction[] = ['attack', ...SKILL_SLOTS, 'guard', 'potion', 'flee'];
  const priorEliteWaves = [3, EXPEDITION_WAVES].filter((eliteWave) => eliteWave < wave).length;
  return {
    id: stringValue(raw.id, `battle-${now.toString(36)}`, 100),
    enemy,
    turn: integerNumber(raw.turn, 1, 1, 1_000_000),
    cooldowns: createSkillSlotRecord((slot) => integerNumber(rawCooldowns[slot], 0, 0, 20)),
    startedAt: integerNumber(raw.startedAt, now, 0, now),
    lastAction: raw.lastAction == null ? null : enumValue(raw.lastAction, validActions, 'attack'),
    mode,
    wave,
    totalWaves,
    eliteKills: mode === 'expedition' ? integerNumber(raw.eliteKills, priorEliteWaves, 0, priorEliteWaves) : 0,
  };
}

function sanitizeArenaCheckpoint(raw: unknown): ArenaCheckpointState | null {
  if (!isRecord(raw) || typeof raw.runId !== 'string') return null;
  const runId = raw.runId.trim().slice(0, 80);
  if (!runId) return null;
  const totalWaves = integerNumber(raw.totalWaves, 1, 1, 100);
  return {
    runId,
    checkpoint: integerNumber(raw.checkpoint, 1, 1, 1_000_000),
    wave: integerNumber(raw.wave, 1, 1, totalWaves),
    totalWaves,
    outcome: enumValue(raw.outcome, ['ongoing', 'victory', 'defeat'] as const, 'ongoing'),
  };
}

function sanitizeSkillLoadout(
  raw: unknown,
  classId: CharacterClassId,
  level: number,
  skillRanks: Record<SkillSlot, number>,
): Array<SkillSlot | null> {
  const available = getAvailableSkillSlots({ classId, level, skillRanks });
  const loadout = Array<SkillSlot | null>(SKILL_LOADOUT_SIZE).fill(null);
  if (!Array.isArray(raw) && !isRecord(raw)) {
    available.slice(0, SKILL_LOADOUT_SIZE).forEach((skill, index) => { loadout[index] = skill; });
    return loadout;
  }
  const allowed = new Set(available);
  const unique = new Set<SkillSlot>();
  for (let index = 0; index < SKILL_LOADOUT_SIZE; index += 1) {
    const candidate = Array.isArray(raw) ? raw[index] : raw[String(index)];
    if (!isSkillSlot(candidate) || !allowed.has(candidate) || unique.has(candidate)) continue;
    unique.add(candidate);
    loadout[index] = candidate;
  }
  if (unique.size === 0 && available[0]) loadout[0] = available[0];
  return loadout;
}

export function sanitizeAdventureState(
  raw: unknown,
  fallbackClassId: CharacterClassId = 'vanguard',
  now = Date.now(),
): AdventureState {
  if (!isRecord(raw)) return createInitialState(fallbackClassId, '이름 없는 모험가', now);
  const legacyClass = raw.classId ?? raw.job ?? raw.characterClass;
  const classId = enumValue(legacyClass, CLASS_IDS, fallbackClassId);
  const fallback = createInitialState(classId, stringValue(raw.name, '이름 없는 모험가', 16), now);
  const level = integerNumber(raw.level, 1, 1, MAX_LEVEL);
  const masteryRaw = isRecord(raw.mastery) ? raw.mastery : {};
  const masteryLevel = integerNumber(masteryRaw.level ?? raw.jobLevel, 1, 1, MAX_MASTERY_LEVEL);
  const masteryNeeded = masteryExpNeeded(masteryLevel);
  const mastery: MasteryState = {
    level: masteryLevel,
    exp: masteryNeeded > 0 ? integerNumber(masteryRaw.exp ?? raw.jobExp, 0, 0, masteryNeeded - 1) : 0,
  };
  const expRequirement = expNeeded(level);
  const baseStats = sanitizeCoreStats(raw.baseStats ?? raw.stats, CLASS_DEFINITIONS[classId].startingStats);
  const skillRanksRaw = isRecord(raw.skillRanks) ? raw.skillRanks : {};
  const skillRanks = createSkillSlotRecord((slot) => integerNumber(
    skillRanksRaw[slot],
    slot === 'skill1' ? 1 : 0,
    slot === 'skill1' ? 1 : 0,
    MAX_SKILL_RANK,
  ));
  const skillLoadout = sanitizeSkillLoadout(raw.skillLoadout, classId, level, skillRanks);

  const equipment: Record<EquipmentSlot, EquipmentInstance | null> = { ...EMPTY_EQUIPMENT };
  const inventory: EquipmentInstance[] = [];
  const usedInstanceIds = new Set<string>();
  const addUniqueItem = (item: EquipmentInstance): EquipmentInstance => {
    let instanceId = item.instanceId;
    let suffix = 1;
    while (usedInstanceIds.has(instanceId)) instanceId = `${item.instanceId}-${suffix++}`;
    usedInstanceIds.add(instanceId);
    return instanceId === item.instanceId ? item : { ...item, instanceId };
  };
  const equipmentRaw = isRecord(raw.equipment) ? raw.equipment : {};
  for (const slot of Object.keys(equipment) as EquipmentSlot[]) {
    const item = sanitizeEquipmentInstance(equipmentRaw[slot], `equipped-${slot}-${now.toString(36)}`, now, classId);
    if (!item) continue;
    const display = getGearDisplay(item);
    if (display.slot === slot && (!display.requiredClassId || display.requiredClassId === classId)) equipment[slot] = addUniqueItem(item);
    else inventory.push(addUniqueItem(item));
  }
  const inventoryRaw = Array.isArray(raw.inventory) ? raw.inventory : [];
  for (let index = 0; index < inventoryRaw.length && inventory.length < INVENTORY_LIMIT; index += 1) {
    const item = sanitizeEquipmentInstance(inventoryRaw[index], `inventory-${index}-${now.toString(36)}`, now, classId);
    if (item) inventory.push(addUniqueItem(item));
  }

  const regionCandidate = enumValue(raw.currentRegionId ?? raw.regionId, REGION_IDS, 'sunnyField');
  const currentRegionId = REGION_DEFINITIONS[regionCandidate].unlockLevel <= level
    ? regionCandidate
    : [...REGION_IDS].reverse().find((id) => REGION_DEFINITIONS[id].unlockLevel <= level) ?? 'sunnyField';
  const killCounts = createKillCounts();
  const killCountsRaw = isRecord(raw.killCounts) ? raw.killCounts : {};
  for (const enemyId of Object.keys(killCounts)) killCounts[enemyId] = integerNumber(killCountsRaw[enemyId], 0, 0, Number.MAX_SAFE_INTEGER);
  const bossKills = createBossKills();
  const bossKillsRaw = isRecord(raw.bossKills) ? raw.bossKills : {};
  for (const regionId of REGION_IDS) bossKills[regionId] = integerNumber(bossKillsRaw[regionId], 0, 0, 1_000_000);

  const discovered = new Set<string>();
  if (Array.isArray(raw.discoveredItemKeys)) {
    for (const itemKey of raw.discoveredItemKeys) {
      if (typeof itemKey === 'string' && getGearDisplayFromItemKey(itemKey)) discovered.add(itemKey);
      if (discovered.size >= TOTAL_ITEM_VARIETIES) break;
    }
  }
  for (const item of inventory) discovered.add(item.itemKey);
  for (const slot of Object.keys(equipment) as EquipmentSlot[]) {
    const item = equipment[slot];
    if (item) discovered.add(item.itemKey);
  }

  const rawQuestClaims = raw.claimedQuestIds ?? raw.questClaims;
  const claimedQuestIds: string[] = Array.isArray(rawQuestClaims)
    ? [...new Set(rawQuestClaims.filter((id: unknown): id is string => typeof id === 'string' && Boolean(QUEST_BY_ID[id])))]
    : [];
  const createdAt = integerNumber(raw.createdAt, now, 0, now);
  const updatedAt = integerNumber(raw.updatedAt, createdAt, createdAt, now);
  const lastActiveAt = integerNumber(raw.lastActiveAt, updatedAt, 0, now);
  let state: AdventureState = {
    version: ADVENTURE_SAVE_VERSION,
    resetGeneration: integerNumber(raw.resetGeneration, 0, 0, 1_000_000),
    name: stringValue(raw.name, fallback.name, 16),
    classId,
    level,
    exp: expRequirement > 0 ? integerNumber(raw.exp, 0, 0, expRequirement - 1) : 0,
    mastery,
    gold: integerNumber(raw.gold, fallback.gold, 0, Number.MAX_SAFE_INTEGER),
    hp: 1,
    baseStats,
    statPoints: integerNumber(raw.statPoints, 0, 0, 1_000_000),
    skillPoints: integerNumber(raw.skillPoints, 0, 0, 1_000_000),
    skillRanks,
    skillLoadout,
    equipment,
    inventory,
    runeInventory: sanitizeRuneInventory(raw.runeInventory),
    potions: integerNumber(raw.potions, fallback.potions, 0, 1_000_000),
    currentRegionId,
    combat: null,
    arenaCheckpoint: sanitizeArenaCheckpoint(raw.arenaCheckpoint),
    killCounts,
    bossKills,
    discoveredItemKeys: [...discovered],
    claimedQuestIds,
    logs: sanitizeLogs(raw.logs ?? raw.log, now),
    statistics: sanitizeStatistics(raw.statistics ?? raw.stats),
    createdAt,
    updatedAt,
    lastActiveAt,
  };
  const maxHp = deriveStats(state).maxHp;
  state = { ...state, hp: integerNumber(raw.hp, maxHp, 1, maxHp) };
  state = { ...state, combat: sanitizeCombat(raw.combat, state, now) };
  return state;
}
