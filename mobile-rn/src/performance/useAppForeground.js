import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export default function useAppForeground() {
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const update = state => setForeground(state === 'active');
    const subscription = AppState.addEventListener('change', update);
    if (AppState.currentState != null) update(AppState.currentState);
    return () => subscription.remove();
  }, []);
  return foreground;
}
