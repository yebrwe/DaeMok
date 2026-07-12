'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Backpack,
  ChartNoAxesColumnIncreasing,
  Check,
  FlaskConical,
  Footprints,
  Hammer,
  Heart,
  Library,
  LockKeyhole,
  LogOut,
  Map,
  PackageOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Trash2,
  Trophy,
  Zap,
} from 'lucide-react';
import AdventureIcon from '@/components/adventure/AdventureIcon';
import { useAuth } from '@/hooks/useAuth';
import {
  loadAdventureState,
  resetAdventureStateAndRanking,
  saveAdventureStateAndRanking,
  startAdventurePresence,
  subscribeAdventureOnlineCount,
  subscribeAdventureRankings,
  subscribeAdventureState,
  type AdventureRankingEntry,
} from '@/lib/adventureFirebase';
import {
  BOSS_KILLS_REQUIRED,
  CLASS_DEFINITIONS,
  CLASS_IDS,
  CORE_STAT_LABELS,
  ENEMY_DEFINITIONS,
  EQUIPMENT_SLOT_LABELS,
  MAX_ENHANCE,
  MAX_SKILL_RANK,
  REGION_DEFINITIONS,
  REGION_IDS,
  TOTAL_ITEM_VARIETIES,
  allocateStat,
  applyOfflineProgress,
  changeRegion,
  claimQuest,
  combatAction,
  createInitialState,
  deriveStats,
  enhanceGear,
  equipItem,
  getAllQuestProgress,
  getBossProgress,
  getEnhancementCost,
  getEquipmentDisplay,
  getGearDisplayFromItemKey,
  getLevelProgress,
  getMasteryProgress,
  getRestCost,
  getSkillUpgradeCost,
  isRegionUnlocked,
  restAtTown,
  sanitizeAdventureState,
  sellItem,
  startEncounter,
  upgradeSkill,
  type AdventureResult,
  type AdventureState,
  type CharacterClassId,
  type CombatAction,
  type CoreStatId,
  type EquipmentInstance,
  type EquipmentRarity,
  type EquipmentSlot,
  type OfflineProgress,
  type RegionId,
  type SkillSlot,
} from '@/lib/adventure';
import styles from './adventure.module.css';

type MainTab = 'hunt' | 'equipment' | 'growth' | 'collection' | 'ranking';
type SideTab = 'quests' | 'inventory' | 'log';
type CollectionFilter = 'all' | EquipmentSlot;

const SAVE_KEY_PREFIX = 'daemok-adventure-v1';

const STAT_DESCRIPTIONS: Record<CoreStatId, string> = {
  strength: '공격력이 2씩 증가합니다.',
  vitality: '최대 체력이 7씩 증가합니다.',
  defense: '방어력이 크게 증가합니다.',
  agility: '치명타 확률이 증가합니다.',
};

const RARITY_CLASS: Record<EquipmentRarity, string> = {
  common: styles.rarityCommon,
  uncommon: styles.rarityUncommon,
  rare: styles.rarityRare,
  epic: styles.rarityEpic,
  legendary: styles.rarityLegendary,
};

const formatNumber = (value: number) => Math.max(0, Math.floor(value)).toLocaleString('ko-KR');
const percent = (value: number) => `${Math.max(0, Math.min(100, value * 100))}%`;

function Meter({ ratio, variant, label }: { ratio: number; variant: 'hp' | 'exp' | 'mastery'; label: string }) {
  const fillClass = variant === 'hp' ? styles.hpFill : variant === 'exp' ? styles.expFill : styles.masteryFill;
  return (
    <div className={styles.meterTrack} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
      <div className={`${styles.meterFill} ${fillClass}`} style={{ width: percent(ratio) }} />
    </div>
  );
}

function itemStats(item: EquipmentInstance) {
  const display = getEquipmentDisplay(item);
  const values = [
    display.stats.attack > 0 ? `공격 +${display.stats.attack}` : '',
    display.stats.defense > 0 ? `방어 +${display.stats.defense}` : '',
    display.stats.maxHp > 0 ? `체력 +${display.stats.maxHp}` : '',
    display.stats.crit > 0 ? `치명 +${display.stats.crit}%` : '',
  ].filter(Boolean);
  return values.join(' · ');
}

function rankFor(level: number) {
  if (level >= 30) return '대목의 수호자';
  if (level >= 20) return '황금 모험가';
  if (level >= 12) return '왕실 모험가';
  if (level >= 5) return '숙련 모험가';
  return '새싹 모험가';
}

