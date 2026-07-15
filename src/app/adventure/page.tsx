'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Backpack,
  ChartNoAxesColumnIncreasing,
  Check,
  DoorOpen,
  Gem,
  Hammer,
  Library,
  LockKeyhole,
  LogOut,
  Map,
  PackageOpen,
  Plus,
  RotateCcw,
  Sparkles,
  Swords,
  Trash2,
  Trophy,
  Zap,
} from 'lucide-react';
import AdventureIcon from '@/components/adventure/AdventureIcon';
import AdventureTownHub3D from '@/components/adventure/AdventureTownHub3D';
import AdventureTownServicePanel from '@/components/adventure/AdventureTownServicePanel';
import HackSlashArena, {
  type ArenaDefeatEvent,
  type ArenaKillEvent,
} from '@/components/adventure/HackSlashArena';
import { useAuth } from '@/hooks/useAuth';
import {
  loadAdventureGeneration,
  loadAdventureState,
  resetAdventureStateAndRanking,
  saveAdventureStateAndRanking,
  startAdventurePresence,
  subscribeAdventureOnlineCount,
  subscribeAdventureRankings,
  subscribeAdventureState,
  type AdventureRankingEntry,
  type AdventureUser,
} from '@/lib/adventureFirebase';
import {
  BOSS_KILLS_REQUIRED,
  CLASS_DEFINITIONS,
  CLASS_IDS,
  CORE_STAT_LABELS,
  EQUIPMENT_SLOT_LABELS,
  MAX_ENHANCE,
  MAX_SKILL_RANK,
  REGION_DEFINITIONS,
  REGION_IDS,
  RUNE_DEFINITIONS,
  RUNE_IDS,
  RUNE_WORD_BY_ID,
  RUNE_WORD_RECIPES,
  SET_ITEM_DEFINITIONS,
  SKILL_SLOTS,
  TOTAL_ITEM_VARIETIES,
  UNIQUE_ITEM_DEFINITIONS,
  allocateStat,
  claimQuest,
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
  getSkillUpgradeCost,
  insertRuneIntoItem,
  resolveAdventureCombatModifiers,
  sanitizeAdventureState,
  sellItem,
  setSkillLoadoutSlot,
  upgradeSkill,
  type AdventureResult,
  type AdventureSpecialEffect,
  type AdventureState,
  type CharacterClassId,
  type CoreStatId,
  type EquipmentInstance,
  type EquipmentRarity,
  type EquipmentSlot,
  type RuneId,
  type SkillSlot,
} from '@/lib/adventure';
import {
  resolveWildernessArenaDefeat,
  resolveWildernessArenaKill,
  returnToTown,
  withAdventureTownState,
  type TownAdventureState,
  type TownServiceId,
} from '@/lib/adventureTown';
import styles from './adventure.module.css';

type MainTab = 'hunt' | 'equipment' | 'growth' | 'collection' | 'ranking';
type SideTab = 'quests' | 'inventory' | 'log';
type CollectionFilter = 'all' | EquipmentSlot;

const SAVE_KEY_PREFIX = 'daemok-adventure-v1';
const ARENA_SKILL_HOTKEYS = ['KeyQ', 'KeyE', 'KeyR', 'KeyF', 'Digit1', 'Digit2'] as const;
const ARENA_SKILL_KEY_LABELS = ['Q', 'E', 'R', 'F', '1', '2'] as const;

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

function describeSpecialEffect(effect: AdventureSpecialEffect) {
  if (effect.kind === 'onHit') {
    const extras = [
      `${Math.round(effect.chance * 100)}% 확률`,
      `${Math.round(effect.damageMultiplier * 100)}% ${effect.element} 피해`,
      effect.chainTargets ? `${effect.chainTargets}대상 연쇄` : '',
      effect.lifeStealPercent ? `피해의 ${(effect.lifeStealPercent * 100).toFixed(1)}% 회복` : '',
    ].filter(Boolean);
    return extras.join(' · ');
  }
  if (effect.kind === 'onKill') {
    return [
      `${Math.round(effect.chance * 100)}% 확률`,
      effect.healPercent ? `최대 생명력 ${(effect.healPercent * 100).toFixed(1)}% 회복` : '',
      effect.explosionDamageMultiplier ? `${Math.round(effect.explosionDamageMultiplier * 100)}% 처치 폭발` : '',
      effect.cooldownReductionSeconds ? `재사용 ${effect.cooldownReductionSeconds}초 환급` : '',
    ].filter(Boolean).join(' · ');
  }
  if (effect.kind === 'onCast') {
    return [
      `${Math.round(effect.chance * 100)}% 확률`,
      effect.echoDamageMultiplier ? `${Math.round(effect.echoDamageMultiplier * 100)}% 위력 복창` : '',
      effect.cooldownRefundSeconds ? `재사용 ${effect.cooldownRefundSeconds}초 환급` : '',
    ].filter(Boolean).join(' · ');
  }
  if (effect.kind === 'lowLife') {
    return `생명력 ${Math.round(effect.threshold * 100)}% 이하 · 피해 ${Math.round((effect.damageMultiplier - 1) * 100)}% 증가 · 받는 피해 ${Math.round((1 - effect.damageTakenMultiplier) * 100)}% 감소`;
  }
  if (effect.kind === 'projectile') {
    return `투사체 +${effect.additionalProjectiles} · 관통 +${effect.pierce} · 속도 ${Math.round((effect.speedMultiplier - 1) * 100)}%`;
  }
  if (effect.kind === 'elemental') {
    return `${effect.element} 피해 ${Math.round((effect.damageMultiplier - 1) * 100)}% 증가 · 관통 ${Math.round(effect.penetration * 100)}%`;
  }
  return `${effect.skill} 피해 ${Math.round((effect.damageMultiplier - 1) * 100)}% · 재사용 ${Math.round((1 - effect.cooldownMultiplier) * 100)}% 감소 · 범위 ${Math.round((effect.rangeMultiplier - 1) * 100)}%`;
}

function rankFor(level: number) {
  if (level >= 30) return '대목의 수호자';
  if (level >= 20) return '황금 모험가';
  if (level >= 12) return '왕실 모험가';
  if (level >= 5) return '숙련 모험가';
  return '새싹 모험가';
}

function townPayload(raw: unknown) {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as { town?: unknown }).town
    : undefined;
}

function normalizeTownAdventureState(
  state: AdventureState,
  fallback?: TownAdventureState | null,
): TownAdventureState {
  return withAdventureTownState(
    { ...state, combat: null },
    townPayload(state) ?? fallback?.town,
  );
}

