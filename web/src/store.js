import { useSyncExternalStore } from 'react';

const slices = new Map();
const listeners = new Set();

export function publish(key, value) {
  slices.set(key, value);
  listeners.forEach((l) => l());
}

export function peek(key) {
  return slices.get(key);
}

export function useSlice(key) {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    (k = key) => slices.get(k),
  );
}
