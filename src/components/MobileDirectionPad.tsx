'use client';

import React from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LucideIcon } from 'lucide-react';
import { Direction } from '@/types/game';

interface MobileDirectionPadProps {
  disabled?: boolean;
  active?: boolean;
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
  onMove,
  testId = 'mobile-direction-pad',
}) => (
  <div
    className="game-mobile-direction-pad pointer-events-auto relative z-30 grid h-[140px] w-[140px] grid-cols-3 grid-rows-3 gap-1"
    role="group"
    aria-label="이동 방향"
    data-no-swipe
    data-testid={testId}
  >
    {BUTTONS.map(({ direction, label, Icon, position }) => (
      <button
        key={direction}
        type="button"
        className={`btn-dpad ${position} !h-11 !w-11 touch-manipulation !rounded-xl !bg-[#fffef9]/95 !text-[#5d4635] backdrop-blur-sm`}
        onClick={() => onMove(direction)}
        disabled={disabled}
        title={label}
        aria-label={label}
      >
        <Icon size={19} aria-hidden="true" />
      </button>
    ))}
    <div
      className="col-start-2 row-start-2 flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[#cfa87a] bg-[#fffaf0]/95 backdrop-blur-sm"
      aria-hidden="true"
    >
      <span className={`h-2.5 w-2.5 rounded-full ${active && !disabled ? 'animate-pulse bg-[#f4c64f]' : 'bg-[#d8c9b5]'}`} />
    </div>
  </div>
);

export default MobileDirectionPad;
