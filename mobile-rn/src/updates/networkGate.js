let recommendationRequests = 0;
const idleListeners = new Set();

export const isRecommendationBusy = () => recommendationRequests > 0;

export function beginRecommendation() {
  recommendationRequests += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    recommendationRequests = Math.max(0, recommendationRequests - 1);
    if (!recommendationRequests) idleListeners.forEach((listener) => listener());
  };
}

export function onRecommendationIdle(listener) {
  idleListeners.add(listener);
  return () => idleListeners.delete(listener);
}
