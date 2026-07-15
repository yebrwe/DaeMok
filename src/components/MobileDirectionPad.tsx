'use client';

import React from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LucideIcon } from 'lucide-react';
import { Direction } from '@/types/game';

interface MobileDirectionPadProps {
  disabled?: boolean;
  active?: boolean;
  placement?: 'overlay' | 'dock';
  onMove: (direction: Direction) => void;
  testId?: string;
}

const BUTTONS: Array<{
  direction: Direction;
  label: string;
  Icon: LucideIcon;
  position: string;
}> = [
  { direction: 'up', label: '위로 이동', Icon: ArrowUp, position: 'col-start-2 row-start-1' },
  { direction: 'left', label: '왼쪽으로 이동', Icon: ArrowLeft, position: 'col-start-1 row-start-2' },
  { direction: 'right', label: '오른쪽으로 이동', Icon: ArrowRight, position: 'col-start-3 row-start-2' },
  { direction: 'down', label: '아래로 이동', Icon: ArrowDown, position: 'col-start-2 row-start-3' },
];

const MobileDirectionPad: React.FC<MobileDirectionPadProps> = ({
  disabled = false,
  active = false,
  placement = 'overlay',
  onMove,
  testId = 'mobile-direction-pad',
}) => (
  <div
    className={`pointer-events-auto z-30 grid h-[140px] w-[140px] grid-cols-3 grid-rows-3 gap-1 sm:hidden ${
      placement === 'dock' ? 'relative' : 'absolute bottom-2 left-1/2 -translate-x-1/2'
    }`}
    role="group"
    aria-label="이동 방향"
    data-testid={testId}
  >
    {BUTTONS.map(({ direction, label, Icon, position }) => (
      <button
        key={direction}
        type="button"
        className={`btn-dpad ${position} !h-11 !w-11 !rounded-lg !bg-slate-950/90 backdrop-blur-sm touch-manipulation`}
        onClick={() => onMove(direction)}
        disabled={disabled}
        title={label}
        aria-label={label}
      >
        <Icon size={19} aria-hidden="true" />
      </button>
    ))}
    <div
      className="col-start-2 row-start-2 flex h-11 w-11 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-950/85 backdrop-blur-sm"
      aria-hidden="true"
    >
      <span className={`h-2.5 w-2.5 rounded-full ${active && !disabled ? 'animate-pulse bg-amber-400' : 'bg-slate-600'}`} />
    </div>
  </div>
);

export default MobileDirectionPad;
