import { useLayoutEffect, useState } from 'react';

// Both rows have fixed cover sizes and vertical padding in renderer/styles.css.
export const TRACK_ROW_HEIGHT = 62;
export const QUEUE_ROW_HEIGHT = 56;
const MIN_WINDOWED_SIZE = 80;
const OVERSCAN = 10;

export function getRowWindow(count, rowHeight, scrollTop, viewportHeight, offset = 0) {
  const top = Math.max(0, scrollTop - offset);
  const first = Math.max(0, Math.min(count, Math.floor(top / rowHeight)) - OVERSCAN);
  const last = Math.min(count, Math.ceil((top + viewportHeight) / rowHeight) + OVERSCAN);
  return { first, last };
}

export function useRowWindow(listRef, count, rowHeight, { allow = true, outerScroller = false } = {}) {
  const [windowed, setWindowed] = useState(() => getRowWindow(count, rowHeight, 0, 720));
  const enabled = allow && count > MIN_WINDOWED_SIZE && !!window.bili;
  useLayoutEffect(() => {
    if (!enabled) return;
    const list = listRef.current;
    const scroller = outerScroller ? list?.closest('.view') : list;
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const height = scroller.clientHeight;
      if (!height) return;
      const scrollTop = scroller.scrollTop;
      // The track list lives below the playlist header inside its scroll view.
      const offset = outerScroller ? list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scrollTop : 0;
      const next = getRowWindow(count, rowHeight, scrollTop, height, offset);
      setWindowed(previous => previous.first === next.first && previous.last === next.last ? previous : next);
    };
    const sync = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    scroller.addEventListener('scroll', sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(scroller);
    if (outerScroller) {
      observer.observe(list);
      const header = scroller.querySelector('.pl-head');
      if (header) observer.observe(header);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener('scroll', sync);
    };
  }, [count, enabled, listRef, outerScroller, rowHeight]);
  if (!enabled) return { first: 0, last: count };
  // The first render can precede the data (list count zero) or preserve the
  // old range of a longer playlist; always mount a useful initial window.
  return windowed.first < Math.min(windowed.last, count)
    ? { first: windowed.first, last: Math.min(windowed.last, count) }
    : getRowWindow(count, rowHeight, 0, 720);
}
