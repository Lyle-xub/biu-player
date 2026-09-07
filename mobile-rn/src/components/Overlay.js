import React, { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';

const OverlayContext = createContext(null);
const OverlayActivityContext = createContext(true);

// Visual presence and input ownership are separate: a closing animation never
// disables navigation, and an offscreen route must not own a global portal.
export function OverlayProvider({ children }) {
  const [entries, setEntries] = useState([]);
  const api = useMemo(() => ({
    set(id, children, onClose, active) {
      setEntries(items => {
        const index = items.findIndex(item => item.id === id);
        const entry = { id, children, onClose, active };
        return index < 0 ? [...items, entry] : items.map((item, i) => i === index ? entry : item);
      });
    },
    remove(id) { setEntries(items => items.some(item => item.id === id) ? items.filter(item => item.id !== id) : items); },
  }), []);
  const top = entries.reduce((last, entry) => entry.active ? entry : last, null);
  const topRef = useRef(top);
  useLayoutEffect(() => { topRef.current = top; }, [top]);
  useLayoutEffect(() => {
    if (!top) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const current = topRef.current;
      if (!current || typeof current.onClose !== 'function') return false;
      current.onClose();
      return true;
    });
    return () => subscription.remove();
  }, [!!top]);
  return (
    <OverlayContext.Provider value={api}>
      <View style={styles.fill}>
        {/* The visible top layer intercepts input; never toggle the whole app's responder. */}
        <View style={styles.fill} accessibilityElementsHidden={!!top}
          importantForAccessibility={top ? 'no-hide-descendants' : 'auto'}>
          {children}
        </View>
        {entries.map(entry => (
          <View key={entry.id} style={[StyleSheet.absoluteFill, styles.layer]}
            pointerEvents={entry === top ? 'auto' : 'none'}
            accessibilityViewIsModal={entry === top}
            accessibilityElementsHidden={entry !== top}
            importantForAccessibility={entry === top ? 'yes' : 'no-hide-descendants'}>
            <OverlayActivityContext.Provider value={entry.active}>{entry.children}</OverlayActivityContext.Provider>
          </View>
        ))}
      </View>
    </OverlayContext.Provider>
  );
}

export default function Overlay({ children, onClose, active = true }) {
  const api = useContext(OverlayContext);
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);
  const parentActive = useContext(OverlayActivityContext);
  const id = useId();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const subscribe = useCallback(listener => {
    const focus = navigation?.addListener('focus', listener);
    const blur = navigation?.addListener('blur', () => {
      // Remove directly from the host even if native-stack freezes the owner.
      api.remove(id); closeRef.current?.(); listener();
    });
    return () => { focus?.(); blur?.(); };
  }, [navigation, api, id]);
  const getFocused = useCallback(() => navigation?.isFocused?.() ?? true, [navigation]);
  const focused = useSyncExternalStore(subscribe, getFocused, getFocused);
  // A portal changes the React parent. Carry the originating route through it so
  // nested dialogs and navigation actions still belong to the source screen.
  const content = useMemo(() => (
    <NavigationContext.Provider value={navigation}>
      <NavigationRouteContext.Provider value={route}>{children}</NavigationRouteContext.Provider>
    </NavigationContext.Provider>
  ), [navigation, route, children]);
  useLayoutEffect(() => {
    if (focused) api.set(id, content, onClose, active && parentActive);
    else api.remove(id);
  }, [api, id, content, onClose, active, parentActive, focused]);
  useLayoutEffect(() => () => api.remove(id), [api, id]);
  return null;
}

const styles = StyleSheet.create({ fill: { flex: 1 }, layer: { zIndex: 100, elevation: 100 } });
