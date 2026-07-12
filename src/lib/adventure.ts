export type RNG = () => number;

export const ADVENTURE_SAVE_VERSION = 1;
export const MAX_LEVEL = 99;
export const MAX_MASTERY_LEVEL = 50;
export const MAX_SKILL_RANK = 10;
export const MAX_ENHANCE = 10;
export const INVENTORY_LIMIT = 60;
export const MAX_LOG_ENTRIES = 80;
export const MAX_OFFLINE_HOURS = 8;
export const BOSS_KILLS_REQUIRED = 8;

export type CharacterClassId = 'vanguard' | 'ranger' | 'mystic';
export type CoreStatId = 'strength' | 'vitality' | 'defense' | 'agility';
export type SkillSlot = 'skill1' | 'skill2';
export type EquipmentSlot = 'weapon' | 'armor' | 'accessory';
export type EquipmentRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type RegionId = 'sunnyField' | 'mistForest' | 'ancientRuins' | 'dragonCrater';
export type CombatAction = 'attack' | 'skill1' | 'skill2' | 'guard' | 'potion' | 'flee';
export type CombatOutcome = 'ongoing' | 'victory' | 'defeat' | 'fled';
export type AdventureLogType = 'system' | 'combat' | 'reward' | 'growth' | 'quest';

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
  uncommon: '고급',
  rare: '희귀',
  epic: '영웅',
  legendary: '전설',
};

export const RARITY_COLORS: Record<EquipmentRarity, string> = {
  common: '#94a3b8',
  uncommon: '#34d399',
  rare: '#60a5fa',
  epic: '#c084fc',
  legendary: '#fbbf24',
};

export const COMBAT_ACTION_LABELS: Record<CombatAction, string> = {
  attack: '공격',
  skill1: '기술 1',
  skill2: '기술 2',
  guard: '방어',
  potion: '물약',
  flee: '후퇴',
};

export const CLASS_IDS: readonly CharacterClassId[] = ['vanguard', 'ranger', 'mystic'];

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
    skills: {
      skill1: {
        id: 'skill1',
        name: '방패 강타',
        description: '강하게 타격하고 일정 확률로 적의 반격을 막습니다.',
        unlockLevel: 1,
        cooldown: 2,
        maxRank: MAX_SKILL_RANK,
      },
      skill2: {
        id: 'skill2',
        name: '불굴의 함성',
        description: '적을 공격하고 잃은 체력을 회복하며 받는 피해를 줄입니다.',
        unlockLevel: 5,
        cooldown: 4,
        maxRank: MAX_SKILL_RANK,
      },
    },
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
    skills: {
      skill1: {
        id: 'skill1',
        name: '연속 사격',
        description: '두 발의 화살을 빠르게 발사해 각각 피해를 줍니다.',
        unlockLevel: 1,
        cooldown: 2,
        maxRank: MAX_SKILL_RANK,
      },
      skill2: {
        id: 'skill2',
        name: '약점 포착',
        description: '적의 약점을 노려 높은 치명타 확률로 큰 피해를 줍니다.',
        unlockLevel: 5,
        cooldown: 4,
        maxRank: MAX_SKILL_RANK,
      },
    },
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
    skills: {
      skill1: {
        id: 'skill1',
        name: '마력탄',
        description: '적의 방어력을 대부분 무시하는 응축된 마력을 발사합니다.',
        unlockLevel: 1,
        cooldown: 2,
        maxRank: MAX_SKILL_RANK,
      },
      skill2: {
        id: 'skill2',
        name: '별빛 폭발',
        description: '별빛을 폭발시켜 큰 피해를 주고 체력을 회복합니다.',
        unlockLevel: 5,
        cooldown: 4,
        maxRank: MAX_SKILL_RANK,
      },
    },
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
  quality: GearQuality;
  level: number;
  enhance: number;
  stats: EquipmentStats;
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
}