export default function AdventurePage() {
  const { user, loading: authLoading } = useAuth();
  const [game, setGame] = useState<AdventureState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState('불러오는 중');
  const [activeTab, setActiveTab] = useState<MainTab>('hunt');
  const [sideTab, setSideTab] = useState<SideTab>('quests');
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>('all');
  const [selectedClass, setSelectedClass] = useState<CharacterClassId>('vanguard');
  const [characterName, setCharacterName] = useState('');
  const [selectedEnemyId, setSelectedEnemyId] = useState('field_slime');
  const [autoHunt, setAutoHunt] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [offlineSummary, setOfflineSummary] = useState<OfflineProgress | null>(null);
  const [rankings, setRankings] = useState<AdventureRankingEntry[]>([]);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [onlineCount, setOnlineCount] = useState(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameRef = useRef<AdventureState | null>(null);

  const uid = user?.uid ?? 'guest';
  const localSaveKey = `${SAVE_KEY_PREFIX}:${uid}`;
  const gameReady = game !== null;
  const currentRegionId = game?.currentRegionId;

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2600);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    const loadSave = async () => {
      setHydrated(false);
      setSaveStatus('불러오는 중');
      let candidate: AdventureState | null = null;
      let localCandidate: AdventureState | null = null;

      if (user) {
        try {
          const localRaw = window.localStorage.getItem(localSaveKey);
          if (localRaw) localCandidate = sanitizeAdventureState(JSON.parse(localRaw));
        } catch {
          window.localStorage.removeItem(localSaveKey);
        }
        try {
          const remote = await loadAdventureState(user.uid);
          candidate = remote ?? localCandidate;
        } catch {
          candidate = localCandidate;
          setSaveStatus('로컬 저장');
        }
      }

      if (cancelled) return;
      if (candidate) {
        const offline = applyOfflineProgress(candidate);
        setGame(offline.state);
        if (offline.offlineProgress && offline.offlineProgress.estimatedKills > 0) {
          setOfflineSummary(offline.offlineProgress);
        }
      } else {
        setGame(null);
        setCharacterName(user?.displayName?.slice(0, 16) ?? '');
      }
      setHydrated(true);
      setSaveStatus(user ? '클라우드 연결' : '로컬 저장');
    };

    loadSave();
    return () => { cancelled = true; };
  }, [authLoading, localSaveKey, user]);

  useEffect(() => {
    if (!hydrated || !game || !user) return;
    window.localStorage.setItem(localSaveKey, JSON.stringify(game));
    setSaveStatus('저장 중');
    const timer = setTimeout(async () => {
      try {
        await saveAdventureStateAndRanking(user, game);
        setSaveStatus('저장됨');
      } catch {
        setSaveStatus('로컬 저장됨');
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [game, hydrated, localSaveKey, user]);

  useEffect(() => {
    if (!user) {
      setRankings([]);
      setOnlineCount(0);
      setRankingLoading(false);
      return;
    }
    setRankingLoading(true);
    const stopRanking = subscribeAdventureRankings((entries) => {
      setRankings(entries);
      setRankingLoading(false);
    });
    const stopOnlineCount = subscribeAdventureOnlineCount(setOnlineCount);
    const stopPresence = startAdventurePresence(user);
    const stopState = subscribeAdventureState(user.uid, (remoteState) => {
      const current = gameRef.current;
      if (remoteState && current && remoteState.updatedAt > current.updatedAt) setGame(remoteState);
    });
    return () => {
      stopRanking();
      stopOnlineCount();
      stopPresence();
      stopState();
    };
  }, [user]);

  useEffect(() => {
    if (!currentRegionId) return;
    const region = REGION_DEFINITIONS[currentRegionId];
    const currentEnemy = ENEMY_DEFINITIONS[selectedEnemyId];
    if (!currentEnemy || currentEnemy.regionId !== region.id) setSelectedEnemyId(region.enemyIds[0]);
  }, [currentRegionId, selectedEnemyId]);

  const applyResult = useCallback((result: AdventureResult) => {
    setGame(result.state);
    if (!result.ok && result.message) showNotice(result.message);
  }, [showNotice]);

  useEffect(() => {
    if (!autoHunt || !gameReady) return;
    const timer = setInterval(() => {
      setGame((current) => {
        if (!current) return current;
        if (!current.combat) {
          const started = startEncounter(current, { enemyId: selectedEnemyId, boss: ENEMY_DEFINITIONS[selectedEnemyId]?.boss });
          return started.ok ? started.state : current;
        }

        const stats = deriveStats(current);
        let action: CombatAction = 'attack';
        if (current.hp / stats.maxHp < 0.32 && current.potions > 0) action = 'potion';
        else if (current.level >= CLASS_DEFINITIONS[current.classId].skills.skill2.unlockLevel && current.skillRanks.skill2 > 0 && current.combat.cooldowns.skill2 === 0) action = 'skill2';
        else if (current.combat.cooldowns.skill1 === 0) action = 'skill1';
        const result = combatAction(current, action);
        return result.state;
      });
    }, 820);
    return () => clearInterval(timer);
  }, [autoHunt, gameReady, selectedEnemyId]);

  const createCharacter = () => {
    const trimmed = characterName.trim();
    if (!trimmed) {
      showNotice('모험가 이름을 입력해 주세요.');
      return;
    }
    setGame(createInitialState(selectedClass, trimmed));
    setHydrated(true);
  };

  const resetCharacter = async () => {
    if (!window.confirm('현재 캐릭터의 레벨, 장비, 도감 기록을 모두 삭제할까요?')) return;
    setAutoHunt(false);
    if (user) {
      try {
        await resetAdventureStateAndRanking(user.uid);
      } catch {
        showNotice('Firebase 캐릭터 초기화에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
    }
    window.localStorage.removeItem(localSaveKey);
    setGame(null);
    setCharacterName(user?.displayName?.slice(0, 16) ?? '');
  };

  if (authLoading || !hydrated) {
    return (
      <main className={styles.loadingScreen}>
        <div className={styles.loadingInner}>
          <div className={styles.spinner} />
          <p>모험 기록을 불러오는 중입니다.</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.creation}>
        <Image className={styles.creationImage} src="/adventure-assets/frontier.webp" alt="성벽 도시와 숲길이 이어진 모험가 길드의 변경" fill priority sizes="100vw" />
        <div className={styles.creationShade} />
        <section className={styles.creationContent} aria-labelledby="login-required-title">
          <p className={styles.creationEyebrow}>온라인 모험가 등록</p>
          <h1 id="login-required-title" className={styles.creationTitle}>Firebase 계정으로 시작하세요</h1>
          <p className={styles.creationCopy}>캐릭터, 전투 진행, 장비와 도감은 계정의 Firebase 데이터로 저장되며 실시간 전투력 랭킹에 반영됩니다.</p>
          <div className={styles.creationFooter}><p className={styles.creationNote}>로컬 전용 게스트 캐릭터는 더 이상 생성하지 않습니다.</p><Link className={styles.primaryButton} href="/login"><Trophy size={15} /> 로그인하고 참가</Link></div>
        </section>
      </main>
    );
  }

  if (!game) {
    return (
      <main className={styles.creation}>
        <Image className={styles.creationImage} src="/adventure-assets/frontier.webp" alt="성벽 도시와 숲길이 이어진 모험가 길드의 변경" fill priority sizes="100vw" />
        <div className={styles.creationShade} />
        <section className={styles.creationContent} aria-labelledby="creation-title">
          <p className={styles.creationEyebrow}>대목 모험가 길드</p>
          <h1 id="creation-title" className={styles.creationTitle}>오래 키울 첫 캐릭터를 선택하세요</h1>
          <p className={styles.creationCopy}>사냥과 오프라인 활동으로 레벨과 직업 숙련도를 쌓고, 발견한 장비는 {formatNumber(TOTAL_ITEM_VARIETIES)}종 도감에 영구 기록됩니다.</p>
          <label className={styles.nameField}>
            <span className={styles.nameLabel}>모험가 이름</span>
            <input className={styles.nameInput} value={characterName} maxLength={16} placeholder="이름을 입력하세요" onChange={(event) => setCharacterName(event.target.value)} />
          </label>
          <div className={styles.classGrid}>
            {CLASS_IDS.map((classId) => {
              const definition = CLASS_DEFINITIONS[classId];
              return (
                <button key={classId} className={`${styles.classCard} ${selectedClass === classId ? styles.classCardActive : ''}`} onClick={() => setSelectedClass(classId)} aria-pressed={selectedClass === classId}>
                  <AdventureIcon name={definition.icon} size={31} className={styles.classIcon} />
                  <p className={styles.className}>{definition.name}</p>
                  <p className={styles.classRole}>{definition.title}</p>
                  <p className={styles.classDesc}>{definition.description}</p>
                  <p className={styles.classStats}>체력 {definition.baseMaxHp} · 공격 {definition.baseAttack} · 방어 {definition.baseDefense} · 치명 {definition.baseCrit}%</p>
                </button>
              );
            })}
          </div>
          <div className={styles.creationFooter}>
            <p className={styles.creationNote}>직업은 성장 방식과 전투 기술이 다릅니다. 진행 상황은 이 브라우저와 로그인 계정에 자동 저장됩니다.</p>
            <button className={styles.primaryButton} onClick={createCharacter}><Swords size={16} /> 모험 시작</button>
          </div>
        </section>
        {notice && <div className={styles.notice}>{notice}</div>}
      </main>
    );
  }

  const derived = deriveStats(game);
  const levelProgress = getLevelProgress(game);
  const masteryProgress = getMasteryProgress(game);
  const classDefinition = CLASS_DEFINITIONS[game.classId];
  const region = REGION_DEFINITIONS[game.currentRegionId];
  const bossProgress = getBossProgress(game);
  const selectedEnemy = ENEMY_DEFINITIONS[selectedEnemyId] ?? ENEMY_DEFINITIONS[region.enemyIds[0]];
  const questProgress = getAllQuestProgress(game);
  const claimableQuests = questProgress.filter((quest) => quest.completed && !quest.claimed).length;
  const restCost = getRestCost(game);
  const nextRegion = REGION_IDS.map((id) => REGION_DEFINITIONS[id]).find((candidate) => candidate.unlockLevel > game.level);
  const myRankIndex = user ? rankings.findIndex((entry) => entry.uid === user.uid) : -1;
  const myRank = myRankIndex >= 0 ? myRankIndex + 1 : null;
  const performAction = (action: CombatAction) => applyResult(combatAction(game, action));

  const beginEncounter = (automatic: boolean) => {
    const result = startEncounter(game, { enemyId: selectedEnemy.id, boss: selectedEnemy.boss });
    applyResult(result);
    if (result.ok) setAutoHunt(automatic);
  };

  const travel = (regionId: RegionId) => {
    if (regionId === game.currentRegionId) return;
    setAutoHunt(false);
    const result = changeRegion(game, regionId);
    applyResult(result);
    if (result.ok) setSelectedEnemyId(REGION_DEFINITIONS[regionId].enemyIds[0]);
  };

  const renderItemRow = (item: EquipmentInstance, equipped = false) => {
    const display = getEquipmentDisplay(item);
    const enhanceCost = getEnhancementCost(item);
    return (
      <div className={styles.inventoryRow} key={item.instanceId}>
        <div className={styles.itemTop}>
          <div>
            <p className={`${styles.itemName} ${RARITY_CLASS[item.rarity]}`}><AdventureIcon name={display.icon} size={14} /> {display.name} {item.enhance > 0 && `+${item.enhance}`}</p>
            <p className={styles.itemStats}>Lv.{item.level} · {display.rarityLabel} {display.qualityLabel} · {itemStats(item)}</p>
          </div>
          <span className={styles.price}>{formatNumber(display.value)} G</span>
        </div>
        <div className={styles.itemActions}>
          {!equipped && <button className={styles.smallButton} disabled={Boolean(game.combat)} onClick={() => applyResult(equipItem(game, item.instanceId))}><Check size={12} /> 장착</button>}
          <button className={styles.smallButton} disabled={Boolean(game.combat) || item.enhance >= MAX_ENHANCE || game.gold < enhanceCost} onClick={() => applyResult(enhanceGear(game, item.instanceId))}><Hammer size={12} /> +{item.enhance + 1} 강화 {formatNumber(enhanceCost)}G</button>
          {!equipped && <button className={styles.smallButton} disabled={Boolean(game.combat)} onClick={() => applyResult(sellItem(game, item.instanceId))}><Trash2 size={12} /> 판매</button>}
        </div>
      </div>
    );
  };

  const renderHunt = () => {
    if (game.combat) {
      const enemy = game.combat.enemy;
      const enemyDefinition = ENEMY_DEFINITIONS[enemy.definitionId];
      return (
        <section className={`${styles.panel} ${styles.battlePanel}`}>
          <div className={styles.autoStrip}>
            <span className={styles.autoState}><span className={`${styles.autoDot} ${autoHunt ? styles.autoDotOn : ''}`} />{autoHunt ? '자동 사냥 진행 중' : '수동 전투'}</span>
            <button className={styles.smallButton} onClick={() => setAutoHunt((value) => !value)}>{autoHunt ? <Pause size={12} /> : <Play size={12} />}{autoHunt ? '자동 중지' : '자동 전환'}</button>
          </div>
          <div className={styles.battleStage}>
            <div className={styles.combatant}>
              <div className={styles.combatantIcon}><AdventureIcon name={classDefinition.icon} size={44} /></div>
              <p className={styles.combatantName}>{game.name}</p>
              <p className={styles.combatantLevel}>Lv.{game.level} {classDefinition.name}</p>
              <div className={styles.battleHp}><Meter ratio={game.hp / derived.maxHp} variant="hp" label="플레이어 체력" /></div>
              <p className={styles.battleHpText}>{formatNumber(game.hp)} / {formatNumber(derived.maxHp)}</p>
            </div>
            <div className={styles.versus}>VS</div>
            <div className={styles.combatant}>
              <div className={styles.combatantIcon}><AdventureIcon name={enemyDefinition?.icon ?? 'swords'} size={44} /></div>
              <p className={styles.combatantName}>{enemy.name}</p>
              <p className={styles.combatantLevel}>Lv.{enemy.level} {enemy.boss ? '지역 우두머리' : '야생 몬스터'}</p>
              <div className={styles.battleHp}><Meter ratio={enemy.hp / enemy.maxHp} variant="hp" label="적 체력" /></div>
              <p className={styles.battleHpText}>{formatNumber(enemy.hp)} / {formatNumber(enemy.maxHp)}</p>
            </div>
          </div>
          <div className={styles.combatActions}>
            <button className={styles.actionButton} disabled={autoHunt} onClick={() => performAction('attack')}><Swords size={17} />기본 공격<span className={styles.actionSub}>안정적인 피해</span></button>
            {(['skill1', 'skill2'] as SkillSlot[]).map((slot) => {
              const skill = classDefinition.skills[slot];
              const locked = game.level < skill.unlockLevel || game.skillRanks[slot] <= 0;
              const cooldown = game.combat?.cooldowns[slot] ?? 0;
              return <button key={slot} className={styles.actionButton} disabled={autoHunt || locked || cooldown > 0} onClick={() => performAction(slot)}><Zap size={17} />{skill.name}<span className={styles.actionSub}>{game.level < skill.unlockLevel ? `Lv.${skill.unlockLevel} 해금` : game.skillRanks[slot] <= 0 ? '미습득' : cooldown > 0 ? `${cooldown}턴 대기` : `${game.skillRanks[slot]}단계`}</span></button>;
            })}
            <button className={styles.actionButton} disabled={autoHunt} onClick={() => performAction('guard')}><ShieldCheck size={17} />방어<span className={styles.actionSub}>피해 감소</span></button>
            <button className={styles.actionButton} disabled={autoHunt || game.potions < 1} onClick={() => performAction('potion')}><FlaskConical size={17} />물약<span className={styles.actionSub}>{game.potions}개 보유</span></button>
            <button className={styles.actionButton} disabled={autoHunt} onClick={() => performAction('flee')}><Footprints size={17} />후퇴<span className={styles.actionSub}>전투 종료</span></button>
          </div>
        </section>
      );
    }

    const enemyIds = [...region.enemyIds, region.bossId];
    return (
      <section className={`${styles.panel} ${styles.huntPanel}`}>
        <div className={styles.panelHeader}><h2 className={styles.panelTitle}><Target size={14} /> 사냥 대상</h2><span className={styles.panelMeta}>처치 {formatNumber(game.statistics.totalKills)}</span></div>
        <div className={styles.enemyList}>
          {enemyIds.map((enemyId) => {
            const enemy = ENEMY_DEFINITIONS[enemyId];
            const bossLocked = enemy.boss && !bossProgress.available;
            return (
              <button key={enemy.id} className={`${styles.enemyRow} ${selectedEnemy.id === enemy.id ? styles.enemySelected : ''}`} onClick={() => setSelectedEnemyId(enemy.id)} aria-pressed={selectedEnemy.id === enemy.id}>
                <span className={styles.enemyIcon}><AdventureIcon name={enemy.icon} size={22} /></span>
                <span>
                  <span className={`${styles.enemyName} ${enemy.boss ? styles.bossText : ''}`}>{enemy.name} · Lv.{enemy.level}</span>
                  <span className={styles.enemyDetail}>{enemy.boss && bossLocked ? `토벌 자격 ${bossProgress.current}/${bossProgress.required}` : enemy.description}</span>
                </span>
                <span className={styles.enemyReward}>EXP {formatNumber(enemy.exp)}<br />{formatNumber(enemy.goldMin)}-{formatNumber(enemy.goldMax)} G</span>
              </button>
            );
          })}
        </div>
        <div className={styles.huntFooter}>
          <p className={styles.huntHint}>{selectedEnemy.boss && !bossProgress.available ? `일반 몬스터를 ${bossProgress.required - bossProgress.current}마리 더 처치하면 우두머리가 열립니다.` : `${selectedEnemy.name}을 사냥해 경험치, 숙련도와 절차 생성 장비를 획득합니다.`}</p>
          <div className={styles.buttonGroup}>
            <button className={styles.ghostButton} disabled={selectedEnemy.boss && !bossProgress.available} onClick={() => beginEncounter(false)}><Swords size={14} /> 전투 시작</button>
            <button className={styles.primaryButton} disabled={selectedEnemy.boss && !bossProgress.available} onClick={() => beginEncounter(true)}><Play size={14} /> 자동 사냥</button>
          </div>
        </div>
      </section>
    );
  };

  const renderEquipment = () => (
    <div className={styles.equipmentLayout}>
      <section className={styles.panel}>
        <div className={styles.sectionIntro}><h2 className={styles.sectionTitle}>착용 장비</h2><p className={styles.sectionCopy}>강화는 실패하지 않으며 +10까지 누적됩니다. 장비 교체 전후 전투력은 즉시 반영됩니다.</p></div>
        {(Object.keys(game.equipment) as EquipmentSlot[]).map((slot) => {
          const item = game.equipment[slot];
          return item ? renderItemRow(item, true) : <div className={styles.inventoryRow} key={slot}><p className={styles.itemName}>{EQUIPMENT_SLOT_LABELS[slot]}</p><p className={styles.itemStats}>장착한 장비가 없습니다.</p></div>;
        })}
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><h2 className={styles.panelTitle}><Backpack size={14} /> 가방</h2><span className={styles.panelMeta}>{game.inventory.length}/60</span></div>
        <div className={styles.scrollBody}>{game.inventory.length ? game.inventory.slice().reverse().map((item) => renderItemRow(item)) : <div className={styles.emptyState}>사냥에서 획득한 장비가 이곳에 보관됩니다.</div>}</div>
      </section>
    </div>
  );

  const renderGrowth = () => (
    <div className={styles.growthLayout}>
      <section className={styles.panel}>
        <div className={styles.sectionIntro}><h2 className={styles.sectionTitle}>능력치 훈련</h2><p className={styles.sectionCopy}>보유 포인트 {game.statPoints} · 레벨이 오를 때마다 3포인트를 얻습니다.</p></div>
        {(Object.keys(CORE_STAT_LABELS) as CoreStatId[]).map((stat) => (
          <div className={styles.attributeRow} key={stat}>
            <div><p className={styles.attributeLabel}>{CORE_STAT_LABELS[stat]}</p><p className={styles.attributeEffect}>{STAT_DESCRIPTIONS[stat]}</p></div>
            <div className={styles.attributeControls}><span className={styles.attributeValue}>{game.baseStats[stat]}</span><button className={styles.iconButton} title={`${CORE_STAT_LABELS[stat]} 1 올리기`} disabled={game.statPoints < 1 || Boolean(game.combat)} onClick={() => applyResult(allocateStat(game, stat))}><Plus size={15} /></button></div>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionIntro}><h2 className={styles.sectionTitle}>{classDefinition.name} 기술</h2><p className={styles.sectionCopy}>보유 기술 포인트 {game.skillPoints} · 숙련도가 오를 때마다 기술 포인트를 얻습니다.</p></div>
        <div className={styles.skillList}>
          {(['skill1', 'skill2'] as SkillSlot[]).map((slot) => {
            const skill = classDefinition.skills[slot];
            const rank = game.skillRanks[slot];
            const locked = game.level < skill.unlockLevel;
            const cost = getSkillUpgradeCost(game, slot);
            return (
              <div className={styles.skillRow} key={slot}>
                <div className={styles.skillTop}><div><p className={styles.skillName}><Sparkles size={13} /> {skill.name}</p><p className={styles.skillDesc}>{skill.description}</p></div><span className={styles.slotEnhance}>{locked ? `Lv.${skill.unlockLevel}` : `${rank}/${MAX_SKILL_RANK}`}</span></div>
                <div className={styles.itemActions}><button className={styles.smallButton} disabled={locked || rank >= MAX_SKILL_RANK || game.skillPoints < cost || Boolean(game.combat)} onClick={() => applyResult(upgradeSkill(game, slot))}><Plus size={12} /> 강화 {cost}P</button></div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );

  const renderCollection = () => {
    const discovered = game.discoveredItemKeys
      .map((itemKey) => getGearDisplayFromItemKey(itemKey))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => collectionFilter === 'all' || item.slot === collectionFilter)
      .slice(-120)
      .reverse();
    const nextMilestone = Math.min(TOTAL_ITEM_VARIETIES, Math.max(10, Math.ceil((game.discoveredItemKeys.length + 1) / 10) * 10));
    return (
      <div className={styles.collectionLayout}>
        <section className={styles.panel}>
          <div className={styles.collectionSummary}>
            <div><h2 className={styles.sectionTitle}>장비 도감</h2><p className={styles.sectionCopy}>재질, 계열, 접두·접미 옵션, 등급과 품질이 모두 다른 조합으로 기록됩니다.</p></div>
            <div className={styles.collectionCount}>{formatNumber(game.discoveredItemKeys.length)} <small>/ {formatNumber(TOTAL_ITEM_VARIETIES)}</small></div>
          </div>
          <div className={styles.filterBar}>
            {(['all', 'weapon', 'armor', 'accessory'] as CollectionFilter[]).map((filter) => <button key={filter} className={`${styles.filterButton} ${collectionFilter === filter ? styles.filterButtonActive : ''}`} onClick={() => setCollectionFilter(filter)}>{filter === 'all' ? '전체' : EQUIPMENT_SLOT_LABELS[filter]}</button>)}
          </div>
          {discovered.length ? <div className={styles.collectionGrid}>{discovered.map((item) => <div className={styles.collectionItem} key={item.itemKey}><span className={styles.collectionIcon}><AdventureIcon name={item.icon} size={19} /></span><span><p className={`${styles.collectionName} ${RARITY_CLASS[item.rarity]}`}>{item.name}</p><p className={styles.collectionKey}>{item.rarityLabel} · {item.qualityLabel} · {item.slotLabel}</p></span></div>)}</div> : <div className={styles.emptyState}>아직 발견한 장비가 없습니다.<br />사냥을 시작하면 첫 도감 항목이 등록됩니다.</div>}
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><h2 className={styles.panelTitle}><Trophy size={14} /> 수집 목표</h2></div>
          <div className={styles.panelBody}><p className={styles.goalEyebrow}>다음 이정표</p><p className={styles.goalTitle}>{formatNumber(nextMilestone)}종 발견</p><p className={styles.goalCopy}>현재 수집률 {((game.discoveredItemKeys.length / TOTAL_ITEM_VARIETIES) * 100).toFixed(3)}%. 같은 조합은 중복 등록되지 않습니다.</p><div className={styles.progressMini}><div className={styles.progressMiniFill} style={{ width: percent(game.discoveredItemKeys.length / nextMilestone) }} /></div></div>
        </section>
      </div>
    );
  };

  const renderRanking = () => {
    if (!user) {
      return (
        <section className={styles.panel}>
          <div className={styles.emptyState}>
            <div><Trophy size={28} /><br />온라인 랭킹은 로그인한 모험가만 참여할 수 있습니다.<br /><Link className={styles.primaryButton} href="/login">로그인하고 참가</Link></div>
          </div>
        </section>
      );
    }
    return (
      <div className={styles.rankingLayout}>
        <section className={styles.panel}>
          <div className={styles.rankingHero}>
            <div><h2 className={styles.sectionTitle}>모험가 전투력 랭킹</h2><p className={styles.sectionCopy}>Firebase에 저장된 상위 100명의 전투력을 실시간으로 집계합니다.</p></div>
            <span className={styles.onlineBadge}><span className={styles.onlineDot} />현재 {onlineCount}명 접속</span>
          </div>
          {rankingLoading ? <div className={styles.emptyState}>랭킹을 불러오는 중입니다.</div> : rankings.length === 0 ? <div className={styles.emptyState}>아직 등록된 모험가가 없습니다.<br />첫 저장이 완료되면 자동으로 순위에 참가합니다.</div> : (
            <div className={styles.rankingScroll}>
              <div className={styles.rankingTable}>
                <div className={`${styles.rankingRow} ${styles.rankingHead}`}><span>순위</span><span>모험가</span><span>전투력</span><span>성장</span><span>처치</span><span>도감</span></div>
                {rankings.map((entry, index) => {
                  const entryClass = CLASS_DEFINITIONS[entry.classId] ?? CLASS_DEFINITIONS.vanguard;
                  const isMe = entry.uid === user.uid;
                  return (
                    <div className={`${styles.rankingRow} ${isMe ? styles.rankingRowMe : ''}`} key={entry.uid}>
                      <span className={`${styles.rankNumber} ${index < 3 ? styles.rankTop : ''}`}>{index + 1}</span>
                      <span className={styles.rankPlayer}><span className={styles.rankAvatar}>{entry.photoURL ? <Image src={entry.photoURL} alt="" width={32} height={32} /> : <AdventureIcon name={entryClass.icon} size={17} />}</span><span><span className={styles.rankName}>{entry.displayName}{isMe && ' (나)'}</span><span className={styles.rankClass}>{entryClass.name} · 숙련 {entry.masteryLevel}</span></span></span>
                      <span className={`${styles.rankMetric} ${styles.rankPower}`}>{formatNumber(entry.power)}</span>
                      <span className={styles.rankMetric}>Lv.{entry.level}</span>
                      <span className={styles.rankMetric}>{formatNumber(entry.totalKills)}</span>
                      <span className={styles.rankMetric}>{formatNumber(entry.collectionCount)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><h2 className={styles.panelTitle}><Trophy size={14} /> 내 경쟁 기록</h2></div>
          <div className={styles.panelBody}><p className={styles.goalEyebrow}>현재 순위</p><p className={styles.rankingHeroValue}>{myRank ? `${myRank}위` : '집계 중'}</p><p className={styles.goalCopy}>전투력 {formatNumber(derived.power)} · Lv.{game.level} · 총 처치 {formatNumber(game.statistics.totalKills)}</p></div>
          <div className={styles.statGrid}><div className={styles.statCell}><span className={styles.statName}>보스 토벌</span><span className={styles.statValue}>{formatNumber(game.statistics.bossesKilled)}</span></div><div className={styles.statCell}><span className={styles.statName}>도감</span><span className={styles.statValue}>{formatNumber(game.discoveredItemKeys.length)}</span></div><div className={styles.statCell}><span className={styles.statName}>숙련도</span><span className={styles.statValue}>{game.mastery.level}</span></div><div className={styles.statCell}><span className={styles.statName}>승리</span><span className={styles.statValue}>{formatNumber(game.statistics.battlesWon)}</span></div></div>
        </section>
      </div>
    );
  };

  const renderSideContent = () => {
    if (sideTab === 'inventory') {
      return game.inventory.length ? <div className={styles.inventoryList}>{game.inventory.slice(-12).reverse().map((item) => {
        const display = getEquipmentDisplay(item);
        return <div className={styles.inventoryRow} key={item.instanceId}><div className={styles.itemTop}><div><p className={`${styles.itemName} ${RARITY_CLASS[item.rarity]}`}>{display.name}</p><p className={styles.itemStats}>{itemStats(item)}</p></div></div><div className={styles.itemActions}><button className={styles.smallButton} disabled={Boolean(game.combat)} onClick={() => applyResult(equipItem(game, item.instanceId))}><Check size={11} /> 장착</button></div></div>;
      })}</div> : <div className={styles.emptyState}><PackageOpen size={25} /><br />가방이 비어 있습니다.</div>;
    }
    if (sideTab === 'log') {
      return <ul className={styles.logList}>{game.logs.slice().reverse().map((entry) => <li className={styles.logItem} key={entry.id}>{entry.text}</li>)}</ul>;
    }
    return <div className={styles.questList}>{questProgress.map((progress) => <div className={styles.questRow} key={progress.quest.id}><div className={styles.questTop}><div><p className={styles.questName}>{progress.quest.name}</p><p className={styles.questDesc}>{progress.quest.description}</p></div>{progress.claimed ? <span className={styles.questClaimed}>완료</span> : progress.completed ? <button className={styles.smallButton} onClick={() => applyResult(claimQuest(game, progress.quest.id))}>받기</button> : null}</div><div className={styles.progressMini}><div className={styles.progressMiniFill} style={{ width: percent(progress.ratio) }} /></div><p className={styles.questReward}>{progress.current}/{progress.target} · {formatNumber(progress.quest.reward.gold)} G · EXP {formatNumber(progress.quest.reward.exp)}</p></div>)}</div>;
  };

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link className={styles.brand} href="/rooms"><span className={styles.brandMark}><Swords size={20} /></span><span><h1 className={styles.brandTitle}>대목 모험가 길드</h1><p className={styles.brandSub}>영구 성장형 브라우저 RPG</p></span></Link>
          <div className={styles.accountSummary}>
            <div className={styles.summaryItem}><span className={styles.summaryLabel}>캐릭터</span><span className={styles.summaryValue}>Lv.{game.level} {game.name}</span></div>
            <div className={styles.summaryItem}><span className={styles.summaryLabel}>전투력</span><span className={styles.summaryValue}>{formatNumber(derived.power)}</span></div>
            <div className={styles.summaryItem}><span className={styles.summaryLabel}>보유 골드</span><span className={`${styles.summaryValue} ${styles.summaryValueGold}`}>{formatNumber(game.gold)} G</span></div>
            <div className={styles.summaryItem}><span className={styles.summaryLabel}>장비 도감</span><span className={styles.summaryValue}>{formatNumber(game.discoveredItemKeys.length)} / {formatNumber(TOTAL_ITEM_VARIETIES)}</span></div>
          </div>
          <div className={styles.topActions}><span className={styles.saveStatus}>{saveStatus}</span><button className={styles.iconButton} title="캐릭터 초기화" onClick={resetCharacter}><RotateCcw size={15} /></button><Link className={styles.iconButton} href="/rooms" title="로비로 나가기"><LogOut size={16} /></Link></div>
        </div>
      </header>

      <nav className={styles.nav} aria-label="모험 메뉴"><div className={styles.navInner}>
        {([
          ['hunt', Map, '사냥터'],
          ['equipment', Backpack, '장비'],
          ['growth', ChartNoAxesColumnIncreasing, '성장'],
          ['collection', Library, '아이템 도감'],
          ['ranking', Trophy, '랭킹'],
        ] as const).map(([tab, Icon, label]) => <button key={tab} className={`${styles.navButton} ${activeTab === tab ? styles.navButtonActive : ''}`} title={label} onClick={() => setActiveTab(tab)}><Icon size={15} /><span>{label}</span></button>)}
      </div></nav>

      <div className={styles.mobileSummary} aria-label="캐릭터 요약">
        <div className={styles.mobileSummaryItem}><span className={styles.mobileSummaryLabel}>캐릭터</span><span className={styles.mobileSummaryValue}>Lv.{game.level} {game.name}</span></div>
        <div className={styles.mobileSummaryItem}><span className={styles.mobileSummaryLabel}>전투력</span><span className={styles.mobileSummaryValue}>{formatNumber(derived.power)}</span></div>
        <div className={styles.mobileSummaryItem}><span className={styles.mobileSummaryLabel}>골드</span><span className={`${styles.mobileSummaryValue} ${styles.summaryValueGold}`}>{formatNumber(game.gold)} G</span></div>
      </div>

      <div className={styles.shell}>
        <aside className={styles.leftRail}>
          <section className={styles.panel}>
            <div className={styles.characterHead}><div className={styles.portrait}><AdventureIcon name={classDefinition.icon} size={30} /></div><div><p className={styles.characterName}>{game.name}</p><p className={styles.characterClass}>Lv.{game.level} {classDefinition.name}</p><span className={styles.rankBadge}>{rankFor(game.level)}</span></div></div>
            <div className={styles.meterBlock}><div className={styles.meterLabels}><span>체력</span><span>{formatNumber(game.hp)} / {formatNumber(derived.maxHp)}</span></div><Meter ratio={game.hp / derived.maxHp} variant="hp" label="체력" /></div>
            <div className={styles.meterBlock}><div className={styles.meterLabels}><span>경험치</span><span>{formatNumber(levelProgress.exp)} / {formatNumber(levelProgress.needed)}</span></div><Meter ratio={levelProgress.ratio} variant="exp" label="경험치" /></div>
            <div className={styles.meterBlock}><div className={styles.meterLabels}><span>직업 숙련 {game.mastery.level}</span><span>{formatNumber(masteryProgress.exp)} / {formatNumber(masteryProgress.needed)}</span></div><Meter ratio={masteryProgress.ratio} variant="mastery" label="직업 숙련도" /></div>
            <div className={styles.combatPower}><span className={styles.combatPowerLabel}>종합 전투력</span><strong className={styles.combatPowerValue}>{formatNumber(derived.power)}</strong></div>
            <div className={styles.statGrid}><div className={styles.statCell}><span className={styles.statName}>공격</span><span className={styles.statValue}>{derived.attack}</span></div><div className={styles.statCell}><span className={styles.statName}>방어</span><span className={styles.statValue}>{derived.defense}</span></div><div className={styles.statCell}><span className={styles.statName}>치명타</span><span className={styles.statValue}>{derived.crit}%</span></div><div className={styles.statCell}><span className={styles.statName}>물약</span><span className={styles.statValue}>{game.potions}개</span></div></div>
            <div className={styles.nextGoal}><p className={styles.goalEyebrow}>다음 성장 목표</p><p className={styles.goalTitle}>{nextRegion ? `Lv.${nextRegion.unlockLevel} ${nextRegion.name} 해금` : `${region.name} 우두머리 반복 토벌`}</p><p className={styles.goalCopy}>{nextRegion ? `새 지역까지 ${nextRegion.unlockLevel - game.level}레벨 남았습니다.` : '최고 지역에서 희귀 조합 장비를 수집하세요.'}</p><div className={styles.itemActions}><button className={styles.smallButton} disabled={Boolean(game.combat) || game.hp >= derived.maxHp} onClick={() => applyResult(restAtTown(game, game.hp < derived.maxHp * 0.5 ? 'free' : 'gold'))}><Heart size={11} /> 회복 {game.hp < derived.maxHp * 0.5 ? '무료' : `${formatNumber(restCost)}G`}</button></div></div>
          </section>
          <section className={styles.panel}><div className={styles.panelHeader}><h2 className={styles.panelTitle}><Backpack size={14} /> 착용 장비</h2></div><div className={styles.equipmentSlots}>{(Object.keys(game.equipment) as EquipmentSlot[]).map((slot) => { const item = game.equipment[slot]; const display = item ? getEquipmentDisplay(item) : null; return <div className={styles.equipmentSlot} key={slot}><span className={styles.slotIcon}>{display ? <AdventureIcon name={display.icon} size={16} /> : <LockKeyhole size={14} />}</span><span><span className={styles.slotName}>{EQUIPMENT_SLOT_LABELS[slot]}</span><span className={`${styles.slotItem} ${item ? RARITY_CLASS[item.rarity] : ''}`}>{display?.name ?? '비어 있음'}</span></span>{item && <span className={styles.slotEnhance}>+{item.enhance}</span>}</div>; })}</div></section>
        </aside>

        <section className={styles.mainColumn}>
          {activeTab === 'hunt' && <>
            <section className={styles.hero}>
              <Image className={styles.heroImage} src="/adventure-assets/frontier.webp" alt={`${region.name}으로 이어지는 모험 지역`} fill priority sizes="(max-width: 760px) 100vw, 70vw" />
              <div className={styles.heroShade} />
              <div className={styles.heroContent}><div className={styles.locationTop}><div><p className={styles.locationEyebrow}>현재 사냥터 · Lv.{region.unlockLevel} 이상</p><h2 className={styles.locationName}>{region.name}</h2><p className={styles.locationDesc}>{region.description}</p></div><span className={styles.recommendedBadge}>권장 전투력 {formatNumber(region.recommendedPower)}</span></div><div className={styles.zoneNav}>{REGION_IDS.map((regionId) => { const zone = REGION_DEFINITIONS[regionId]; const unlocked = isRegionUnlocked(game, regionId); return <button key={regionId} className={`${styles.zoneButton} ${regionId === region.id ? styles.zoneButtonActive : ''}`} disabled={!unlocked || Boolean(game.combat)} onClick={() => travel(regionId)}><span className={styles.zoneLevel}>{unlocked ? `Lv.${zone.unlockLevel}` : `Lv.${zone.unlockLevel} 잠김`}</span><span className={styles.zoneName}>{zone.name}</span></button>; })}</div></div>
            </section>
            {renderHunt()}
          </>}
          {activeTab === 'equipment' && renderEquipment()}
          {activeTab === 'growth' && renderGrowth()}
          {activeTab === 'collection' && renderCollection()}
          {activeTab === 'ranking' && renderRanking()}
        </section>

        <aside className={styles.rightRail}>
          <section className={styles.panel}><div className={styles.rightTabs}><button className={`${styles.rightTab} ${sideTab === 'quests' ? styles.rightTabActive : ''}`} onClick={() => setSideTab('quests')}>임무 {claimableQuests > 0 && `(${claimableQuests})`}</button><button className={`${styles.rightTab} ${sideTab === 'inventory' ? styles.rightTabActive : ''}`} onClick={() => setSideTab('inventory')}>가방</button><button className={`${styles.rightTab} ${sideTab === 'log' ? styles.rightTabActive : ''}`} onClick={() => setSideTab('log')}>기록</button></div><div className={styles.scrollBody}>{renderSideContent()}</div></section>
          <section className={styles.panel}><div className={styles.panelHeader}><h2 className={styles.panelTitle}><Activity size={14} /> 모험 기록</h2></div><div className={styles.statGrid}><div className={styles.statCell}><span className={styles.statName}>승리</span><span className={styles.statValue}>{formatNumber(game.statistics.battlesWon)}</span></div><div className={styles.statCell}><span className={styles.statName}>우두머리</span><span className={styles.statValue}>{formatNumber(game.statistics.bossesKilled)}</span></div><div className={styles.statCell}><span className={styles.statName}>장비 발견</span><span className={styles.statValue}>{formatNumber(game.statistics.equipmentFound)}</span></div><div className={styles.statCell}><span className={styles.statName}>오프라인 사냥</span><span className={styles.statValue}>{formatNumber(game.statistics.offlineKills)}</span></div></div><div className={styles.nextGoal}><p className={styles.goalEyebrow}>우두머리 토벌 자격</p><p className={styles.goalTitle}>{bossProgress.current} / {bossProgress.required} 처치</p><p className={styles.goalCopy}>각 지역의 일반 몬스터를 {BOSS_KILLS_REQUIRED}마리씩 처치할 때마다 토벌 기회가 열립니다.</p></div></section>
        </aside>
      </div>

      {notice && <div className={styles.notice}>{notice}</div>}
      {offlineSummary && <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="offline-title"><div className={styles.modal}><div className={styles.modalHead}><h2 id="offline-title" className={styles.modalTitle}>돌아온 모험가의 정산</h2><p className={styles.modalCopy}>{REGION_DEFINITIONS[offlineSummary.regionId].name}에서 최대 8시간까지 자동으로 활동한 결과입니다.</p></div><div className={styles.modalStats}><div className={styles.modalStat}><span className={styles.modalStatLabel}>사냥 시간</span><span className={styles.modalStatValue}>{offlineSummary.hours.toFixed(1)}시간</span></div><div className={styles.modalStat}><span className={styles.modalStatLabel}>처치</span><span className={styles.modalStatValue}>{formatNumber(offlineSummary.estimatedKills)}</span></div><div className={styles.modalStat}><span className={styles.modalStatLabel}>골드</span><span className={styles.modalStatValue}>{formatNumber(offlineSummary.gold)}</span></div></div><div className={styles.modalFooter}><button className={styles.primaryButton} onClick={() => setOfflineSummary(null)}><Check size={14} /> 확인</button></div></div></div>}
    </main>
  );
}
