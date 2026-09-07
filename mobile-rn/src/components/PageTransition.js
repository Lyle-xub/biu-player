import { colors } from '../theme';

// Native-stack owns entry and back transitions on both platforms. Do not block
// route removal on a JS animation callback, especially during cold-start work.
export const pageScreenOptions = {
  presentation: 'card', animation: 'slide_from_right', gestureEnabled: true,
  fullScreenGestureEnabled: true,
  contentStyle: { backgroundColor: colors.bg },
};

export default function PageTransition({ children }) {
  return children;
}
