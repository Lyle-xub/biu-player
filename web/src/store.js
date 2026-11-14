import { useCallback, useSyncExternalStore } from 'react';

const slices = new Map();
const listeners = new Map();

export function publish(key, value) {
  if (Object.is(slices.get(key), value)) return;
  slices.set(key, value);
  listeners.get(key)?.forEach((listener) => listener());
}

export function peek(key) {
  return slices.get(key);
}

export function useSlice(key) {
  return useSyncExternalStore(
    useCallback((listener) => {
      let group = listeners.get(key);
      if (!group) listeners.set(key, group = new Set());
      group.add(listener);
      return () => {
        group.delete(listener);
        if (!group.size) listeners.delete(key);
      };
    }, [key]),
    useCallback(() => peek(key), [key]),
  );
}
