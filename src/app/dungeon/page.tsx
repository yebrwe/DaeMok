'use client';

// 던전 RPG 모드 - 로그라이크: 탐험(전장의 안개) / 범프 전투 / 레벨업 / 등급 장비 / 3액트 스토리
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import DungeonScene, { DungeonFx } from '@/components/three/DungeonScene';
import {
  ACTS,
  BASE_PLAYER,
  Cell,
  CONSUMABLES,
  DEATH_STORY,
  DungeonItem,
  ENDING_STORY,
  EquipItem,
  EquipSlot,
  FLOORS_PER_ACT,
  FloorData,
  Monster,
  RARITY_BORDER,
  RARITY_LABEL,
  RARITY_TEXT,
  TILE_STAIRS,
  TOTAL_FLOORS,
  computeVisible,
  dist2,
  expNeeded,
  generateFloor,
  MAP_H,
  MAP_W,
  monsterStep,
  mulberry32,
  rollChestItem,
  rollDamage,
  randInt,
  sameCell,
  walkable,
} from '@/lib/dungeon';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, get, update, serverTimestamp } from 'firebase/database';

type Phase = 'boot' | 'story' | 'play' | 'dead' | 'ending';

interface PlayerState {
  pos: Cell;
  hp: number;
  baseMaxHp: number;
  baseAtk: number;
  baseDef: number;
  level: number;
  exp: number;
  gold: number;
}

interface Equipped {
  weapon: EquipItem | null;
  armor: EquipItem | null;
  charm: EquipItem | null;
}

const INVENTORY_CAP = 8;

