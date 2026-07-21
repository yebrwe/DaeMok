'use client';

import React from 'react';
import type { Direction, Position, WallItemType } from '@/types/game';
import type { WallActionPreviewPlan } from '@/lib/wallPreview';

interface WallActionPreviewProps {
  plan: WallActionPreviewPlan;
  position: Position;
  source: 'suggested' | 'pointer';
}
type PreviewBehavior = 'block' | 'pass' | 'fire' | 'poison' | 'ice' | 'wind' | 'phase' | 'thorn';

const BEHAVIORS: Record<WallItemType, PreviewBehavior> = {
  oneTimeWall: 'block',
  steelWall: 'block',
  fireWall: 'fire',
  poisonWall: 'poison',
  iceWall: 'ice',
  windWall: 'wind',
  collapseWall: 'pass',
  phaseWall: 'phase',
  mirrorWall: 'pass',
  thornWall: 'thorn',
  crystalWall: 'block',
};

const DIRECTION_ARROWS: Record<Direction, string> = {
  up: '↑',
  right: '→',
  down: '↓',
  left: '←',
};

function samePosition(left: Position, right: Position): boolean {
  return left.row === right.row && left.col === right.col;
}

function motionStyle(direction: Direction, resultDirection?: Direction): React.CSSProperties {
  const vector = (value: Direction): [number, number] => {
    if (value === 'up') return [0, -1];
    if (value === 'down') return [0, 1];
    if (value === 'left') return [-1, 0];
    return [1, 0];
  };
  const [x, y] = vector(direction);
  const [resultX, resultY] = vector(resultDirection || direction);

  return {
    '--wall-preview-x': x,
    '--wall-preview-y': y,
    '--wall-preview-result-x': resultX,
    '--wall-preview-result-y': resultY,
  } as React.CSSProperties;
}

function ShadowAvatar({
  className,
  role,
  plan,
}: {
  className: string;
  role: 'origin' | 'destination';
  plan: WallActionPreviewPlan;
}) {
  return (
    <span
      className={`wall-shadow-clone ${className}`}
      data-shadow-clone={role}
      data-preview-animation={className}
      style={motionStyle(plan.direction, plan.effectDirection || plan.resultDirection)}
    >
      <span className="wall-shadow-head" />
      <span className="wall-shadow-body" />
    </span>
  );
}

function OriginPreview({ plan }: { plan: WallActionPreviewPlan }) {
  if (plan.type === 'wormhole') {
    return (
      <>
        <span className="wall-preview-portal" data-preview-effect="dice-wormhole" />
        <ShadowAvatar className="wall-shadow-wormhole-enter" role="origin" plan={plan} />
      </>
    );
  }

  const behavior = BEHAVIORS[plan.type];
  const originClass = behavior === 'fire'
    ? 'wall-shadow-fire-map'
    : behavior === 'poison'
      ? 'wall-shadow-pass-out'
      : behavior === 'ice' || behavior === 'wind' || behavior === 'thorn'
        ? 'wall-shadow-bump'
          : behavior === 'phase'
            ? 'wall-shadow-phase-origin'
            : behavior === 'pass'
              ? 'wall-shadow-pass-out'
              : 'wall-shadow-bump';

  return (
    <>
      <ShadowAvatar className={originClass} role="origin" plan={plan} />
      {behavior === 'fire' && (
        <span className="wall-preview-fire-cue" data-preview-effect="map-burn">
          <span data-preview-ash-wall="one" />
          <span data-preview-ash-wall="two" />
          <span data-preview-ash-wall="three" />
        </span>
      )}
      {behavior === 'poison' && (
        <span className="wall-preview-direction-cue" data-preview-effect="random-four-way">
          <span data-preview-input-direction={plan.direction}>
            입력 {DIRECTION_ARROWS[plan.direction]}
          </span>
          <span data-preview-result-direction={plan.resultDirection}>
            실제 {DIRECTION_ARROWS[plan.resultDirection || plan.direction]}
          </span>
        </span>
      )}
    </>
  );
}