export interface CombatState {
  id: string;
  enemy: EnemyInstance;
  turn: number;
  cooldowns: Record<SkillSlot, number>;
  startedAt: number;
  lastAction: CombatAction | null;
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
  equipment: Record<EquipmentSlot, EquipmentInstance | null>;
  inventory: EquipmentInstance[];
  potions: number;
  currentRegionId: RegionId;
  combat: CombatState | null;
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
  autoSoldGold: number;
  levelUps: number;
  masteryLevelUps: number;
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
    skillRanks: { skill1: 1, skill2: 0 },
    equipment: { ...EMPTY_EQUIPMENT },
    inventory: [],
    potions: 3,
    currentRegionId: 'sunnyField',
    combat: null,
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
  const skillPower = state.skillRanks.skill1 * 2 + state.skillRanks.skill2 * 3;
  const power = Math.floor(maxHp * 0.22 + attack * 2.7 + defense * 2.2 + crit * 1.1 + skillPower);
  return { maxHp, attack, defense, crit, power };
}

export const getMaxHp = (state: AdventureState): number => deriveStats(state).maxHp;
export const getAttack = (state: AdventureState): number => deriveStats(state).attack;
export const getDefense = (state: AdventureState): number => deriveStats(state).defense;
export const getCrit = (state: AdventureState): number => deriveStats(state).crit;
export const getPower = (state: AdventureState): number => deriveStats(state).power;

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
  quality: GearQuality;
  qualityLabel: string;
  requiredClassId?: CharacterClassId;
  regionId: RegionId;
}

export function getGearDisplay(item: EquipmentInstance): GearDisplay {
  const base = EQUIPMENT_BY_ID[item.definitionId] ?? EQUIPMENT_DEFINITIONS[0];
  const material = MATERIAL_BY_ID[item.materialId] ?? GEAR_MATERIALS[0];
  const prefix = PREFIX_BY_ID[item.prefixId] ?? GEAR_PREFIXES[0];
  const suffix = SUFFIX_BY_ID[item.suffixId] ?? GEAR_SUFFIXES[0];
  const quality = GEAR_QUALITIES[item.quality] ?? GEAR_QUALITIES.standard;
  const qualityPrefix = item.quality === 'standard' ? '' : `${quality.name} `;
  return {
    itemKey: item.itemKey,
    name: `${qualityPrefix}${prefix.name} ${material.name} ${base.name} · ${suffix.name}`,
    description: `${material.description}, ${prefix.description} 장비에 ${suffix.description}이 깃들었습니다.`,
    icon: base.icon,
    slot: base.slot,
    slotLabel: EQUIPMENT_SLOT_LABELS[base.slot],
    rarity: item.rarity,
    rarityLabel: RARITY_LABELS[item.rarity],
    quality: item.quality,
    qualityLabel: quality.name,
    requiredClassId: base.requiredClassId,
    regionId: base.regionId,
  };
}

export function getGearDisplayFromItemKey(itemKey: string): GearDisplay | null {
  const [definitionId, materialId, prefixId, suffixId, rarityValue, qualityValue, ...rest] = itemKey.split(':');
  if (rest.length > 0) return null;
  if (!EQUIPMENT_BY_ID[definitionId] || !MATERIAL_BY_ID[materialId] || !PREFIX_BY_ID[prefixId] || !SUFFIX_BY_ID[suffixId]) return null;
  if (GEAR_MATERIALS.findIndex((material) => material.id === materialId) >= materialVarietiesForRegion(EQUIPMENT_BY_ID[definitionId].regionId)) return null;
  if (!RARITY_IDS.includes(rarityValue as EquipmentRarity) || !GEAR_QUALITY_IDS.includes(qualityValue as GearQuality)) return null;
  const placeholder: EquipmentInstance = {
    instanceId: '도감',
    itemKey,
    definitionId,
    materialId,
    prefixId,
    suffixId,
    rarity: rarityValue as EquipmentRarity,
    quality: qualityValue as GearQuality,
    level: 1,
    enhance: 0,
    stats: zeroEquipmentStats(),
    acquiredAt: 0,
  };
  return getGearDisplay(placeholder);
}