export default function AdventurePage() {
  const { user, loading: authLoading } = useAuth();
  const [game, setGame] = useState<TownAdventureState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState('불러오는 중');
  const [activeTab, setActiveTab] = useState<MainTab>('hunt');
  const [sideTab, setSideTab] = useState<SideTab>('quests');
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>('all');
  const [selectedClass, setSelectedClass] = useState<CharacterClassId>('vanguard');
  const [characterName, setCharacterName] = useState('');
  const [runeTargetId, setRuneTargetId] = useState<string | null>(null);
  const [editingSkillSlot, setEditingSkillSlot] = useState<number | null>(null);
  const [battlefieldSkillsOpen, setBattlefieldSkillsOpen] = useState(false);
  const [selectedTownService, setSelectedTownService] = useState<TownServiceId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rankings, setRankings] = useState<AdventureRankingEntry[]>([]);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [onlineCount, setOnlineCount] = useState(0);
  const [resetSyncPending, setResetSyncPending] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameRef = useRef<TownAdventureState | null>(null);
  const saveEpochRef = useRef(0);
  const savingRef = useRef(false);
  const resetPendingRef = useRef(false);
  const resetGenerationRef = useRef(0);
  const resetGenerationUidRef = useRef<string | null>(null);
  const hydratedUidRef = useRef<string | null>(null);
  const currentUserUidRef = useRef<string | null>(user?.uid ?? null);
  const resetOperationRef = useRef(0);
  const subscribedAdventureRef = useRef<{
    uid: string;
    state: TownAdventureState | null;
    generation: number;
  } | null>(null);
  const pendingSaveRef = useRef<{ user: AdventureUser; state: TownAdventureState; epoch: number } | null>(null);
  const activeSaveRef = useRef<Promise<void>>(Promise.resolve());

  const uid = user?.uid ?? 'guest';
  const localSaveKey = `${SAVE_KEY_PREFIX}:${uid}`;
  currentUserUidRef.current = user?.uid ?? null;

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2600);
  }, []);

  const adoptResetGeneration = useCallback((userId: string, generation: number) => {
    if (resetGenerationUidRef.current !== userId) {
      resetGenerationUidRef.current = userId;
      resetGenerationRef.current = generation;
    } else {
      resetGenerationRef.current = Math.max(resetGenerationRef.current, generation);
    }
    return resetGenerationRef.current;
  }, []);

  const queueAdventureSave = useCallback((saveUser: AdventureUser, state: TownAdventureState) => {
    const epoch = saveEpochRef.current;
    pendingSaveRef.current = { user: saveUser, state, epoch };
    if (savingRef.current) return;

    savingRef.current = true;
    const drain = async () => {
      while (pendingSaveRef.current) {
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        try {
          await saveAdventureStateAndRanking(pending.user, pending.state);
          if (
            pending.epoch === saveEpochRef.current
            && !pendingSaveRef.current
            && gameRef.current?.updatedAt === pending.state.updatedAt
          ) setSaveStatus('저장됨');
        } catch {
          if (
            pending.epoch === saveEpochRef.current
            && !pendingSaveRef.current
            && gameRef.current?.updatedAt === pending.state.updatedAt
          ) setSaveStatus('로컬 저장됨');
        }
      }
      savingRef.current = false;
    };
    const operation = drain();
    activeSaveRef.current = operation;
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
      const loadingUid = user?.uid ?? null;
      if (hydratedUidRef.current !== loadingUid) {
        resetOperationRef.current += 1;
        resetPendingRef.current = false;
        setResetSyncPending(false);
        saveEpochRef.current += 1;
        pendingSaveRef.current = null;
      }
      hydratedUidRef.current = null;
      setHydrated(false);
      setSaveStatus('불러오는 중');
      let candidate: TownAdventureState | null = null;
      let localCandidate: TownAdventureState | null = null;

      if (user) {
        try {
          const localRaw = window.localStorage.getItem(localSaveKey);
          if (localRaw) {
            const parsed = JSON.parse(localRaw) as unknown;
            localCandidate = withAdventureTownState(sanitizeAdventureState(parsed), townPayload(parsed));
          }
        } catch {
          window.localStorage.removeItem(localSaveKey);
        }
        try {
          const [remote, resetGeneration] = await Promise.all([
            loadAdventureState(user.uid),
            loadAdventureGeneration(user.uid),
          ]);
          if (cancelled) return;
          const subscribed = subscribedAdventureRef.current;
          const userSubscription = subscribed?.uid === user.uid ? subscribed : null;
          const authoritativeGeneration = adoptResetGeneration(
            user.uid,
            Math.max(resetGeneration, userSubscription?.generation ?? 0),
          );
          if (localCandidate && localCandidate.resetGeneration !== authoritativeGeneration) localCandidate = null;
          const fetchedRemote = remote?.resetGeneration === authoritativeGeneration ? remote : null;
          const subscribedRemote = userSubscription?.state?.resetGeneration === authoritativeGeneration
            ? userSubscription.state
            : null;
          const validRemote = subscribedRemote && (!fetchedRemote || subscribedRemote.updatedAt > fetchedRemote.updatedAt)
            ? subscribedRemote
            : fetchedRemote;
          candidate = localCandidate && (!validRemote || localCandidate.updatedAt > validRemote.updatedAt)
            ? localCandidate
            : validRemote ?? localCandidate;
        } catch {
          const subscribed = subscribedAdventureRef.current;
          const userSubscription = subscribed?.uid === user.uid ? subscribed : null;
          if (userSubscription) {
            const authoritativeGeneration = adoptResetGeneration(user.uid, userSubscription.generation);
            if (localCandidate?.resetGeneration !== authoritativeGeneration) localCandidate = null;
            const subscribedRemote = userSubscription.state?.resetGeneration === authoritativeGeneration
              ? userSubscription.state
              : null;
            candidate = localCandidate && (!subscribedRemote || localCandidate.updatedAt > subscribedRemote.updatedAt)
              ? localCandidate
              : subscribedRemote ?? localCandidate;
          } else {
            if (
              resetGenerationUidRef.current === user.uid
              && localCandidate?.resetGeneration !== resetGenerationRef.current
            ) localCandidate = null;
            candidate = localCandidate;
          }
          setSaveStatus('로컬 저장');
        }
      }

      if (cancelled) return;
      if (candidate) {
        setGame(normalizeTownAdventureState(candidate));
      } else {
        setGame(null);
        setCharacterName(user?.displayName?.slice(0, 16) ?? '');
      }
      setHydrated(true);
      hydratedUidRef.current = user?.uid ?? null;
      setSaveStatus(user ? '클라우드 연결' : '로컬 저장');
    };

    loadSave();
    return () => { cancelled = true; };
  }, [adoptResetGeneration, authLoading, localSaveKey, user]);

  useEffect(() => {
    if (!hydrated || !game || !user || hydratedUidRef.current !== user.uid) return;
    window.localStorage.setItem(localSaveKey, JSON.stringify(game));
    setSaveStatus('저장 중');
    queueAdventureSave(user, game);
  }, [game, hydrated, localSaveKey, queueAdventureSave, user]);

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
    const stopState = subscribeAdventureState(user.uid, (remoteState, resetGeneration) => {
      const adoptedGeneration = adoptResetGeneration(user.uid, resetGeneration);
      if (resetGeneration < adoptedGeneration) return;
      subscribedAdventureRef.current = {
        uid: user.uid,
        state: remoteState,
        generation: resetGeneration,
      };
      const current = gameRef.current;
      if (current && current.resetGeneration !== resetGeneration) {
        saveEpochRef.current += 1;
        pendingSaveRef.current = null;
        window.localStorage.removeItem(`${SAVE_KEY_PREFIX}:${user.uid}`);
        gameRef.current = null;
        setGame(null);
        return;
      }
      if (resetPendingRef.current) return;
      if (
        remoteState
        && remoteState.resetGeneration === resetGeneration
        && (!current || remoteState.updatedAt > current.updatedAt)
      ) setGame(normalizeTownAdventureState(remoteState, current));
    });
    return () => {
      stopRanking();
      stopOnlineCount();
      stopPresence();
      stopState();
    };
  }, [adoptResetGeneration, user]);

  const applyResult = useCallback((result: AdventureResult) => {
    setGame((current) => normalizeTownAdventureState(result.state, current));
    if (!result.ok && result.message) showNotice(result.message);
  }, [showNotice]);

  const settleArenaKill = useCallback((event: ArenaKillEvent) => {
    setGame((current) => {
      if (!current || current.town.location !== 'wilderness') return current;
      const result = resolveWildernessArenaKill(current, event.enemyId, {
        runId: event.runId,
        checkpoint: event.checkpoint,
        wave: event.wave,
        totalWaves: event.totalWaves,
        damageTaken: event.damageTaken,
        damageDealt: event.damageDealt,
        remainingHp: event.remainingHp,
        elite: event.elite,
        affixes: event.affixes,
        continuous: true,
        expeditionComplete: event.expeditionComplete,
      });
      if (!result.ok) {
        if (result.message) queueMicrotask(() => showNotice(result.message!));
        return current;
      }
      return normalizeTownAdventureState(result.state, current);
    });
  }, [showNotice]);

  const settleArenaDefeat = useCallback((event: ArenaDefeatEvent) => {
    setGame((current) => {
      if (!current || current.town.location !== 'wilderness') return current;
      const result = resolveWildernessArenaDefeat(current, {
        runId: event.runId,
        checkpoint: event.checkpoint,
        wave: event.wave,
        totalWaves: event.totalWaves,
        damageTaken: event.damageTaken,
        damageDealt: event.damageDealt,
      });
      if (!result.ok) {
        if (result.message) queueMicrotask(() => showNotice(result.message!));
        return current;
      }
      return normalizeTownAdventureState(result.state, current);
    });
  }, [showNotice]);

  const createCharacter = () => {
    if (resetSyncPending) {
      showNotice('Firebase 초기화 동기화를 기다리고 있습니다.');
      return;
    }
    const trimmed = characterName.trim();
    if (!trimmed) {
      showNotice('모험가 이름을 입력해 주세요.');
      return;
    }
    setActiveTab('hunt');
    setBattlefieldSkillsOpen(false);
    setGame(withAdventureTownState({
      ...createInitialState(selectedClass, trimmed),
      resetGeneration: resetGenerationRef.current,
    }));
    setHydrated(true);
  };

  const resetCharacter = async () => {
    if (!window.confirm('현재 캐릭터의 레벨, 장비, 도감 기록을 모두 삭제할까요?')) return;
    const resetUid = user?.uid ?? null;
    const resetOperation = resetOperationRef.current + 1;
    resetOperationRef.current = resetOperation;
    const isCurrentReset = () => (
      resetOperationRef.current === resetOperation
      && currentUserUidRef.current === resetUid
    );
    setActiveTab('hunt');
    setBattlefieldSkillsOpen(false);
    setSelectedTownService(null);
    saveEpochRef.current += 1;
    pendingSaveRef.current = null;
    resetPendingRef.current = true;
    setResetSyncPending(true);
    const previousGame = gameRef.current;
    gameRef.current = null;
    setGame(null);
    await Promise.race([
      activeSaveRef.current.catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (resetUid) {
      const slowResetNotice = window.setTimeout(() => {
        if (isCurrentReset()) showNotice('Firebase 초기화 동기화를 기다리고 있습니다.');
      }, 3_000);
      try {
        const generation = await resetAdventureStateAndRanking(resetUid);
        if (!isCurrentReset()) return;
        adoptResetGeneration(resetUid, generation);
      } catch {
        if (!isCurrentReset()) return;
        let currentGeneration = resetGenerationRef.current;
        try {
          currentGeneration = adoptResetGeneration(resetUid, await loadAdventureGeneration(resetUid));
        } catch {
          // Keep the latest generation observed by the live subscription.
        }
        resetPendingRef.current = false;
        setResetSyncPending(false);
        if (previousGame?.resetGeneration === currentGeneration) {
          gameRef.current = previousGame;
          setGame(previousGame);
          showNotice('Firebase 캐릭터 초기화에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        } else {
          window.localStorage.removeItem(localSaveKey);
          showNotice('다른 화면에서 완료된 초기화를 반영했습니다.');
        }
        return;
      } finally {
        window.clearTimeout(slowResetNotice);
      }
    } else {
      if (!isCurrentReset()) return;
      resetGenerationRef.current += 1;
    }
    if (!isCurrentReset()) return;
    window.localStorage.removeItem(localSaveKey);
    gameRef.current = null;
    setGame(null);
    setCharacterName(user?.displayName?.slice(0, 16) ?? '');
    resetPendingRef.current = false;
    setResetSyncPending(false);
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
          <p className={styles.creationCopy}>필드 탐험과 전투로 레벨과 직업 숙련도를 쌓고, 발견한 장비는 {formatNumber(TOTAL_ITEM_VARIETIES)}종 도감에 영구 기록됩니다.</p>
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
            <button className={styles.primaryButton} onClick={createCharacter} disabled={resetSyncPending}><Swords size={16} /> 모험 시작</button>
          </div>
        </section>
        {notice && <div className={styles.notice}>{notice}</div>}
      </main>
    );
  }

  const derived = deriveStats(game);
  const combatModifiers = resolveAdventureCombatModifiers(game, { hpRatio: 1 });
  const activePowerNames = [
    ...combatModifiers.uniqueItems.map((id) => UNIQUE_ITEM_DEFINITIONS[id].name),
    ...combatModifiers.activeRuneWords.map((id) => RUNE_WORD_BY_ID[id].name),
    ...combatModifiers.activeSetBonuses.map(({ setId, pieces }) => `${SET_ITEM_DEFINITIONS[setId].name} ${pieces}세트`),
  ];
  const levelProgress = getLevelProgress(game);
  const masteryProgress = getMasteryProgress(game);
  const classDefinition = CLASS_DEFINITIONS[game.classId];
  const region = REGION_DEFINITIONS[game.currentRegionId];
  const bossProgress = getBossProgress(game);
  const questProgress = getAllQuestProgress(game);
  const claimableQuests = questProgress.filter((quest) => quest.completed && !quest.claimed).length;
  const nextRegion = REGION_IDS.map((id) => REGION_DEFINITIONS[id]).find((candidate) => candidate.unlockLevel > game.level);
  const myRankIndex = user ? rankings.findIndex((entry) => entry.uid === user.uid) : -1;
  const myRank = myRankIndex >= 0 ? myRankIndex + 1 : null;
  const updateSkillLoadout = (index: number, skill: SkillSlot | null) => {
    const result = setSkillLoadoutSlot(game, index, skill);
    applyResult(result);
    if (result.ok) setEditingSkillSlot(null);
  };

  const renderSkillLoadout = () => {
    const availableSkills = SKILL_SLOTS.filter((slot) => (
      game.level >= classDefinition.skills[slot].unlockLevel
      && game.skillRanks[slot] > 0
    ));
    const activeCount = game.skillLoadout.filter(Boolean).length;
    return (
      <section
        className={`${styles.skillLoadout} ${battlefieldSkillsOpen ? styles.skillLoadoutMobileOpen : ''}`}
        aria-label="전투 기술 슬롯"
      >
        <header className={styles.skillLoadoutHeader}>
          <span><Zap size={13} /> 전투 기술</span>
          <small>{activeCount}/6</small>
        </header>
        <div className={styles.skillLoadoutSlots}>
          {Array.from({ length: 6 }, (_, index) => {
            const skillSlot = game.skillLoadout[index] ?? null;
            const skill = skillSlot ? classDefinition.skills[skillSlot] : null;
            return (
              <button
                key={index}
                type="button"
                className={`${styles.skillLoadoutSlot} ${editingSkillSlot === index ? styles.skillLoadoutSlotEditing : ''}`}
                aria-pressed={editingSkillSlot === index}
                title={skill ? `${skill.name} 슬롯 변경` : `전투 기술 슬롯 ${index + 1} 선택`}
                onClick={() => setEditingSkillSlot((current) => current === index ? null : index)}
              >
                <span className={styles.skillLoadoutKey}>{ARENA_SKILL_KEY_LABELS[index]}</span>
                <Zap size={14} />
                <strong>{skill?.name ?? '빈 슬롯'}</strong>
                <small>{skillSlot ? `${game.skillRanks[skillSlot]}단계` : '선택'}</small>
              </button>
            );
          })}
        </div>
        {editingSkillSlot !== null && (
          <div className={styles.skillLoadoutPicker} role="group" aria-label={`${editingSkillSlot + 1}번 슬롯 기술 선택`}>
            {availableSkills.map((slot) => {
              const skill = classDefinition.skills[slot];
              const equippedAt = game.skillLoadout.indexOf(slot);
              return (
                <button
                  key={slot}
                  type="button"
                  className={styles.skillLoadoutChoice}
                  aria-pressed={equippedAt === editingSkillSlot}
                  onClick={() => equippedAt === editingSkillSlot ? setEditingSkillSlot(null) : updateSkillLoadout(editingSkillSlot, slot)}
                >
                  {equippedAt === editingSkillSlot ? <Check size={12} /> : <Zap size={12} />}
                  <span>{skill.name}</span>
                  <small>{equippedAt >= 0 ? `${equippedAt + 1}번` : `${game.skillRanks[slot]}단계`}</small>
                </button>
              );
            })}
            {game.skillLoadout[editingSkillSlot] && (
              <button
                type="button"
                className={`${styles.skillLoadoutChoice} ${styles.skillLoadoutRemove}`}
                disabled={activeCount <= 1}
                onClick={() => updateSkillLoadout(editingSkillSlot, null)}
              >
                <RotateCcw size={12} /> 해제
              </button>
            )}
          </div>
        )}
      </section>
    );
  };

  const renderItemRow = (item: EquipmentInstance, equipped = false) => {
    const display = getEquipmentDisplay(item);
    const enhanceCost = getEnhancementCost(item);
    const unique = display.uniqueId ? UNIQUE_ITEM_DEFINITIONS[display.uniqueId] : null;
    const set = display.setId ? SET_ITEM_DEFINITIONS[display.setId] : null;
    const runeWord = display.runeWordId ? RUNE_WORD_BY_ID[display.runeWordId] : null;
    const specialEffects = [
      ...(unique?.effects.map((effect) => `${effect.name} · ${describeSpecialEffect(effect)}`) ?? []),
      ...(set?.bonuses.flatMap((bonus) => bonus.effects.map((effect) => `${bonus.pieces}세트 · ${effect.name} · ${describeSpecialEffect(effect)}`)) ?? []),
      ...(runeWord?.effects.map((effect) => `${effect.name} · ${describeSpecialEffect(effect)}`) ?? []),
    ];
    const hasOpenSocket = item.socketCount > item.socketedRunes.length;
    return (
      <div className={styles.inventoryRow} key={item.instanceId}>
        <div className={styles.itemTop}>
          <div className={styles.itemIdentity}>
            <p className={`${styles.itemName} ${RARITY_CLASS[item.rarity]}`}><AdventureIcon name={display.icon} size={14} /> {display.name} {item.enhance > 0 && `+${item.enhance}`}</p>
            <p className={styles.itemStats}>아이템 Lv.{item.itemLevel} · {display.tierLabel} · {display.qualityLabel} · {itemStats(item)}</p>
          </div>
          <span className={styles.price}>{formatNumber(display.value)} G</span>
        </div>
        <p className={styles.itemDescription}>{display.description}</p>
        {(unique || set || runeWord) && (
          <div className={styles.itemMarkers} aria-label="특수 장비 속성">
            {unique && <span className={styles.itemMarker} data-kind="unique">유니크 · {unique.name}</span>}
            {set && <span className={styles.itemMarker} data-kind="set">세트 · {set.name}</span>}
            {runeWord && <span className={styles.itemMarker} data-kind="runeword">룬어 · {runeWord.name}</span>}
          </div>
        )}
        {specialEffects.length > 0 && (
          <div className={styles.itemEffectList} aria-label="특수 효과">
            {specialEffects.map((effect, index) => <span className={styles.itemEffect} key={`${effect}-${index}`}>{effect}</span>)}
          </div>
        )}
        <div className={styles.socketSequence} aria-label={`${display.name} 룬 소켓`}>
          <span className={styles.socketLabel}><Gem size={12} /> 룬 소켓</span>
          {item.socketCount > 0 ? Array.from({ length: item.socketCount }, (_, index) => {
            const runeId = item.socketedRunes[index];
            return (
              <span className={`${styles.socketSlot} ${runeId ? styles.socketSlotFilled : ''}`} key={`${item.instanceId}-socket-${index}`}>
                <small>{index + 1}</small>
                {runeId ? RUNE_DEFINITIONS[runeId].name : '빈 소켓'}
              </span>
            );
          }) : <span className={styles.socketEmpty}>없음</span>}
        </div>
        <div className={styles.itemActions}>
          {!equipped && <button className={styles.smallButton} onClick={() => applyResult(equipItem(game, item.instanceId))}><Check size={12} /> 장착</button>}
          <button className={styles.smallButton} disabled={item.enhance >= MAX_ENHANCE || game.gold < enhanceCost} onClick={() => applyResult(enhanceGear(game, item.instanceId))}><Hammer size={12} /> +{item.enhance + 1} 강화 {formatNumber(enhanceCost)}G</button>
          {hasOpenSocket && <button className={styles.smallButton} aria-pressed={runeTargetId === item.instanceId} onClick={() => setRuneTargetId((current) => current === item.instanceId ? null : item.instanceId)}><Gem size={12} /> 룬 장착</button>}
          {!equipped && <button className={styles.smallButton} onClick={() => {
            const result = sellItem(game, item.instanceId);
            applyResult(result);
            if (result.ok && runeTargetId === item.instanceId) setRuneTargetId(null);
          }}><Trash2 size={12} /> 판매</button>}
        </div>
      </div>
    );
  };

  const renderHunt = () => {
    const enemyIds = [...region.enemyIds, region.bossId];
    const latestLoot = game.inventory.at(-1);
    const latestLootDisplay = latestLoot ? getEquipmentDisplay(latestLoot) : null;

    if (game.town.location === 'town') {
      const townName = `${region.name} 거점`;
      return (
        <section className={styles.townExperience} data-testid="adventure-town">
          <header className={styles.townHeader}>
            <div>
              <p className={styles.arenaEyebrow}>안전 지역</p>
              <h2 className={styles.hackSlashTitle}>{townName}</h2>
              <p className={styles.hackSlashRegionCopy}>황혼의 성채에는 대장간 불꽃과 귀환한 모험가들의 발걸음이 이어집니다.</p>
            </div>
            <div className={styles.townStatus}>
              <span>생명력 <strong>{formatNumber(game.hp)}/{formatNumber(derived.maxHp)}</strong></span>
              <span>골드 <strong>{formatNumber(game.gold)}G</strong></span>
              <button type="button" className={styles.returnTownButton} aria-label="성문" onClick={() => setSelectedTownService('waypoint')}>
                <DoorOpen size={15} /> <span>성문</span>
              </button>
            </div>
          </header>
          <AdventureTownHub3D
            classId={game.classId}
            playerName={game.name}
            townName={townName}
            weaponEquipped={Boolean(game.equipment.weapon)}
            onSelectService={setSelectedTownService}
          />
          <AdventureTownServicePanel
            game={game}
            service={selectedTownService}
            onApply={applyResult}
            onClose={() => setSelectedTownService(null)}
          />
        </section>
      );
    }

    const equippedWeapon = game.equipment.weapon;
    const activeEnemyIds = bossProgress.available ? enemyIds : region.enemyIds;
    const arenaSkills = game.skillLoadout.flatMap((slot, index) => {
        if (!slot || game.level < classDefinition.skills[slot].unlockLevel || game.skillRanks[slot] <= 0) return [];
        const skill = classDefinition.skills[slot];
        return [{
          id: skill.id,
          name: skill.name,
          ...skill.arena,
          damageMultiplier: skill.arena.damageMultiplier
            * (1 + Math.max(0, game.skillRanks[slot] - 1) * 0.08)
            * combatModifiers.skillDamageMultipliers[slot],
          range: skill.arena.range * combatModifiers.skillRangeMultipliers[slot],
          cooldown: skill.cooldown * combatModifiers.skillCooldownMultipliers[slot],
          hotkey: ARENA_SKILL_HOTKEYS[index],
        }];
      });
    return (
      <section className={styles.hackSlashExperience} data-testid="adventure-battlefield">
        <header className={styles.hackSlashHeader}>
          <div>
            <p className={styles.arenaEyebrow}>현재 전장 · Lv.{region.unlockLevel} 이상</p>
            <h2 className={styles.hackSlashTitle}>{region.name}</h2>
            <p className={styles.hackSlashRegionCopy}>{region.description}</p>
          </div>
          <div className={styles.hackSlashMeta}>
            <span>전투력 <strong>{formatNumber(derived.power)}</strong></span>
            <span>우두머리 추적 <strong>{bossProgress.current}/{bossProgress.required}</strong></span>
            <button
              type="button"
              className={styles.skillMenuButton}
              aria-label="전투 기술 설정"
              aria-expanded={battlefieldSkillsOpen}
              onClick={() => setBattlefieldSkillsOpen((open) => !open)}
            >
              <Zap size={16} />
              <span>기술 설정</span>
            </button>
            <button
              type="button"
              className={styles.returnTownButton}
              aria-label="마을 귀환"
              onClick={() => {
                const result = returnToTown(game);
                applyResult(result);
                if (result.ok) {
                  setSelectedTownService(null);
                  setBattlefieldSkillsOpen(false);
                }
              }}
            >
              <DoorOpen size={15} /> <span>마을 귀환</span>
            </button>
          </div>
        </header>
        {activePowerNames.length > 0 && (
          <div className={styles.activePowers} aria-label="활성 장비 효과">
            <Sparkles size={12} />
            {activePowerNames.map((name) => <span key={name}>{name}</span>)}
          </div>
        )}
        {renderSkillLoadout()}
        <HackSlashArena
          classId={game.classId}
          playerName={game.name}
          level={game.level}
          hp={game.hp}
          maxHp={derived.maxHp}
          attack={derived.attack}
          defense={derived.defense}
          crit={derived.crit}
          attackSpeed={1}
          castSpeed={1}
          moveSpeed={1}
          combatModifiers={combatModifiers}
          regionId={region.id}
          enemyIds={activeEnemyIds}
          skills={arenaSkills}
          initialCheckpoint={game.arenaCheckpoint}
          equippedWeapon={equippedWeapon ? {
            itemKey: equippedWeapon.itemKey,
            rarity: equippedWeapon.rarity,
            classId: game.classId,
          } : null}
          onEnemyDefeated={settleArenaKill}
          onPlayerDefeated={settleArenaDefeat}
          onRunExited={settleArenaDefeat}
        />
        <footer className={styles.hackSlashFooter}>
          <span>{bossProgress.available ? '지역 우두머리가 필드 어딘가에 출현했습니다.' : `일반 몬스터 ${bossProgress.required - bossProgress.current}마리 처치 시 우두머리의 흔적이 드러납니다.`}</span>
          {latestLootDisplay && <span className={styles.hackSlashLoot}><AdventureIcon name={latestLootDisplay.icon} size={15} /><strong className={RARITY_CLASS[latestLoot!.rarity]}>{latestLootDisplay.name}</strong></span>}
        </footer>
      </section>
    );
  };

  const renderEquipment = () => {
    const equippedItems = Object.values(game.equipment).filter(
      (item): item is EquipmentInstance => item !== null,
    );
    const socketTarget = [...equippedItems, ...game.inventory]
      .find((item) => item.instanceId === runeTargetId) ?? null;
    const socketTargetDisplay = socketTarget ? getEquipmentDisplay(socketTarget) : null;
    const targetIsFull = Boolean(
      socketTarget && socketTarget.socketedRunes.length >= socketTarget.socketCount,
    );
    const totalRunes = RUNE_IDS.reduce((total, runeId) => total + (game.runeInventory[runeId] ?? 0), 0);

    const socketSelectedRune = (runeId: RuneId) => {
      if (!socketTarget) return;
      const result = insertRuneIntoItem(game, socketTarget.instanceId, runeId);
      applyResult(result);
      if (!result.ok) return;
      const nextTarget = [
        ...Object.values(result.state.equipment).filter(
          (item): item is EquipmentInstance => item !== null,
        ),
        ...result.state.inventory,
      ].find((item) => item.instanceId === socketTarget.instanceId);
      if (!nextTarget || nextTarget.socketedRunes.length >= nextTarget.socketCount) setRuneTargetId(null);
    };

    return (
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
        <section className={`${styles.panel} ${styles.runeVaultPanel}`}>
          <div className={styles.panelHeader}><h2 className={styles.panelTitle}><Gem size={14} /> 룬 보관함</h2><span className={styles.panelMeta}>{formatNumber(totalRunes)}개</span></div>
          <div className={`${styles.runeTarget} ${socketTarget ? styles.runeTargetActive : ''}`}>
            <span>장착 대상</span>
            <strong>{socketTargetDisplay?.name ?? '선택 안 됨'}</strong>
            <small>{socketTarget ? `${socketTarget.socketedRunes.length}/${socketTarget.socketCount} 소켓` : '대상 없음'}</small>
          </div>
          <div className={styles.runeInventoryGrid}>
            {RUNE_IDS.map((runeId) => {
              const rune = RUNE_DEFINITIONS[runeId];
              const count = game.runeInventory[runeId] ?? 0;
              return (
                <button
                  className={styles.runeButton}
                  type="button"
                  key={runeId}
                  disabled={!socketTarget || targetIsFull || count < 1 || socketTarget.itemLevel < rune.minItemLevel}
                  onClick={() => socketSelectedRune(runeId)}
                  aria-label={`${rune.name} ${count}개${socketTargetDisplay ? `, ${socketTargetDisplay.name}에 장착` : ''}`}
                >
                  <span className={styles.runeGlyph}><Gem size={16} /></span>
                  <span className={styles.runeButtonName}>{rune.name}<small>요구 iLv.{rune.minItemLevel}</small></span>
                  <span className={styles.runeButtonCount}>{count}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.runeRecipeHeader}>
            <strong>룬어 기록</strong>
            <span>{RUNE_WORD_RECIPES.length}종</span>
          </div>
          <div className={styles.runeRecipeGrid}>
            {RUNE_WORD_RECIPES.map((recipe) => (
              <div className={styles.runeRecipe} key={recipe.id}>
                <div><strong>{recipe.name}</strong><span>{recipe.slots.map((slot) => EQUIPMENT_SLOT_LABELS[slot]).join(' · ')}</span></div>
                <p>{recipe.runes.map((runeId, index) => `${index + 1}. ${RUNE_DEFINITIONS[runeId].name}`).join('  >  ')}</p>
                <small>{recipe.effects.map((effect) => `${effect.name}: ${describeSpecialEffect(effect)}`).join(' / ')}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const renderGrowth = () => (
    <div className={styles.growthLayout}>
      <section className={styles.panel}>
        <div className={styles.sectionIntro}><h2 className={styles.sectionTitle}>능력치 훈련</h2><p className={styles.sectionCopy}>보유 포인트 {game.statPoints} · 레벨이 오를 때마다 3포인트를 얻습니다.</p></div>
        {(Object.keys(CORE_STAT_LABELS) as CoreStatId[]).map((stat) => (
          <div className={styles.attributeRow} key={stat}>
            <div><p className={styles.attributeLabel}>{CORE_STAT_LABELS[stat]}</p><p className={styles.attributeEffect}>{STAT_DESCRIPTIONS[stat]}</p></div>
            <div className={styles.attributeControls}><span className={styles.attributeValue}>{game.baseStats[stat]}</span><button className={styles.iconButton} title={`${CORE_STAT_LABELS[stat]} 1 올리기`} disabled={game.statPoints < 1} onClick={() => applyResult(allocateStat(game, stat))}><Plus size={15} /></button></div>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionIntro}><h2 className={styles.sectionTitle}>{classDefinition.name} 기술</h2><p className={styles.sectionCopy}>보유 기술 포인트 {game.skillPoints} · 숙련도가 오를 때마다 기술 포인트를 얻습니다.</p></div>
        <div className={styles.skillList}>
          {SKILL_SLOTS.map((slot) => {
            const skill = classDefinition.skills[slot];
            const rank = game.skillRanks[slot];
            const locked = game.level < skill.unlockLevel;
            const cost = getSkillUpgradeCost(game, slot);
            return (
              <div className={styles.skillRow} key={slot}>
                <div className={styles.skillTop}><div><p className={styles.skillName}><Sparkles size={13} /> {skill.name}</p><p className={styles.skillDesc}>{skill.description}</p></div><span className={styles.slotEnhance}>{locked ? `Lv.${skill.unlockLevel}` : `${rank}/${MAX_SKILL_RANK}`}</span></div>
                <div className={styles.itemActions}><button className={styles.smallButton} disabled={locked || rank >= MAX_SKILL_RANK || game.skillPoints < cost} onClick={() => applyResult(upgradeSkill(game, slot))}><Plus size={12} /> 강화 {cost}P</button></div>
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
        return <div className={styles.inventoryRow} key={item.instanceId}><div className={styles.itemTop}><div><p className={`${styles.itemName} ${RARITY_CLASS[item.rarity]}`}>{display.name}</p><p className={styles.itemStats}>{itemStats(item)}</p></div></div><div className={styles.itemActions}><button className={styles.smallButton} onClick={() => applyResult(equipItem(game, item.instanceId))}><Check size={11} /> 장착</button></div></div>;
      })}</div> : <div className={styles.emptyState}><PackageOpen size={25} /><br />가방이 비어 있습니다.</div>;
    }
    if (sideTab === 'log') {
      return <ul className={styles.logList}>{game.logs.slice().reverse().map((entry) => <li className={styles.logItem} key={entry.id}>{entry.text}</li>)}</ul>;
    }
    return <div className={styles.questList}>{questProgress.map((progress) => <div className={styles.questRow} key={progress.quest.id}><div className={styles.questTop}><div><p className={styles.questName}>{progress.quest.name}</p><p className={styles.questDesc}>{progress.quest.description}</p></div>{progress.claimed ? <span className={styles.questClaimed}>완료</span> : progress.completed ? <button className={styles.smallButton} onClick={() => applyResult(claimQuest(game, progress.quest.id))}>받기</button> : null}</div><div className={styles.progressMini}><div className={styles.progressMiniFill} style={{ width: percent(progress.ratio) }} /></div><p className={styles.questReward}>{progress.current}/{progress.target} · {formatNumber(progress.quest.reward.gold)} G · EXP {formatNumber(progress.quest.reward.exp)}</p></div>)}</div>;
  };

  return (
    <main
      className={styles.page}
      data-battlefield={activeTab === 'hunt' && game.town.location === 'wilderness' ? 'true' : undefined}
      data-town={activeTab === 'hunt' && game.town.location === 'town' ? 'true' : undefined}
    >
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link className={styles.brand} href="/rooms"><span className={styles.brandMark}><Swords size={20} /></span><span><h1 className={styles.brandTitle}>대목 모험가 길드</h1>{activeTab !== 'hunt' && <p className={styles.brandSub}>영구 성장형 브라우저 RPG</p>}</span></Link>
          {activeTab !== 'hunt' && <div className={styles.accountSummary}>
            <div className={styles.summaryItem}><span className={styles.summaryLabel}>캐릭터</span><span className={styles.summaryValue}>Lv.{game.level} {game.name}</span></div>
            <div className={styles.summaryItem}><span className={styles.summaryLabel}>전투력</span><span className={styles.summaryValue}>{formatNumber(derived.power)}</span></div>
            <div className={styles.summaryItem}><span className={styles.summaryLabel}>보유 골드</span><span className={`${styles.summaryValue} ${styles.summaryValueGold}`}>{formatNumber(game.gold)} G</span></div>
            <div className={styles.summaryItem}><span className={styles.summaryLabel}>장비 도감</span><span className={styles.summaryValue}>{formatNumber(game.discoveredItemKeys.length)} / {formatNumber(TOTAL_ITEM_VARIETIES)}</span></div>
          </div>}
          <div className={styles.topActions}><span className={styles.saveStatus}>{saveStatus}</span>{activeTab === 'hunt' && <button className={styles.iconButton} type="button" title="장비 열기" aria-label="장비 열기" onClick={() => setActiveTab('equipment')}><Backpack size={16} /></button>}<button className={styles.iconButton} type="button" title="캐릭터 초기화" aria-label="캐릭터 초기화" onClick={resetCharacter}><RotateCcw size={15} /></button><Link className={styles.iconButton} href="/rooms" title="로비로 나가기" aria-label="로비로 나가기"><LogOut size={16} /></Link></div>
        </div>
      </header>

      {activeTab !== 'hunt' && <nav className={styles.nav} aria-label="모험 메뉴"><div className={styles.navInner}>
        {([
          ['hunt', Map, '사냥터'],
          ['equipment', Backpack, '장비'],
          ['growth', ChartNoAxesColumnIncreasing, '성장'],
          ['collection', Library, '아이템 도감'],
          ['ranking', Trophy, '랭킹'],
        ] as const).map(([tab, Icon, label]) => <button key={tab} className={`${styles.navButton} ${activeTab === tab ? styles.navButtonActive : ''}`} title={label} onClick={() => {
          setActiveTab(tab);
          if (tab !== 'hunt') setSelectedTownService(null);
        }}><Icon size={15} /><span>{label}</span></button>)}
      </div></nav>}

      {activeTab !== 'hunt' && <div className={styles.mobileSummary} aria-label="캐릭터 요약">
        <div className={styles.mobileSummaryItem}><span className={styles.mobileSummaryLabel}>캐릭터</span><span className={styles.mobileSummaryValue}>Lv.{game.level} {game.name}</span></div>
        <div className={styles.mobileSummaryItem}><span className={styles.mobileSummaryLabel}>전투력</span><span className={styles.mobileSummaryValue}>{formatNumber(derived.power)}</span></div>
        <div className={styles.mobileSummaryItem}><span className={styles.mobileSummaryLabel}>골드</span><span className={`${styles.mobileSummaryValue} ${styles.summaryValueGold}`}>{formatNumber(game.gold)} G</span></div>
      </div>}

      <div className={`${styles.shell} ${activeTab === 'hunt' ? styles.shellImmersive : ''}`}>
        {activeTab !== 'hunt' && <aside className={styles.leftRail}>
          <section className={styles.panel}>
            <div className={styles.characterHead}><div className={styles.portrait}><AdventureIcon name={classDefinition.icon} size={30} /></div><div><p className={styles.characterName}>{game.name}</p><p className={styles.characterClass}>Lv.{game.level} {classDefinition.name}</p><span className={styles.rankBadge}>{rankFor(game.level)}</span></div></div>
            <div className={styles.meterBlock}><div className={styles.meterLabels}><span>체력</span><span>{formatNumber(game.hp)} / {formatNumber(derived.maxHp)}</span></div><Meter ratio={game.hp / derived.maxHp} variant="hp" label="체력" /></div>
            <div className={styles.meterBlock}><div className={styles.meterLabels}><span>경험치</span><span>{formatNumber(levelProgress.exp)} / {formatNumber(levelProgress.needed)}</span></div><Meter ratio={levelProgress.ratio} variant="exp" label="경험치" /></div>
            <div className={styles.meterBlock}><div className={styles.meterLabels}><span>직업 숙련 {game.mastery.level}</span><span>{formatNumber(masteryProgress.exp)} / {formatNumber(masteryProgress.needed)}</span></div><Meter ratio={masteryProgress.ratio} variant="mastery" label="직업 숙련도" /></div>
            <div className={styles.combatPower}><span className={styles.combatPowerLabel}>종합 전투력</span><strong className={styles.combatPowerValue}>{formatNumber(derived.power)}</strong></div>
            <div className={styles.statGrid}><div className={styles.statCell}><span className={styles.statName}>공격</span><span className={styles.statValue}>{derived.attack}</span></div><div className={styles.statCell}><span className={styles.statName}>방어</span><span className={styles.statValue}>{derived.defense}</span></div><div className={styles.statCell}><span className={styles.statName}>치명타</span><span className={styles.statValue}>{derived.crit}%</span></div><div className={styles.statCell}><span className={styles.statName}>물약</span><span className={styles.statValue}>{game.potions}개</span></div></div>
            <div className={styles.nextGoal}><p className={styles.goalEyebrow}>다음 성장 목표</p><p className={styles.goalTitle}>{nextRegion ? `Lv.${nextRegion.unlockLevel} ${nextRegion.name} 해금` : `${region.name} 우두머리 반복 토벌`}</p><p className={styles.goalCopy}>{nextRegion ? `새 지역까지 ${nextRegion.unlockLevel - game.level}레벨 남았습니다.` : '최고 지역에서 희귀 조합 장비를 수집하세요.'}</p></div>
          </section>
          <section className={styles.panel}><div className={styles.panelHeader}><h2 className={styles.panelTitle}><Backpack size={14} /> 착용 장비</h2></div><div className={styles.equipmentSlots}>{(Object.keys(game.equipment) as EquipmentSlot[]).map((slot) => { const item = game.equipment[slot]; const display = item ? getEquipmentDisplay(item) : null; return <div className={styles.equipmentSlot} key={slot}><span className={styles.slotIcon}>{display ? <AdventureIcon name={display.icon} size={16} /> : <LockKeyhole size={14} />}</span><span><span className={styles.slotName}>{EQUIPMENT_SLOT_LABELS[slot]}</span><span className={`${styles.slotItem} ${item ? RARITY_CLASS[item.rarity] : ''}`}>{display?.name ?? '비어 있음'}</span></span>{item && <span className={styles.slotEnhance}>+{item.enhance}</span>}</div>; })}</div></section>
        </aside>}

        <section className={`${styles.mainColumn} ${activeTab === 'hunt' ? styles.mainColumnImmersive : ''}`}>
          {activeTab === 'hunt' && renderHunt()}
          {activeTab === 'equipment' && renderEquipment()}
          {activeTab === 'growth' && renderGrowth()}
          {activeTab === 'collection' && renderCollection()}
          {activeTab === 'ranking' && renderRanking()}
        </section>

        {activeTab !== 'hunt' && <aside className={styles.rightRail}>
          <section className={styles.panel}><div className={styles.rightTabs}><button className={`${styles.rightTab} ${sideTab === 'quests' ? styles.rightTabActive : ''}`} onClick={() => setSideTab('quests')}>임무 {claimableQuests > 0 && `(${claimableQuests})`}</button><button className={`${styles.rightTab} ${sideTab === 'inventory' ? styles.rightTabActive : ''}`} onClick={() => setSideTab('inventory')}>가방</button><button className={`${styles.rightTab} ${sideTab === 'log' ? styles.rightTabActive : ''}`} onClick={() => setSideTab('log')}>기록</button></div><div className={styles.scrollBody}>{renderSideContent()}</div></section>
          <section className={styles.panel}><div className={styles.panelHeader}><h2 className={styles.panelTitle}><Activity size={14} /> 모험 기록</h2></div><div className={styles.statGrid}><div className={styles.statCell}><span className={styles.statName}>승리</span><span className={styles.statValue}>{formatNumber(game.statistics.battlesWon)}</span></div><div className={styles.statCell}><span className={styles.statName}>우두머리</span><span className={styles.statValue}>{formatNumber(game.statistics.bossesKilled)}</span></div><div className={styles.statCell}><span className={styles.statName}>장비 발견</span><span className={styles.statValue}>{formatNumber(game.statistics.equipmentFound)}</span></div><div className={styles.statCell}><span className={styles.statName}>총 처치</span><span className={styles.statValue}>{formatNumber(game.statistics.totalKills)}</span></div></div><div className={styles.nextGoal}><p className={styles.goalEyebrow}>우두머리 토벌 자격</p><p className={styles.goalTitle}>{bossProgress.current} / {bossProgress.required} 처치</p><p className={styles.goalCopy}>각 지역의 일반 몬스터를 {BOSS_KILLS_REQUIRED}마리씩 처치할 때마다 토벌 기회가 열립니다.</p></div></section>
        </aside>}
      </div>

      {notice && <div className={styles.notice}>{notice}</div>}
    </main>
  );
}
