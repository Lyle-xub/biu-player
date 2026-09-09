import { createWorkletRuntime, runOnRuntimeAsync } from 'react-native-worklets';
import createCompute from './compute.generated.js';
import { recordTiming } from './diagnostics';

let runtime;
// These operations consume JSON data. Native JSON encoding is much cheaper than
// Worklets recursively cloning/freezing thousands of JS objects (hundreds of ms
// on Android). Strings also isolate live state from Worklets' shareable cache.
export async function backgroundCompute(operation, ...args) {
  // Allocate lazily, so importing a screen never creates a worker on navigation.
  const totalStarted = performance.now();
  if (!runtime) {
    runtime = createWorkletRuntime({ name: 'biu-data' });
    recordTiming('runtime-init', performance.now() - totalStarted);
  }
  const encoded = args.map(value => JSON.stringify(value));
  recordTiming(operation, performance.now() - totalStarted, 'prepare');
  const started = performance.now();
  const task = runOnRuntimeAsync(runtime, (name, encodedValues) => {
    'worklet';
    const started = performance.now();
    globalThis.__biuCompute ||= createCompute();
    const values = encodedValues.map(raw => raw === undefined ? undefined : JSON.parse(raw));
    const value = globalThis.__biuCompute(name, ...values);
    return { value: JSON.stringify(value), duration: performance.now() - started };
  }, operation, encoded);
  recordTiming(operation, performance.now() - started, 'dispatch');
  const result = await task;
  recordTiming(operation, result.duration, 'worker');
  const received = performance.now();
  const value = result.value === undefined ? undefined : JSON.parse(result.value);
  recordTiming(operation, performance.now() - received, 'receive');
  recordTiming(operation, performance.now() - totalStarted, 'total');
  return value;
}
