export const smoothScrollContainerBy = (
  container: HTMLDivElement,
  deltaY: number,
  durationMs = 700,
): void => {
  if (Math.abs(deltaY) < 1) return;
  const startTop = container.scrollTop;
  const targetTop = startTop + deltaY;
  const startTs = performance.now();
  const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const tick = (now: number) => {
    const elapsed = now - startTs;
    const progress = Math.min(1, elapsed / durationMs);
    container.scrollTop = startTop + (targetTop - startTop) * easeInOut(progress);
    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
};

interface NudgeOptions {
  topOffset?: number;
  bottomOffset?: number;
  allowBelowNudge?: boolean;
  maxAboveNudge?: number;
}

export const nudgeIntoViewIfPartiallyVisible = (
  container: HTMLDivElement | null,
  element: HTMLElement,
  {
    topOffset = 1,
    bottomOffset = 8,
    allowBelowNudge = false,
    maxAboveNudge = 28,
  }: NudgeOptions = {},
): void => {
  if (!container) return;

  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const visibleTop = containerRect.top + topOffset;
  const visibleBottom = containerRect.bottom - bottomOffset;

  const partiallyVisibleFromAbove = elementRect.top < visibleTop && elementRect.bottom > visibleTop;
  if (partiallyVisibleFromAbove) {
    const rawDelta = elementRect.top - visibleTop;
    const limitedDelta = Math.max(rawDelta, -maxAboveNudge);
    smoothScrollContainerBy(container, limitedDelta);
    return;
  }

  if (!allowBelowNudge) return;

  const partiallyVisibleFromBelow = elementRect.bottom > visibleBottom && elementRect.top < visibleBottom;
  if (partiallyVisibleFromBelow) {
    smoothScrollContainerBy(container, elementRect.bottom - visibleBottom);
  }
};
