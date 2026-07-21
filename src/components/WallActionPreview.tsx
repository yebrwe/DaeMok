'use client';

import React from 'react';
import type { Direction, Position, WallItemType } from '@/types/game';
import type { WallActionPreviewPlan } from '@/lib/wallPreview';

interface WallActionPreviewProps {
  plan: WallActionPreviewPlan;
  position: Position;
}
type PreviewBehavior = 'block' | 'pass' | 'fire' | 'poison' | 'ice' | 'wind' | 'phase';

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
  thornWall: 'block',
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
      style={motionStyle(plan.direction, plan.resultDirection)}
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
        <span className="wall-preview-caption wall-preview-caption-wormhole">굴려서 탈출</span>
      </>
    );
  }

  const behavior = BEHAVIORS[plan.type];
  const originClass = behavior === 'fire'
    ? 'wall-shadow-fire-map'
    : behavior === 'poison'
      ? 'wall-shadow-pass-out'
      : behavior === 'ice'
        ? 'wall-shadow-pass-out'
        : behavior === 'wind'
          ? 'wall-shadow-pass-out'
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
      {behavior === 'ice' && <span className="wall-preview-caption">한 칸 더</span>}
      {behavior === 'wind' && <span className="wall-preview-caption">밀려남</span>}
      {behavior === 'phase' && <span className="wall-preview-caption">막힘 ↔ 통과</span>}
    </>
  );
}

function DestinationPreview({ plan }: { plan: WallActionPreviewPlan }) {
  if (plan.type === 'wormhole') {
    return (
      <span className="wall-preview-dice" data-preview-effect="dice-roll" aria-hidden="true">
        <span>●</span><span>●</span><span>●</span>
      </span>
    );
  }

  const behavior = BEHAVIORS[plan.type];
  if (!['pass', 'poison', 'ice', 'wind', 'phase'].includes(behavior)) return null;

  const destinationClass = behavior === 'poison'
    ? 'wall-shadow-poison-random'
    : behavior === 'ice'
      ? 'wall-shadow-ice-slide'
      : behavior === 'wind'
        ? 'wall-shadow-wind-push'
        : behavior === 'phase'
          ? 'wall-shadow-phase-destination'
          : 'wall-shadow-pass-in';

  return <ShadowAvatar className={destinationClass} role="destination" plan={plan} />;
}

export default function WallActionPreview({ plan, position }: WallActionPreviewProps) {
  const isOrigin = samePosition(position, plan.from);
  const isDestination = samePosition(position, plan.to);
  if (!isOrigin && !isDestination) return null;

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
        data-preview-safe="true"
        data-preview-interactive="false"
        aria-hidden="true"
      >
        <OriginPreview plan={plan} />
      </div>
    );
  }

  return (
    <div
      className="wall-action-preview-layer pointer-events-none absolute inset-0 z-20"
      data-wall-action-preview-companion={plan.type}
      aria-hidden="true"
    >
      <DestinationPreview plan={plan} />
    </div>
  );
}
