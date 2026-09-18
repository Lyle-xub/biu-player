import { pauseAnalysis } from '../recommendation/analysisGate';
// Bounded metadata-only diagnostics. No titles, account IDs, library or keys.
const events = [];
const now = () => performance.now();
let navigation;
export function recordTiming(name, milliseconds, phase = 'js') {
  const event = { name, ms: Math.round(milliseconds * 10) / 10, phase, at: Date.now() };
  events.push(event);
  if (events.length > 120) events.shift();
  if (milliseconds >= 100) console.info('[BiuTiming]', JSON.stringify(event));
}
export const readTimings = () => events.slice();
export function navigationPressed(target) { pauseAnalysis(); navigation = { target, started: now() }; }
export function navigationCommitted(target) {
  const request = navigation;
  if (!request || request.target !== target) return;
  navigation = null;
  recordTiming('navigation:' + target, now() - request.started, 'state');
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => recordTiming('navigation:' + target, now() - request.started, 'next-frame'));
}
export function monitorEventLoop() {
  let previous = now();
  const timer = setInterval(() => {
    const current = now(), delay = current - previous - 250;
    previous = current;
    if (delay >= 100) recordTiming('event-loop', delay);
  }, 250);
  return () => clearInterval(timer);
}