function resultLabel(plan: WallActionPreviewPlan): string {
  if (plan.type === 'wormhole') return '③ 주사위 방';
  if (plan.type === 'iceWall') return '③ 제자리 · 행동 2회 소모';
  if (plan.type === 'windWall') {
    return plan.effectBlocked
      ? '③ 막힘 · 제자리'
      : `③ ${DIRECTION_ARROWS[plan.effectDirection || plan.direction]} 1칸 재지정`;
  }
  if (plan.type === 'thornWall') {
    return plan.effectBlocked
      ? '③ 막힘 · 제자리'
      : `③ ${DIRECTION_ARROWS[plan.effectDirection || plan.direction]} 1칸 튕김`;
  }
  if (plan.type === 'poisonWall') return '③ 방향 무작위';
  if (plan.type === 'fireWall') return '③ 벽 기억 소각';
  if (plan.type === 'phaseWall') return '③ 통과/차단 교대';
  if (plan.type === 'crystalWall') return '③ 주변 벽 공개';
  if (plan.type === 'steelWall') return '③ 항상 차단';
  if (plan.type === 'oneTimeWall') return '③ 1회 차단';
  return '③ 통과';
}

function DestinationPreview({ plan }: { plan: WallActionPreviewPlan }) {
  const label = resultLabel(plan);
  if (plan.type === 'wormhole') {
    return (
      <>
        <span className="wall-preview-dice" data-preview-effect="dice-roll" aria-hidden="true">
          <span>●</span><span>●</span><span>●</span>
        </span>
        <span className="wall-preview-result-label" data-preview-step="result">{label}</span>
      </>
    );
  }

  const behavior = BEHAVIORS[plan.type];
  const destinationClass = plan.effectBlocked
    ? plan.type === 'iceWall'
      ? 'wall-shadow-ice-penalty'
      : 'wall-shadow-result-stay'
    : behavior === 'poison'
    ? 'wall-shadow-poison-random'
    : behavior === 'wind' || behavior === 'thorn'
      ? 'wall-shadow-redirect-in'
        : behavior === 'phase'
          ? 'wall-shadow-phase-destination'
          : 'wall-shadow-pass-in';

  return (
    <>
      <ShadowAvatar className={destinationClass} role="destination" plan={plan} />
      <span
        className="wall-preview-result-label"
        data-preview-step="result"
        data-preview-result-label={label}
      >
        {label}
      </span>
    </>
  );
}

export default function WallActionPreview({ plan, position, source }: WallActionPreviewProps) {
  const isOrigin = samePosition(position, plan.from);
  const isResult = samePosition(position, plan.result);
  if (!isOrigin && !isResult) return null;

  if (isOrigin) {
    return (
      <div
        className="wall-action-preview-layer pointer-events-none absolute inset-0 z-20"
        data-testid="wall-action-preview"
        data-preview-wall={plan.type}
        data-preview-kind={plan.kind}
        data-preview-segment={plan.segment}
        data-preview-from={`${plan.from.row},${plan.from.col}`}
        data-preview-to={`${plan.to.row},${plan.to.col}`}
        data-preview-result={`${plan.result.row},${plan.result.col}`}
        data-preview-source={source}
        data-preview-effect-direction={plan.effectDirection}
        data-preview-effect-blocked={plan.effectBlocked === undefined ? undefined : String(plan.effectBlocked)}
        data-preview-action-cost={plan.actionCost}
        data-preview-wall-consumed={String(plan.wallConsumed)}
        data-preview-safe="true"
        data-preview-interactive="false"
        aria-hidden="true"
      >
        <span className="wall-preview-stage-origin" data-preview-step="approach">
          {source === 'pointer' ? '선택' : '추천'} · ① 접근
        </span>
        <OriginPreview plan={plan} />
        {isResult && <DestinationPreview plan={plan} />}
      </div>
    );
  }

  return (
    <div
      className="wall-action-preview-layer pointer-events-none absolute inset-0 z-20"
      data-wall-action-preview-companion={plan.type}
      data-preview-result={`${plan.result.row},${plan.result.col}`}
      aria-hidden="true"
    >
      <DestinationPreview plan={plan} />
    </div>
  );
}