function rollRarity(rng: RNG, regionId: RegionId, boss: boolean): EquipmentRarity {
  const regionBonus = REGION_IDS.indexOf(regionId) * 0.025;
  const roll = safeRandom(rng) - regionBonus - (boss ? 0.18 : 0);
  if (roll < 0.018) return 'legendary';
  if (roll < 0.085) return 'epic';
  if (roll < 0.245) return 'rare';
  if (roll < 0.52) return 'uncommon';
  return 'common';
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
  const componentScale = material.statScale * prefix.statScale * suffix.statScale;
  const totalScale = RARITY_STAT_MULTIPLIERS[rarity] * GEAR_QUALITIES[quality].statScale * levelScale * componentScale;
  const additiveScale = 0.7 + REGION_IDS.indexOf(base.regionId) * 0.42;
  const valueFor = (stat: keyof EquipmentStats): number => {
    const raw = base.baseStats[stat] + (material.statBonus[stat] + prefix.statBonus[stat] + suffix.statBonus[stat]) * additiveScale;
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
  const prefix = pickOne(GEAR_PREFIXES, rng);
  const suffix = pickOne(GEAR_SUFFIXES, rng);
  const rarity = options.forcedRarity ?? rollRarity(rng, validRegionId, Boolean(options.boss));
  const quality = options.forcedQuality ?? rollQuality(rng, Boolean(options.boss));
  const level = clamp(Math.floor(options.level), 1, MAX_LEVEL);
  const itemKey = createItemKey(base.id, material.id, prefix.id, suffix.id, rarity, quality);
  return {
    instanceId: makeInstanceId('gear', now, rng),
    itemKey,
    definitionId: base.id,
    materialId: material.id,
    prefixId: prefix.id,
    suffixId: suffix.id,
    rarity,
    quality,
    level,
    enhance: 0,
    stats: calculateGeneratedStats(base, material, prefix, suffix, rarity, quality, level),
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

export const getSellValue = getGearSellPrice;

export function getSkillUpgradeCost(state: AdventureState, skill: SkillSlot): number {
  const rank = state.skillRanks[skill];
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
  const definition = CLASS_DEFINITIONS[state.classId].skills[skill];
  if (!definition) return failedResult(state, '올바르지 않은 기술입니다.');
  if (state.level < definition.unlockLevel) return failedResult(state, `레벨 ${definition.unlockLevel}에 해금되는 기술입니다.`);
  const currentRank = state.skillRanks[skill];
  if (currentRank >= definition.maxRank) return failedResult(state, '이미 최고 등급인 기술입니다.');
  const cost = getSkillUpgradeCost(state, skill);
  if (state.skillPoints < cost) return failedResult(state, '스킬 포인트가 부족합니다.');
  const nextRank = currentRank + 1;
  const next: AdventureState = {
    ...state,
    skillPoints: state.skillPoints - cost,
    skillRanks: { ...state.skillRanks, [skill]: nextRank },
    statistics: {
      ...state.statistics,
      skillUpgrades: state.statistics.skillUpgrades + 1,
    },
  };
  return successfulResult(next, [`${definition.name}을(를) ${nextRank}단계로 강화했습니다.`], now, 'growth');
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

export function unequipItem(state: AdventureState, slot: EquipmentSlot, now = Date.now()): AdventureResult {
  if (state.combat) return failedResult(state, '전투 중에는 장비를 교체할 수 없습니다.');
  const item = state.equipment[slot];
  if (!item) return failedResult(state, '해당 부위에 장착된 장비가 없습니다.');
  if (state.inventory.length >= INVENTORY_LIMIT) return failedResult(state, '가방이 가득 찼습니다.');
  const next: AdventureState = {
    ...state,
    equipment: { ...state.equipment, [slot]: null },
    inventory: [...state.inventory, item],
  };
  const capped = { ...next, hp: Math.min(next.hp, deriveStats(next).maxHp) };
  return successfulResult(capped, [`${getGearDisplay(item).name}을(를) 해제했습니다.`], now, 'growth');
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

export function isRegionUnlocked(state: Pick<AdventureState, 'level'>, regionId: RegionId): boolean {
  return state.level >= REGION_DEFINITIONS[regionId].unlockLevel;
}

export function getUnlockedRegions(state: Pick<AdventureState, 'level'>): RegionDefinition[] {
  return REGION_IDS.map((id) => REGION_DEFINITIONS[id]).filter((region) => isRegionUnlocked(state, region.id));
}

export function changeRegion(state: AdventureState, regionId: RegionId, now = Date.now()): AdventureResult {
  if (state.combat) return failedResult(state, '전투 중에는 지역을 이동할 수 없습니다.');
  const region = REGION_DEFINITIONS[regionId];
  if (!region) return failedResult(state, '존재하지 않는 지역입니다.');
  if (!isRegionUnlocked(state, regionId)) return failedResult(state, `레벨 ${region.unlockLevel}에 해금되는 지역입니다.`);
  if (state.currentRegionId === regionId) return failedResult(state, '이미 머무르고 있는 지역입니다.');
  return successfulResult({ ...state, currentRegionId: regionId }, [`${region.name}(으)로 이동했습니다.`], now, 'system');
}

export const travelToRegion = changeRegion;

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

export const healAtTown = restAtTown;

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

export function markAdventureActive(state: AdventureState, now = Date.now()): AdventureState {
  return { ...state, version: ADVENTURE_SAVE_VERSION, updatedAt: now, lastActiveAt: now };
}

function instantiateEnemy(definition: EnemyDefinition, challengeTier: number): EnemyInstance {
  const tier = clamp(Math.floor(challengeTier), 0, 20);
  const hpScale = 1 + tier * 0.11;
  const combatScale = 1 + tier * 0.075;
  const maxHp = Math.floor(definition.maxHp * hpScale);
  return {
    definitionId: definition.id,
    name: definition.name,
    level: definition.level + tier * 2,
    hp: maxHp,
    maxHp,
    attack: Math.floor(definition.attack * combatScale),
    defense: Math.floor(definition.defense * combatScale),
    crit: Math.min(35, definition.crit + tier),
    challengeTier: tier,
    boss: definition.boss,
  };
}

export function startEncounter(
  state: AdventureState,
  options: StartEncounterOptions = {},
  rng: RNG = Math.random,
  now = Date.now(),
): AdventureResult {
  if (state.combat) return failedResult(state, '이미 전투가 진행 중입니다.');
  if (state.hp <= 0) return failedResult(state, '먼저 마을에서 체력을 회복해야 합니다.');
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
  if (definition.boss && !getBossProgress(state, state.currentRegionId).available) {
    const progress = getBossProgress(state, state.currentRegionId);
    return failedResult(state, `보스 도전까지 일반 몬스터 ${progress.required - progress.current}마리가 더 필요합니다.`);
  }
  const enemy = instantiateEnemy(definition, state.bossKills[state.currentRegionId]);
  const combat: CombatState = {
    id: makeInstanceId('battle', now, rng),
    enemy,
    turn: 1,
    cooldowns: { skill1: 0, skill2: 0 },
    startedAt: now,
    lastAction: null,
  };
  const tierText = enemy.challengeTier > 0 ? ` · 도전 ${enemy.challengeTier}` : '';
  const bossText = enemy.boss ? '보스 ' : '';
  return successfulResult({ ...state, combat }, [`${bossText}${enemy.name}${tierText}와(과) 전투를 시작했습니다.`], now, 'combat', { outcome: 'ongoing' });
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
  return {
    skill1: Math.max(0, cooldowns.skill1 - 1),
    skill2: Math.max(0, cooldowns.skill2 - 1),
  };
}

function bossDropRarity(rng: RNG): EquipmentRarity {
  const roll = safeRandom(rng);
  if (roll < 0.12) return 'legendary';
  if (roll < 0.45) return 'epic';
  return 'rare';
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

function finishVictory(
  state: AdventureState,
  combat: CombatState,
  damageDealt: number,
  events: string[],
  rng: RNG,
  now: number,
): AdventureResult {
  const definition = ENEMY_DEFINITIONS[combat.enemy.definitionId];
  const tierRewardScale = 1 + combat.enemy.challengeTier * 0.08;
  const exp = Math.floor(definition.exp * tierRewardScale);
  const masteryExp = Math.floor(definition.masteryExp * tierRewardScale);
  const baseGold = randomInt(rng, definition.goldMin, definition.goldMax);
  const gold = Math.floor(baseGold * tierRewardScale);
  const killCounts = { ...state.killCounts, [definition.id]: (state.killCounts[definition.id] ?? 0) + 1 };
  const bossKills = { ...state.bossKills };
  if (definition.boss) bossKills[definition.regionId] += 1;

  let drop: EquipmentInstance | null = null;
  let autoSoldGold = 0;
  let inventory = state.inventory;
  let discoveredItemKeys = state.discoveredItemKeys;
  let equipmentFound = state.statistics.equipmentFound;
  if (safeRandom(rng) < definition.dropChance) {
    drop = ensureUniqueInstanceId(state, generateGear({
      classId: state.classId,
      regionId: definition.regionId,
      level: combat.enemy.level,
      forcedRarity: definition.boss ? bossDropRarity(rng) : undefined,
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

  let next: AdventureState = {
    ...state,
    combat: null,
    gold: state.gold + gold + autoSoldGold,
    inventory,
    discoveredItemKeys,
    killCounts,
    bossKills,
    statistics: {
      ...state.statistics,
      battlesWon: state.statistics.battlesWon + 1,
      totalKills: state.statistics.totalKills + 1,
      bossesKilled: state.statistics.bossesKilled + (definition.boss ? 1 : 0),
      damageDealt: state.statistics.damageDealt + damageDealt,
      goldEarned: state.statistics.goldEarned + gold + autoSoldGold,
      equipmentFound,
      equipmentSold: state.statistics.equipmentSold + (autoSoldGold > 0 ? 1 : 0),
    },
  };
  const levelGrowth = grantExperience(next, exp);
  next = levelGrowth.state;
  const masteryGrowth = grantMasteryExperience(next, masteryExp);
  next = masteryGrowth.state;
  events.push(`${definition.name} 처치! 경험치 ${exp}, 숙련 경험치 ${masteryExp}, ${gold.toLocaleString()} 골드 획득`);
  events.push(...levelGrowth.events, ...masteryGrowth.events);
  const reward: CombatReward = {
    exp,
    masteryExp,
    gold,
    drop,
    autoSoldGold,
    levelUps: levelGrowth.levelUps,
    masteryLevelUps: masteryGrowth.levelUps,
  };
  return successfulResult(next, events, now, 'combat', { outcome: 'victory', reward });
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
    const rank = state.skillRanks[skill];
    if (state.level < skillDefinition.unlockLevel || rank <= 0) return failedResult(state, `레벨 ${skillDefinition.unlockLevel}에 해금되는 기술입니다.`);
    if (combat.cooldowns[skill] > 0) return failedResult(state, `${skillDefinition.name} 재사용까지 ${combat.cooldowns[skill]}턴 남았습니다.`);
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
    } else {
      const hit = rollDamage(stats.attack, enemy.defense, stats.crit + rank * 1.5, rng, 1.42 + rank * 0.13, 0.42);
      const heal = Math.min(stats.maxHp - playerHp, Math.floor(stats.maxHp * (0.08 + rank * 0.014)));
      const actualDamage = applyDamageToEnemy(hit.damage);
      playerHp += heal;
      events.push(`${skillDefinition.name}으로 ${actualDamage} 피해를 주고 체력을 ${heal} 회복했습니다.`);
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

export const performCombatAction = combatAction;

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

function sanitizeEquipmentInstance(raw: unknown, fallbackId: string, now: number): EquipmentInstance | null {
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
  const quality = enumValue(raw.quality, GEAR_QUALITY_IDS, 'standard');
  const level = integerNumber(raw.level, REGION_DEFINITIONS[base.regionId].unlockLevel, 1, MAX_LEVEL);
  const material = MATERIAL_BY_ID[materialId];
  const prefix = PREFIX_BY_ID[prefixId];
  const suffix = SUFFIX_BY_ID[suffixId];
  return {
    instanceId: stringValue(raw.instanceId ?? raw.id, fallbackId, 80),
    itemKey: createItemKey(definitionId, materialId, prefixId, suffixId, rarity, quality),
    definitionId,
    materialId,
    prefixId,
    suffixId,
    rarity,
    quality,
    level,
    enhance: integerNumber(raw.enhance, 0, 0, MAX_ENHANCE),
    stats: calculateGeneratedStats(base, material, prefix, suffix, rarity, quality, level),
    acquiredAt: integerNumber(raw.acquiredAt, now, 0, now),
  };
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
  const challengeTier = integerNumber(raw.enemy.challengeTier, state.bossKills[definition.regionId], 0, 20);
  const enemy = instantiateEnemy(definition, challengeTier);
  enemy.hp = integerNumber(raw.enemy.hp, enemy.maxHp, 1, enemy.maxHp);
  const rawCooldowns = isRecord(raw.cooldowns) ? raw.cooldowns : {};
  const validActions: readonly CombatAction[] = ['attack', 'skill1', 'skill2', 'guard', 'potion', 'flee'];
  return {
    id: stringValue(raw.id, `battle-${now.toString(36)}`, 100),
    enemy,
    turn: integerNumber(raw.turn, 1, 1, 1_000_000),
    cooldowns: {
      skill1: integerNumber(rawCooldowns.skill1, 0, 0, 20),
      skill2: integerNumber(rawCooldowns.skill2, 0, 0, 20),
    },
    startedAt: integerNumber(raw.startedAt, now, 0, now),
    lastAction: raw.lastAction === null ? null : enumValue(raw.lastAction, validActions, 'attack'),
  };
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
  const skillRanks: Record<SkillSlot, number> = {
    skill1: integerNumber(skillRanksRaw.skill1, 1, 1, MAX_SKILL_RANK),
    skill2: integerNumber(skillRanksRaw.skill2, 0, 0, MAX_SKILL_RANK),
  };

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
    const item = sanitizeEquipmentInstance(equipmentRaw[slot], `equipped-${slot}-${now.toString(36)}`, now);
    if (!item) continue;
    const display = getGearDisplay(item);
    if (display.slot === slot && (!display.requiredClassId || display.requiredClassId === classId)) equipment[slot] = addUniqueItem(item);
    else inventory.push(addUniqueItem(item));
  }
  const inventoryRaw = Array.isArray(raw.inventory) ? raw.inventory : [];
  for (let index = 0; index < inventoryRaw.length && inventory.length < INVENTORY_LIMIT; index += 1) {
    const item = sanitizeEquipmentInstance(inventoryRaw[index], `inventory-${index}-${now.toString(36)}`, now);
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
    equipment,
    inventory,
    potions: integerNumber(raw.potions, fallback.potions, 0, 1_000_000),
    currentRegionId,
    combat: null,
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

export const migrateAdventureState = sanitizeAdventureState;
