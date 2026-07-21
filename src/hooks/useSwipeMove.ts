'use client';

import { useEffect, useRef } from 'react';
import { Direction } from '@/types/game';

interface SwipeMoveOptions {
  enabled?: boolean;
  minDistance?: number; // 플릭으로 인정할 최소 이동(px)
  maxDuration?: number; // 플릭으로 인정할 최대 시간(ms)
}

/**
 * 보드 스테이지를 밀어서(플릭) 방향 입력을 만드는 훅.
 * - 내 보드에서 시작한 모바일 제스처만 이동으로 처리
 * - 버튼/링크/[data-no-swipe] 위에서 시작한 제스처는 무시
 * - 대각선에 가까운 애매한 제스처는 무시 (오입력 방지)
 */
export function useSwipeMove(
  targetRef: React.RefObject<HTMLElement | null>,
  onMove: (direction: Direction) => void,
  // maxDuration은 "누르고 한참 있다 떼는" 오입력만 거르면 된다. 저사양
  // 기기에서는 렌더 부하로 포인터 이벤트 전달 자체가 늦어지므로 여유를 둔다.
  { enabled = true, minDistance = 28, maxDuration = 2600 }: SwipeMoveOptions = {}
) {
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const element = targetRef.current;
    if (!element) return;

    let start: { x: number; y: number; time: number; pointerId: number } | null = null;

    const handleDown = (event: PointerEvent) => {
      if (!enabledRef.current) return;
      if (!window.matchMedia('(max-width: 932px), (pointer: coarse)').matches) return;
      if (event.button !== 0) return;
      const origin = event.target as HTMLElement | null;
      if (origin?.closest('button, a, input, textarea, select, [data-no-swipe]')) return;
      const board = origin?.closest('[data-player-board][data-my-player="true"]');
      if (!board || !element.contains(board)) return;
      // event.timeStamp는 입력이 실제 발생한 시각이라 렌더 부하로 핸들러
      // 실행이 늦어져도 빠른 플릭이 "느린 드래그"로 오판되지 않는다.
      start = { x: event.clientX, y: event.clientY, time: event.timeStamp, pointerId: event.pointerId };
      // 빠른 플릭이 HUD 등 겹친 요소 위에서 끝나도 up 이벤트를 놓치지 않도록 캡처
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* 일부 브라우저에서 실패해도 무시 */
      }
    };

    const handleUp = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const elapsed = event.timeStamp - start.time;
      start = null;

      if (elapsed > maxDuration) return;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (Math.max(absX, absY) < minDistance) return;

      // 주축이 명확할 때만 이동 (대각선 오입력 방지)
      if (absX > absY * 1.2) {
        onMoveRef.current(dx > 0 ? 'right' : 'left');
      } else if (absY > absX * 1.2) {
        onMoveRef.current(dy > 0 ? 'down' : 'up');
      }
    };

    const handleCancel = () => {
      start = null;
    };

    element.addEventListener('pointerdown', handleDown);
    element.addEventListener('pointerup', handleUp);
    element.addEventListener('pointercancel', handleCancel);

    return () => {
      element.removeEventListener('pointerdown', handleDown);
      element.removeEventListener('pointerup', handleUp);
      element.removeEventListener('pointercancel', handleCancel);
    };
  }, [targetRef, minDistance, maxDuration]);
}
