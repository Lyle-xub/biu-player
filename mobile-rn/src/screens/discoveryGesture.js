// Shared by UI-thread worklets and the executable gesture/physics regression checks.
export const clamp = (value, low, high) => {
  'worklet';
  return Math.max(low, Math.min(high, value));
};
export function wrap(value, period) {
  'worklet';
  return ((value % period) + period) % period;
}
export function wheelGeometry(count, height) {
  'worklet';
  // Two complete copies fill 360°. Increase radius to preserve folder spacing.
  const radius = Math.max(190, count * 86 / Math.PI);
  return { radius, step: 180 / Math.max(1, count),
    halfHeight: Math.max(60, Math.min(210, radius * 0.82, height / 2 - 28)) };
}
export function wheelPosition(slot, rotation, count, radius) {
  'worklet';
  const angle = wrap(slot * 180 / Math.max(1, count) + rotation + 180, 360) - 180;
  const rad = angle * Math.PI / 180;
  return { x: radius * (1 - Math.cos(rad)), y: radius * Math.sin(rad), front: Math.abs(angle) < 85 };
}
export function visibleWheelSlots(center, count, height) {
  'worklet';
  if (!count) return [];
  const { radius, halfHeight, step } = wheelGeometry(count, height);
  // Two overscan positions cover the next folders while JS recycles the window.
  const span = Math.ceil(Math.asin(Math.min(1, halfHeight / radius)) * 180 / Math.PI / step) + 2;
  if (count * 2 <= span * 2 + 1) return Array.from({ length: count * 2 }, (_, slot) => slot);
  const slots = [];
  for (let offset = -span; offset <= span && slots.length < count * 2; offset++) slots.push(wrap(center + offset, count * 2));
  return slots;
}
export function wheelHit(x, y, width, height, rotation, count) {
  'worklet';
  if (!count) return -1;
  const { radius, halfHeight } = wheelGeometry(count, height);
  if (Math.abs(y - height / 2) > halfHeight) return -1;
  const angle = Math.asin(clamp((y - height / 2) / radius, -1, 1)) * 180 / Math.PI;
  const slot = wrap(Math.round((angle - rotation) / (180 / count)), count * 2);
  const point = wheelPosition(slot, rotation, count, radius);
  // A little touch padding around the folder, whose name is now on its front.
  return point.front && Math.abs(y - height / 2 - point.y) <= 39
    && x >= width - 128 + point.x && x <= width + 12 ? slot : -1;
}
export function wheelEdgeSpeed(x, y, width, height, count) {
  'worklet';
  if (x < width - 210) return 0;
  const { radius, halfHeight } = wheelGeometry(count, height);
  const distance = y - height / 2;
  const zone = Math.min(72, halfHeight * 0.45);
  const proximity = clamp((Math.abs(distance) - (halfHeight - zone)) / zone, 0, 1);
  // Pixel speed is independent of folder count; smooth acceleration at the edge.
  return Math.sign(distance) * 560 / radius * 180 / Math.PI * proximity * proximity;
}
export function coastWheel(rotation, velocity, seconds) {
  'worklet';
  const dt = clamp(seconds, 0, 0.05);
  const decay = Math.exp(-4.2 * dt);
  return { rotation: wrap(rotation + velocity * (1 - decay) / 4.2, 360),
    velocity: Math.abs(velocity * decay) < 0.6 ? 0 : velocity * decay };
}
export function resolveDiscoveryGesture({ dx, dy, vx, vy, index, trackCount, dragging = false, targetIndex = -1 }) {
  'worklet';
  const nextIndex = Math.min(index + 1, trackCount);
  // Once a right drag has opened the wheel, vertical motion belongs to that drag.
  if (dragging) return targetIndex >= 0 ? { type: 'target', nextIndex, targetIndex }
    : { type: 'cancel', nextIndex: index };
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx < -54 || (dx < -10 && vx < -420)) return { type: 'related', nextIndex: index };
  } else {
    if (dy < -54 || (dy < -10 && vy < -420)) return { type: 'next', nextIndex };
    if (dy > 54 || (dy > 10 && vy > 420)) return { type: 'dislike', nextIndex };
  }
  return { type: 'cancel', nextIndex: index };
}

export function cardExitEasing(progress) {
  'worklet';
  // Start moving immediately instead of easing in again after the drag.
  return 1 - (1 - progress) * (1 - progress);
}
export function cardExitTiming(from, to, velocity) {
  'worklet';
  const distance = Math.abs(to - from);
  const forwardSpeed = Math.max(0, Math.sign(to - from) * velocity);
  return { duration: clamp(distance / Math.max(1800, forwardSpeed) * 1000, 120, 280), easing: cardExitEasing };
}
