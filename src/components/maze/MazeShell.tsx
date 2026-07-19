'use client';

import type { PropsWithChildren } from 'react';
import styles from './MazeTheme.module.css';

export type MazeScreen = 'lobby' | 'practice' | 'room';
export type MazePhase = 'configure' | 'setup' | 'waiting' | 'play' | 'spectate' | 'end';

interface MazeShellProps extends PropsWithChildren {
  screen: MazeScreen;
  phase?: MazePhase;
  className?: string;
}

export default function MazeShell({
  children,
  screen,
  phase,
  className = '',
}: MazeShellProps) {
  return (
    <div
      className={`${styles.shell} ${className}`.trim()}
      data-maze-shell="pastel-toy-v1"
      data-maze-screen={screen}
      data-maze-phase={phase}
    >
      <div className={styles.paperGlow} aria-hidden="true" />
      <div className={styles.mintGlow} aria-hidden="true" />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
