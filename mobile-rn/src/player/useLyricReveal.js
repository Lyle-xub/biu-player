import { useLayoutEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing } from 'react-native';

const DURATION = 260;

// Keep the outgoing layout for the fade only. The lyric animation graph starts
// after this lightweight transition, rather than delaying its native commit.
export default function useLyricReveal(mode) {
  const progress = useRef(new Animated.Value(mode === 'lyrics' ? 1 : 0)).current;
  const previous = useRef(mode);
  const [settled, setSettled] = useState(mode);
  useLayoutEffect(() => {
    if (previous.current === mode) return undefined;
    previous.current = mode;
    setSettled(null);
    let cancelled = false, finished = false;
    const target = mode === 'lyrics' ? 1 : 0;
    const animation = Animated.timing(progress, { toValue: target, duration: DURATION,
      easing: Easing.bezier(0.22, 0.61, 0.36, 1), useNativeDriver: true, isInteraction: false });
    const finish = () => {
      if (cancelled || finished) return;
      finished = true;
      clearTimeout(timer);
      animation.stop();
      progress.setValue(target);
      setSettled(mode);
    };
    // Backgrounding or an interrupted native callback must not leave the cover
    // visible indefinitely. Resuming snaps to the requested mode as well.
    const timer = setTimeout(finish, DURATION + 80);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') finish(); });
    animation.start(result => { if (result?.finished) finish(); });
    return () => { cancelled = true; clearTimeout(timer); subscription.remove(); animation.stop(); };
  }, [mode, progress]);
  return { progress, transitioning: settled !== mode,
    coverVisible: mode === 'cover' || settled !== mode,
    lyricsReady: mode === 'lyrics' && settled === 'lyrics' };
}