export default function DungeonPage() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [seed, setSeed] = useState<number | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [floor, setFloor] = useState(0);
  const [pendingFloor, setPendingFloor] = useState<number | null>(0); // 스토리 카드 후 진입할 층
  const [floorData, setFloorData] = useState<FloorData | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [equipped, setEquipped] = useState<Equipped>({ weapon: null, armor: null, charm: null });
  const [inventory, setInventory] = useState<DungeonItem[]>([]);
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [chests, setChests] = useState<Cell[]>([]);
  const [golds, setGolds] = useState<Cell[]>([]);
  const [explored, setExplored] = useState<boolean[][]>([]);
  const [revealAll, setRevealAll] = useState(false);
  const [turns, setTurns] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; cls: string } | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const [fx, setFx] = useState<DungeonFx | null>(null);
  const [hurtKey, setHurtKey] = useState(0);
  const [monsterHitKey, setMonsterHitKey] = useState<Record<number, number>>({});
  const [best, setBest] = useState<{ bestFloor: number; bestScore: number; clears: number } | null>(null);

  const rngRef = useRef<() => number>(() => Math.random());
  const fxKeyRef = useRef(0);
  const busyRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fireFx = useCallback((type: DungeonFx['type'], at: Cell) => {
    fxKeyRef.current += 1;
    setFx({ key: fxKeyRef.current, type, at });
  }, []);

  const pushLog = useCallback((msg: string) => {
    setLog((prev) => [...prev.slice(-4), msg]);
  }, []);

  const showToast = useCallback((text: string, cls: string) => {
    setToast({ text, cls });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // 장비 합산 스탯
  const totalAtk = (p: PlayerState) => p.baseAtk + (equipped.weapon?.atk ?? 0);
  const totalDef = (p: PlayerState) => p.baseDef + (equipped.armor?.def ?? 0);
  const totalMaxHp = (p: PlayerState) => p.baseMaxHp + (equipped.charm?.maxHp ?? 0);

  const score = (p: PlayerState | null, f: number, cleared: boolean) =>
    (p?.gold ?? 0) + (f + 1) * 100 + (p?.level ?? 1) * 20 + (cleared ? 500 : 0);

  // ===== 초기화 (시드는 쿼리 ?seed= 또는 랜덤) =====
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('seed');
    setDebugMode(q !== null);
    setSeed(q !== null ? Number(q) || 1 : Math.floor(Math.random() * 1e9));

    // 최고 기록 로드 (로그인한 경우만)
    (async () => {
      try {
        const auth = getAuth();
        if (!auth.currentUser) return;
        const snap = await get(ref(getDatabase(), `users/${auth.currentUser.uid}/dungeon`));
        if (snap.exists()) setBest(snap.val());
      } catch {
        /* 미로그인/오프라인 - 무시 */
      }
    })();
  }, []);

  useEffect(() => {
    if (seed !== null && phase === 'boot') {
      setPhase('story'); // 인트로 카드
      setPendingFloor(0);
    }
  }, [seed, phase]);

  // ===== 층 진입 =====
  const enterFloor = useCallback(
    (f: number) => {
      if (seed === null) return;
      const data = generateFloor(seed, f);
      rngRef.current = mulberry32(seed * 31 + f * 7 + 999);
      setFloor(f);
      setFloorData(data);
      setMonsters(data.monsters.map((m) => ({ ...m })));
      setChests([...data.chests]);
      setGolds([...data.golds]);
      setRevealAll(false);
      const exp = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(false));
      setExplored(exp);
      setPlayer((prev) => {
        if (!prev) {
          // 새 모험 시작: 비상용 물약 1개 지급
          setInventory([{ kind: 'consumable', ...CONSUMABLES.potion }]);
        }
        const base: PlayerState = prev ?? {
          pos: data.start,
          hp: BASE_PLAYER.maxHp,
          baseMaxHp: BASE_PLAYER.maxHp,
          baseAtk: BASE_PLAYER.atk,
          baseDef: BASE_PLAYER.def,
          level: 1,
          exp: 0,
          gold: 0,
        };
        return { ...base, pos: data.start };
      });
      setPhase('play');
      pushLog(`${ACTS[data.act].title} — ${(f % FLOORS_PER_ACT) + 1}층${data.bossFloor ? ' (보스!)' : ''}`);
      if (data.bossFloor) pushLog('⚠️ 보스를 처치해야 계단이 열립니다.');
    },
    [seed, pushLog]
  );

  // 시야/탐험 갱신
  useEffect(() => {
    if (!player || !floorData) return;
    const vis = computeVisible(player.pos);
    setExplored((prev) => {
      const next = prev.map((row) => [...row]);
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          if (!next[y][x] && vis({ x, y })) next[y][x] = true;
        }
      }
      return next;
    });
  }, [player, floorData]);

  // ===== 기록 저장 =====
  const saveRecord = useCallback(
    async (finalFloor: number, cleared: boolean, p: PlayerState | null) => {
      try {
        const auth = getAuth();
        if (!auth.currentUser) return;
        const uid = auth.currentUser.uid;
        const recRef = ref(getDatabase(), `users/${uid}/dungeon`);
        const snap = await get(recRef);
        const cur = snap.exists() ? snap.val() : { bestFloor: 0, bestScore: 0, clears: 0 };
        const sc = score(p, finalFloor, cleared);
        const next = {
          bestFloor: Math.max(cur.bestFloor ?? 0, finalFloor + 1),
          bestScore: Math.max(cur.bestScore ?? 0, sc),
          clears: (cur.clears ?? 0) + (cleared ? 1 : 0),
          updatedAt: serverTimestamp(),
        };
        await update(recRef, next);
        setBest(next as any);
      } catch {
        /* 무시 */
      }
    },
    []
  );

  // ===== 경험치/레벨업 =====
  const gainExp = useCallback(
    (amount: number, at: Cell) => {
      setPlayer((prev) => {
        if (!prev) return prev;
        let { level, exp, baseMaxHp, baseAtk, baseDef, hp } = prev;
        exp += amount;
        while (exp >= expNeeded(level)) {
          exp -= expNeeded(level);
          level += 1;
          baseMaxHp += 4;
          baseAtk += 1;
          if (level % 2 === 0) baseDef += 1;
          hp = Math.min(baseMaxHp + (equipped.charm?.maxHp ?? 0), hp + 6);
          pushLog(`🎉 레벨 업! Lv.${level} (공격+1${level % 2 === 0 ? ', 방어+1' : ''})`);
          fireFx('levelup', at);
        }
        return { ...prev, level, exp, baseMaxHp, baseAtk, baseDef, hp };
      });
    },
    [equipped.charm, fireFx, pushLog]
  );

  // ===== 몬스터 턴 =====
  const monstersAct = useCallback(
    (playerPos: Cell, curMonsters: Monster[]): { monsters: Monster[]; damage: number; msgs: string[] } => {
      const rng = rngRef.current;
      let damage = 0;
      const msgs: string[] = [];
      const moved = curMonsters.map((m) => ({ ...m }));
      for (const m of moved) {
        if (m.hp <= 0) continue;
        if (dist2(m.pos, playerPos) > 36) continue; // 시야 밖(6칸)이면 대기 - 층 전체가 몰려오지 않게
        const adjacent = Math.abs(m.pos.x - playerPos.x) + Math.abs(m.pos.y - playerPos.y) === 1;
        if (adjacent) {
          const dmg = rollDamage(m.atk, totalDef(player!), rng);
          damage += dmg;
          msgs.push(`${m.emoji} ${m.name}의 공격! -${dmg}`);
        } else if (!floorData) {
          continue;
        } else {
          const occupied = (c: Cell) => moved.some((o) => o.id !== m.id && o.hp > 0 && sameCell(o.pos, c));
          m.pos = monsterStep(floorData.grid, m.pos, playerPos, occupied, rng);
        }
      }
      return { monsters: moved, damage, msgs };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [floorData, player, equipped.armor]
  );

  // ===== 이동/공격 =====
  const handleMove = useCallback(
    (dir: 'up' | 'down' | 'left' | 'right') => {
      if (phase !== 'play' || !player || !floorData || busyRef.current) return;
      busyRef.current = true;
      try {
        const delta = dir === 'up' ? { x: 0, y: -1 } : dir === 'down' ? { x: 0, y: 1 } : dir === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 };
        const target = { x: player.pos.x + delta.x, y: player.pos.y + delta.y };
        const rng = rngRef.current;

        if (!walkable(floorData.grid, target)) {
          pushLog('벽에 막혀 있다.');
          return;
        }

        // 전투: 대상 칸에 몬스터 -> 공격 (범프 전투)
        const targetMonster = monsters.find((m) => m.hp > 0 && sameCell(m.pos, target));
        let nextMonsters = monsters;
        let playerPos = player.pos;
        let hpDelta = 0;
        let goldDelta = 0;
        let killedBossFinal = false;

        if (targetMonster) {
          const dmg = rollDamage(totalAtk(player), targetMonster.def, rng);
          nextMonsters = monsters.map((m) => (m.id === targetMonster.id ? { ...m, hp: m.hp - dmg } : m));
          setMonsterHitKey((prev) => ({ ...prev, [targetMonster.id]: (prev[targetMonster.id] ?? 0) + 1 }));
          fireFx('hit', targetMonster.pos);
          const killed = nextMonsters.find((m) => m.id === targetMonster.id)!.hp <= 0;
          if (killed) {
            pushLog(`${targetMonster.emoji} ${targetMonster.name} 처치! (+${targetMonster.exp} EXP)`);
            fireFx('death', targetMonster.pos);
            gainExp(targetMonster.exp, targetMonster.pos);
            // 드롭: 금화 45% / 아이템 20% (보스: 영웅+ 장비 확정)
            if (targetMonster.boss) {
              const item = rollChestItem(rng, floor, rng() < 0.35 ? 'legendary' : 'epic');
              addItem(item);
              goldDelta += 30 + randInt(rng, 30);
              if (floor === TOTAL_FLOORS - 1) killedBossFinal = true;
              else pushLog('🔓 계단이 열렸습니다!');
            } else {
              if (rng() < 0.45) {
                const g = 6 + floor * 3 + randInt(rng, 8);
                goldDelta += g;
                pushLog(`💰 금화 ${g} 획득`);
              }
              if (rng() < 0.2) addItem(rollChestItem(rng, floor));
            }
          } else {
            pushLog(`${targetMonster.emoji} ${targetMonster.name}에게 ${dmg} 피해!`);
          }
        } else {
          // 이동
          playerPos = target;
          // 금화 줍기
          const gIdx = golds.findIndex((g) => sameCell(g, target));
          if (gIdx >= 0) {
            const g = 8 + floor * 4 + randInt(rng, 10);
            goldDelta += g;
            setGolds((prev) => prev.filter((_, i) => i !== gIdx));
            fireFx('pickup', target);
            pushLog(`💰 금화 ${g} 획득`);
          }
          // 상자
          const cIdx = chests.findIndex((c) => sameCell(c, target));
          if (cIdx >= 0) {
            setChests((prev) => prev.filter((_, i) => i !== cIdx));
            const item = rollChestItem(rng, floor);
            addItem(item);
            fireFx('pickup', target);
          }
          // 계단
          if (floorData.grid[target.y][target.x] === TILE_STAIRS) {
            const bossAlive = floorData.bossFloor && nextMonsters.some((m) => m.boss && m.hp > 0);
            if (bossAlive) {
              pushLog('🔒 계단이 잠겨 있다. 보스를 처치해야 한다.');
            } else {
              fireFx('stairs', target);
              const nf = floor + 1;
              setPlayer((prev) => (prev ? { ...prev, pos: target, gold: prev.gold + goldDelta } : prev));
              if (nf % FLOORS_PER_ACT === 0) {
                // 새 액트: 스토리 카드 + 완전 회복 보너스
                setPlayer((prev) => (prev ? { ...prev, hp: totalMaxHp(prev) } : prev));
                setPendingFloor(nf);
                setPhase('story');
                pushLog('✨ 새로운 액트! 체력이 모두 회복되었습니다.');
              } else {
                enterFloor(nf);
              }
              return;
            }
          }
        }

        // 몬스터 턴
        const acted = monstersAct(playerPos, nextMonsters);
        if (acted.damage > 0) {
          hpDelta -= acted.damage;
          acted.msgs.forEach(pushLog);
          setHurtKey((k) => k + 1);
          fireFx('playerHit', playerPos);
        }

        setMonsters(acted.monsters);
        setTurns((t) => t + 1);
        setPlayer((prev) => {
          if (!prev) return prev;
          const nextHp = Math.min(totalMaxHp(prev), prev.hp + hpDelta);
          const next = { ...prev, pos: playerPos, hp: nextHp, gold: prev.gold + goldDelta };
          if (nextHp <= 0) {
            setPhase('dead');
            saveRecord(floor, false, next);
          }
          return next;
        });

        if (killedBossFinal) {
          setPhase('ending');
          setPlayer((prev) => {
            saveRecord(TOTAL_FLOORS - 1, true, prev);
            return prev;
          });
        }
      } finally {
        busyRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, player, floorData, monsters, golds, chests, floor, monstersAct, enterFloor, fireFx, pushLog, gainExp, saveRecord, equipped]
  );

  // 인벤토리 추가
  const addItem = useCallback(
    (item: DungeonItem) => {
      setInventory((prev) => {
        if (prev.length >= INVENTORY_CAP) {
          pushLog('🎒 가방이 가득 차서 아이템을 두고 왔다...');
          return prev;
        }
        const label = `[${RARITY_LABEL[item.rarity]}] ${item.emoji} ${item.name}`;
        pushLog(`${label} 획득!`);
        showToast(`${label} 획득!`, `${RARITY_TEXT[item.rarity]} ${RARITY_BORDER[item.rarity]}`);
        return [...prev, item];
      });
    },
    [pushLog, showToast]
  );

  // ===== 아이템 사용/장착 =====
  const useItem = useCallback(
    (index: number) => {
      const item = inventory[index];
      if (!item || !player || phase !== 'play') return;
      const rng = rngRef.current;

      if (item.kind === 'equip') {
        setEquipped((prev) => {
          const slot = item.slot as EquipSlot;
          const old = prev[slot];
          setInventory((inv) => {
            const next = inv.filter((_, i) => i !== index);
            return old ? [...next, old] : next;
          });
          pushLog(`${item.emoji} ${item.name} 장착!`);
          return { ...prev, [slot]: item };
        });
        return;
      }

      // 소모품
      let consumed = true;
      switch (item.id) {
        case 'potion':
          setPlayer((p) => (p ? { ...p, hp: Math.min(totalMaxHp(p), p.hp + Math.ceil(totalMaxHp(p) / 2)) } : p));
          pushLog('🧪 물약을 마셨다. 몸이 따뜻해진다.');
          break;
        case 'bigPotion':
          setPlayer((p) => (p ? { ...p, hp: totalMaxHp(p) } : p));
          pushLog('💖 큰 물약! 체력이 모두 회복되었다.');
          break;
        case 'elixir':
          setPlayer((p) => {
            if (!p) return p;
            const grown = { ...p, baseMaxHp: p.baseMaxHp + 5 };
            return { ...grown, hp: totalMaxHp(grown) };
          });
          pushLog('✨ 숲의 정수! 최대 체력이 5 늘고 완전히 회복되었다.');
          break;
        case 'scroll':
          setRevealAll(true);
          setExplored(Array.from({ length: MAP_H }, () => Array(MAP_W).fill(true)));
          pushLog('📜 천리안! 이 층의 지형이 모두 드러났다.');
          break;
        case 'bomb': {
          fireFx('bomb', player.pos);
          let anyKilledBossFinal = false;
          setMonsters((prev) => {
            const next = prev.map((m) => {
              if (m.hp <= 0) return m;
              const d2 = dist2(m.pos, player.pos);
              if (d2 <= 2) {
                const dmg = 12 + randInt(rng, 5);
                const hp = m.hp - dmg;
                if (hp <= 0) {
                  pushLog(`💣 폭발! ${m.name} 처치!`);
                  fireFx('death', m.pos);
                  gainExp(m.exp, m.pos);
                  if (m.boss) {
                    if (floor === TOTAL_FLOORS - 1) anyKilledBossFinal = true;
                    else pushLog('🔓 계단이 열렸습니다!');
                  }
                } else {
                  pushLog(`💣 폭발! ${m.name}에게 ${dmg} 피해!`);
                }
                return { ...m, hp };
              }
              return m;
            });
            if (anyKilledBossFinal) setPhase('ending');
            return next;
          });
          break;
        }
        default:
          consumed = false;
      }
      if (consumed) setInventory((inv) => inv.filter((_, i) => i !== index));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inventory, player, phase, pushLog, fireFx, gainExp, floor, equipped]
  );

  // 키보드
  const handleMoveRef = useRef(handleMove);
  handleMoveRef.current = handleMove;
  useEffect(() => {
    const keyMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const onKey = (e: KeyboardEvent) => {
      const d = keyMap[e.key];
      if (d) {
        e.preventDefault();
        handleMoveRef.current(d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // E2E/디버그 상태 노출 (?seed= 지정 시에만)
  useEffect(() => {
    if (!debugMode) return;
    (window as any).__RPG = {
      phase,
      floor,
      grid: floorData?.grid ?? null,
      start: floorData?.start ?? null,
      stairs: floorData?.stairs ?? null,
      bossFloor: floorData?.bossFloor ?? false,
      player: player ? { ...player, atk: totalAtk(player), def: totalDef(player), maxHp: totalMaxHp(player) } : null,
      monsters: monsters.filter((m) => m.hp > 0).map((m) => ({ id: m.id, pos: m.pos, hp: m.hp, boss: !!m.boss, name: m.name })),
      chests,
      golds,
      inventory: inventory.map((i) => i.name),
      turns,
    };
  });

  const visibleSet = React.useMemo(() => {
    if (!player) return new Set<string>();
    const vis = computeVisible(player.pos);
    const set = new Set<string>();
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (vis({ x, y })) set.add(`${x},${y}`);
    return set;
  }, [player]);

  // ===== 렌더 =====
  const act = Math.floor((pendingFloor ?? floor) / FLOORS_PER_ACT);
  const theme = ACTS[Math.min(act, ACTS.length - 1)].theme;

  const storyCard = (title: string, body: string, button: string, onNext: () => void, sub?: string) => (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
      <div className="game-panel !rounded-2xl px-7 py-6 max-w-lg text-center">
        <p className="text-[10px] tracking-[0.3em] text-slate-500 font-bold mb-2">DUNGEON STORY</p>
        <h2 className="text-xl font-black text-amber-300 mb-3">{title}</h2>
        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{body}</p>
        {sub && <p className="text-xs text-slate-500 mt-3">{sub}</p>}
        <button className="btn-game px-10 py-2.5 text-sm mt-5" onClick={onNext}>
          {button}
        </button>
      </div>
    </div>
  );

  if (phase === 'boot' || seed === null) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-950">
      {/* 3D 던전 */}
      {floorData && player && (
        <DungeonScene
          grid={floorData.grid}
          explored={explored}
          visibleSet={visibleSet}
          player={player.pos}
          playerHurtKey={hurtKey}
          monsters={monsters}
          monsterHitKey={monsterHitKey}
          chests={chests}
          golds={golds}
          stairs={floorData.stairs}
          stairsLocked={floorData.bossFloor && monsters.some((m) => m.boss && m.hp > 0)}
          theme={theme}
          fx={fx}
          revealAll={revealAll}
        />
      )}

      {/* 상단 좌: 스탯 */}
      {player && phase === 'play' && (
        <div className="absolute top-2 left-2 z-30 game-panel !rounded-xl px-3 py-2 w-[190px]">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
            <span>Lv.{player.level}</span>
            <span className="text-amber-300">💰 {player.gold}</span>
          </div>
          {/* HP 바 */}
          <div className="mt-1.5 h-3 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
            <div
              className={`h-full ${player.hp / totalMaxHp(player) > 0.5 ? 'bg-green-500' : player.hp / totalMaxHp(player) > 0.25 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${Math.max(0, (player.hp / totalMaxHp(player)) * 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            ❤️ {player.hp}/{totalMaxHp(player)}
          </div>
          {/* EXP 바 */}
          <div className="mt-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-sky-400" style={{ width: `${(player.exp / expNeeded(player.level)) * 100}%` }} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
            <span>⚔️ {totalAtk(player)}</span>
            <span>🛡️ {totalDef(player)}</span>
            <span>👣 {turns}턴</span>
          </div>
        </div>
      )}

      {/* 상단 중앙: 액트/층 */}
      {phase === 'play' && floorData && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30">
          <div className="game-panel !rounded-full px-4 py-1.5 text-xs font-black text-amber-300 whitespace-nowrap">
            {ACTS[floorData.act].title} · {(floor % FLOORS_PER_ACT) + 1}층
            {floorData.bossFloor && <span className="text-red-400 ml-1">BOSS</span>}
          </div>
        </div>
      )}

      {/* 상단 우: 나가기 */}
      <div className="absolute top-2 right-2 z-30 flex gap-1.5">
        <Link href="/rooms" className="btn-sub px-2.5 py-1.5 text-[11px] inline-flex items-center">
          🚪 나가기
        </Link>
      </div>

      {/* 드롭 토스트 */}
      {toast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
          <div className={`text-xs font-black px-4 py-2 rounded-xl bg-slate-900/90 border-2 backdrop-blur-sm ${toast.cls}`}>{toast.text}</div>
        </div>
      )}

      {/* 좌하단: 메시지 로그 */}
      {phase === 'play' && (
        <div className="absolute bottom-2 left-2 z-30 w-[240px] pointer-events-none">
          <div className="flex flex-col gap-0.5">
            {log.map((m, i) => (
              <p
                key={`${i}-${m}`}
                className={`text-[11px] px-2 py-0.5 rounded-lg bg-slate-950/70 backdrop-blur-sm ${
                  i === log.length - 1 ? 'text-slate-100 font-bold' : 'text-slate-400'
                }`}
              >
                {m}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* 우하단: 가방 */}
      {phase === 'play' && (
        <div className="absolute bottom-2 right-2 z-30 flex flex-col items-end gap-1.5">
          {bagOpen && player && (
            <div className="game-panel !rounded-xl p-2.5 w-[230px] max-h-[46vh] overflow-y-auto">
              <p className="text-[10px] font-bold text-slate-400 mb-1.5">장비</p>
              <div className="flex flex-col gap-1 mb-2">
                {(['weapon', 'armor', 'charm'] as EquipSlot[]).map((slot) => {
                  const it = equipped[slot];
                  return (
                    <div key={slot} className="text-[11px] px-2 py-1 rounded-lg bg-slate-800/70 border border-slate-700/60 flex justify-between">
                      <span className="text-slate-500">{slot === 'weapon' ? '🗡️ 무기' : slot === 'armor' ? '🛡️ 방어구' : '📿 장신구'}</span>
                      {it ? (
                        <span className={`font-bold ${RARITY_TEXT[it.rarity]}`}>
                          {it.name} {it.atk > 0 && `⚔️+${it.atk}`}{it.def > 0 && `🛡️+${it.def}`}{it.maxHp > 0 && `❤️+${it.maxHp}`}
                        </span>
                      ) : (
                        <span className="text-slate-600">없음</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] font-bold text-slate-400 mb-1.5">가방 ({inventory.length}/{INVENTORY_CAP})</p>
              <div className="flex flex-col gap-1">
                {inventory.length === 0 && <p className="text-[11px] text-slate-600 px-1">비어 있음</p>}
                {inventory.map((it, i) => (
                  <button
                    key={i}
                    className={`text-left text-[11px] px-2 py-1.5 rounded-lg bg-slate-800/70 border transition-colors hover:bg-slate-700/70 ${RARITY_BORDER[it.rarity]}`}
                    onClick={() => useItem(i)}
                    title={it.kind === 'consumable' ? it.desc : '클릭해서 장착'}
                  >
                    <span className={`font-bold ${RARITY_TEXT[it.rarity]}`}>
                      {it.emoji} {it.name}
                    </span>
                    <span className="text-slate-500 ml-1">
                      {it.kind === 'equip'
                        ? `${it.atk > 0 ? `⚔️+${it.atk}` : ''}${it.def > 0 ? `🛡️+${it.def}` : ''}${it.maxHp > 0 ? `❤️+${it.maxHp}` : ''} · 장착`
                        : '사용'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <button className="btn-game px-3.5 py-2 text-sm !rounded-xl" onClick={() => setBagOpen((v) => !v)}>
            🎒 가방{inventory.length > 0 ? ` (${inventory.length})` : ''}
          </button>
        </div>
      )}

      {/* 하단 중앙: D-패드 */}
      {phase === 'play' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1">
          <div className="grid grid-cols-3 gap-1">
            <div className="col-start-2">
              <button className="btn-dpad !w-12 !h-12 !bg-slate-900/70 backdrop-blur-sm" onClick={() => handleMove('up')}>↑</button>
            </div>
            <div className="col-start-1 row-start-2">
              <button className="btn-dpad !w-12 !h-12 !bg-slate-900/70 backdrop-blur-sm" onClick={() => handleMove('left')}>←</button>
            </div>
            <div className="col-start-2 row-start-2">
              <div className="w-12 h-12 rounded-2xl bg-slate-900/50 border border-slate-700/40 backdrop-blur-sm flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              </div>
            </div>
            <div className="col-start-3 row-start-2">
              <button className="btn-dpad !w-12 !h-12 !bg-slate-900/70 backdrop-blur-sm" onClick={() => handleMove('right')}>→</button>
            </div>
            <div className="col-start-2 row-start-3">
              <button className="btn-dpad !w-12 !h-12 !bg-slate-900/70 backdrop-blur-sm" onClick={() => handleMove('down')}>↓</button>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 bg-slate-900/40 px-2 py-0.5 rounded-full">몬스터 쪽으로 이동 = 공격</p>
        </div>
      )}

      {/* 스토리 카드 */}
      {phase === 'story' &&
        pendingFloor !== null &&
        storyCard(
          ACTS[Math.floor(pendingFloor / FLOORS_PER_ACT)].title,
          ACTS[Math.floor(pendingFloor / FLOORS_PER_ACT)].story,
          pendingFloor === 0 ? '모험 시작' : '계속 내려간다',
          () => enterFloor(pendingFloor),
          best ? `내 최고 기록: ${best.bestFloor}층 · ${best.bestScore}점 · 클리어 ${best.clears}회` : undefined
        )}

      {/* 사망 */}
      {phase === 'dead' &&
        storyCard(
          '💀 쓰러졌다...',
          DEATH_STORY,
          '다시 도전',
          () => window.location.reload(),
          `도달: ${ACTS[Math.floor(floor / FLOORS_PER_ACT)].title} ${(floor % FLOORS_PER_ACT) + 1}층 · 점수 ${score(player, floor, false)}`
        )}

      {/* 엔딩 */}
      {phase === 'ending' &&
        storyCard(
          '🌟 모크를 구했다!',
          ENDING_STORY,
          '숲을 나간다',
          () => (window.location.href = '/rooms'),
          `클리어! 점수 ${score(player, TOTAL_FLOORS - 1, true)} · Lv.${player?.level} · 💰${player?.gold}`
        )}
    </div>
  );
}
