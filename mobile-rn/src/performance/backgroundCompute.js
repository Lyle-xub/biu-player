import { createWorkletRuntime, runOnRuntimeAsync } from 'react-native-worklets';
import createCompute from './compute.generated.js';
import { recordTiming } from './diagnostics';

let runtime;
// Worklets caches/freezes transferred objects. Never hand it live React/store
// objects (playback metadata can be enriched later). Bound cloning per JS turn.
async function copyArguments(args) {
  const output = [], pending = [[args, output]];
  const seen = new WeakMap([[args, output]]);
  let budget = performance.now();
  while (pending.length) {
    const [source, target] = pending.pop();
    for (const key of Object.keys(source)) {
      const value = source[key];
      if (key === '__proto__') Object.defineProperty(target, key, { value: undefined, writable: true, enumerable: true, configurable: true });
      if (value && typeof value === 'object') {
        if (seen.has(value)) target[key] = seen.get(value);
        else {
          target[key] = Array.isArray(value) ? [] : {};
          seen.set(value, target[key]); pending.push([value, target[key]]);
        }
      } else target[key] = value;
      if (performance.now() - budget >= 4) {
        await new Promise(resolve => setTimeout(resolve, 0));
        budget = performance.now();
      }
    }
  }
  return output;
}
export async function backgroundCompute(operation, ...args) {
  // Allocate lazily, so importing a screen never creates a worker on navigation.
  const totalStarted = performance.now();
  if (!runtime) {
    runtime = createWorkletRuntime({ name: 'biu-data' });
    recordTiming('runtime-init', performance.now() - totalStarted);
  }
  const copied = await copyArguments(args);
  recordTiming(operation, performance.now() - totalStarted, 'prepare');
  const started = performance.now();
  const task = runOnRuntimeAsync(runtime, (name, values) => {
    'worklet';
    const started = performance.now();
    globalThis.__biuCompute ||= createCompute();
    const value = globalThis.__biuCompute(name, ...values);
    return { value, duration: performance.now() - started };
  }, operation, copied);
  recordTiming(operation, performance.now() - started, 'dispatch');
  const result = await task;
  recordTiming(operation, result.duration, 'worker');
  recordTiming(operation, performance.now() - totalStarted, 'total');
  return result.value;
}
