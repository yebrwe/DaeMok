'use client';

import {
  Backpack,
  DoorOpen,
  Hammer,
  HeartPulse,
  PackageOpen,
  ShoppingBag,
  X,
} from 'lucide-react';
import {
  INVENTORY_LIMIT,
  MAX_ENHANCE,
  REGION_DEFINITIONS,
  REGION_IDS,
  deriveStats,
  getEnhancementCost,
  getEquipmentDisplay,
  getGearSellPrice,
  getRestCost,
  isRegionUnlocked,
  type AdventureResult,
  type EquipmentInstance,
  type EquipmentRarity,
} from '@/lib/adventure';
import {
  TOWN_POTION_PRICE,
  TOWN_SERVICE_DEFINITIONS,
  TOWN_STASH_LIMIT,
  buyTownMerchantItem,
  buyTownPotion,
  depositTownStash,
  enhanceAtBlacksmith,
  getTownMerchantPrice,
  healAtTown,
  leaveTown,
  selectTownDestination,
  sellItemToTownMerchant,
  withdrawTownStash,
  type TownAdventureState,
  type TownServiceId,
} from '@/lib/adventureTown';
import styles from './AdventureTownServicePanel.module.css';

export interface AdventureTownServicePanelProps {
  game: TownAdventureState;
  service: TownServiceId | null;
  onApply: (result: AdventureResult) => void;
  onClose: () => void;
}

const RARITY_CLASS: Record<EquipmentRarity, string> = {
  common: styles.common,
  uncommon: styles.uncommon,
  rare: styles.rare,
  epic: styles.epic,
  legendary: styles.legendary,
};

function itemSummary(item: EquipmentInstance) {
  const values = [
    item.stats.attack > 0 ? `공격 +${item.stats.attack}` : '',
    item.stats.defense > 0 ? `방어 +${item.stats.defense}` : '',
    item.stats.maxHp > 0 ? `생명력 +${item.stats.maxHp}` : '',
    item.stats.crit > 0 ? `치명타 +${item.stats.crit}%` : '',
  ].filter(Boolean);
  return `iLv.${item.itemLevel} · ${values.join(' · ')}`;
}

function ItemRow({
  item,
  action,
  actionLabel,
  disabled = false,
}: {
  item: EquipmentInstance;
  action: () => void;
  actionLabel: string;
  disabled?: boolean;
}) {
  const display = getEquipmentDisplay(item);
  return (
    <div className={styles.item}>
      <div>
        <p className={`${styles.itemName} ${RARITY_CLASS[item.rarity]}`}>{display.name}{item.enhance > 0 ? ` +${item.enhance}` : ''}</p>
        <p className={styles.itemMeta}>{itemSummary(item)}</p>
      </div>
      <button type="button" className={styles.action} disabled={disabled} onClick={action}>{actionLabel}</button>
    </div>
  );
}

export default function AdventureTownServicePanel({
  game,
  service,
  onApply,
  onClose,
}: AdventureTownServicePanelProps) {
  if (!service) return null;
  const definition = TOWN_SERVICE_DEFINITIONS.find((candidate) => candidate.id === service)!;
  const derived = deriveStats(game);
  const freeEmergencyTreatment = game.hp < derived.maxHp * 0.5;
  const healingCost = getRestCost(game);
  const availableGear = [
    ...Object.values(game.equipment).filter((item): item is EquipmentInstance => item !== null),
    ...game.inventory,
  ];

  const renderBody = () => {
    if (service === 'merchant') {
      return (
        <>
          <p className={styles.intro}>{definition.description} 재고는 30분마다 현재 레벨과 지역에 맞춰 바뀝니다.</p>
          <div className={styles.serviceBar}>
            <p className={styles.serviceStat}>보유 골드 <strong>{game.gold.toLocaleString()}G</strong> · 물약 {game.potions}개</p>
            <button type="button" className={styles.action} disabled={game.gold < TOWN_POTION_PRICE} onClick={() => onApply(buyTownPotion(game))}>
              물약 1개 · {TOWN_POTION_PRICE}G
            </button>
          </div>
          <h3 className={styles.sectionTitle}><ShoppingBag size={15} /> 장비 재고</h3>
          {game.town.merchantStock.length > 0 ? <div className={styles.list}>
            {game.town.merchantStock.map((item) => {
              const price = getTownMerchantPrice(item);
              return <ItemRow key={item.instanceId} item={item} disabled={game.gold < price} action={() => onApply(buyTownMerchantItem(game, item.instanceId))} actionLabel={`${price.toLocaleString()}G`} />;
            })}
          </div> : <div className={styles.empty}>이번 조달 주기의 장비가 품절되었습니다.</div>}
          <h3 className={styles.sectionTitle}><Backpack size={15} /> 가방 장비 판매</h3>
          {game.inventory.length > 0 ? (
            <div className={styles.list}>
              {game.inventory.map((item) => (
                <ItemRow
                  key={item.instanceId}
                  item={item}
                  action={() => onApply(sellItemToTownMerchant(game, item.instanceId))}
                  actionLabel={`${getGearSellPrice(item).toLocaleString()}G 판매`}
                />
              ))}
            </div>
          ) : <div className={styles.empty}>판매할 장비가 없습니다.</div>}
        </>
      );
    }
    if (service === 'blacksmith') {
      return (
        <>
          <p className={styles.intro}>{definition.description} 강화 비용은 장비 등급과 단계에 따라 오르며 마을에서만 진행할 수 있습니다.</p>
          <div className={styles.serviceBar}><p className={styles.serviceStat}>보유 골드 <strong>{game.gold.toLocaleString()}G</strong></p></div>
          <h3 className={styles.sectionTitle}><Hammer size={15} /> 강화할 장비</h3>
          {availableGear.length > 0 ? <div className={styles.list}>{availableGear.map((item) => {
            const cost = getEnhancementCost(item);
            return <ItemRow key={item.instanceId} item={item} disabled={item.enhance >= MAX_ENHANCE || game.gold < cost} action={() => onApply(enhanceAtBlacksmith(game, item.instanceId))} actionLabel={item.enhance >= MAX_ENHANCE ? '최대 강화' : `+${item.enhance + 1} · ${cost.toLocaleString()}G`} />;
          })}</div> : <div className={styles.empty}>강화할 장비가 없습니다.</div>}
        </>
      );
    }
    if (service === 'healer') {
      return (
        <>
          <p className={styles.intro}>{definition.description}</p>
          <div className={styles.serviceBar}>
            <p className={styles.serviceStat}>생명력 <strong>{game.hp.toLocaleString()} / {derived.maxHp.toLocaleString()}</strong></p>
            <button type="button" className={styles.primary} disabled={game.hp >= derived.maxHp || (!freeEmergencyTreatment && game.gold < healingCost)} onClick={() => onApply(healAtTown(game))}>
              <HeartPulse size={17} /> {freeEmergencyTreatment ? '응급 치료' : `완전 회복 · ${healingCost.toLocaleString()}G`}
            </button>
          </div>
        </>
      );
    }
    if (service === 'stash') {
      return (
        <>
          <p className={styles.intro}>{definition.description}</p>
          <div className={styles.stashGrid}>
            <section className={styles.stashColumn}>
              <h3 className={styles.sectionTitle}><Backpack size={15} /> 가방 {game.inventory.length}/{INVENTORY_LIMIT}</h3>
              {game.inventory.length > 0 ? <div className={styles.list}>{game.inventory.map((item) => <ItemRow key={item.instanceId} item={item} disabled={game.town.stash.length >= TOWN_STASH_LIMIT} action={() => onApply(depositTownStash(game, item.instanceId))} actionLabel="보관" />)}</div> : <div className={styles.empty}>가방이 비어 있습니다.</div>}
            </section>
            <section className={styles.stashColumn}>
              <h3 className={styles.sectionTitle}><PackageOpen size={15} /> 보관함 {game.town.stash.length}/{TOWN_STASH_LIMIT}</h3>
              {game.town.stash.length > 0 ? <div className={styles.list}>{game.town.stash.map((item) => <ItemRow key={item.instanceId} item={item} disabled={game.inventory.length >= INVENTORY_LIMIT} action={() => onApply(withdrawTownStash(game, item.instanceId))} actionLabel="꺼내기" />)}</div> : <div className={styles.empty}>보관한 장비가 없습니다.</div>}
            </section>
          </div>
        </>
      );
    }
    return (
      <>
        <p className={styles.intro}>{definition.description} 해금한 지역의 웨이포인트와 연결됩니다.</p>
        <div className={styles.destinationGrid} role="group" aria-label="야외 목적지">
          {REGION_IDS.map((regionId) => {
            const region = REGION_DEFINITIONS[regionId];
            const unlocked = isRegionUnlocked(game, regionId);
            const selected = game.town.lastFieldRegionId === regionId;
            return (
              <button
                key={regionId}
                type="button"
                className={`${styles.destination} ${selected ? styles.destinationSelected : ''}`}
                disabled={!unlocked}
                aria-pressed={selected}
                onClick={() => onApply(selectTownDestination(game, regionId))}
              >
                <span>{unlocked ? `Lv.${region.unlockLevel}` : `Lv.${region.unlockLevel} 잠김`}</span>
                <strong>{region.name}</strong>
              </button>
            );
          })}
        </div>
        <div className={styles.serviceBar}>
          <p className={styles.serviceStat}>선택 목적지 <strong>{REGION_DEFINITIONS[game.town.lastFieldRegionId].name}</strong></p>
          <button type="button" className={styles.primary} onClick={() => { onApply(leaveTown(game)); onClose(); }}><DoorOpen size={17} /> 성문 밖으로</button>
        </div>
      </>
    );
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={`${definition.name} ${definition.role}`} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.identity}>
            <h2 className={styles.name}>{definition.name}</h2>
            <p className={styles.role}>{definition.role}</p>
          </div>
          <button type="button" className={styles.close} aria-label="닫기" onClick={onClose}><X size={19} /></button>
        </header>
        <div className={styles.body}>{renderBody()}</div>
      </section>
    </div>
  );
}
