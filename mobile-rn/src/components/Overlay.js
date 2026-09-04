import React, { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

const OverlayContext = createContext(null);

// 在导航器上方绘制应用内浮层，不创建系统 Dialog / Modal 窗口。
export function OverlayProvider({ children }) {
  const [entries, setEntries] = useState([]);
  const api = useMemo(() => ({
    set(id, children, onClose) {
      setEntries((items) => {
        const index = items.findIndex((item) => item.id === id);
        const entry = { id, children, onClose };
        return index < 0 ? [...items, entry] : items.map((item, i) => i === index ? entry : item);
      });
    },
    remove(id) { setEntries((items) => items.filter((item) => item.id !== id)); },
  }), []);
  useEffect(() => {
    if (!entries.length) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      entries.at(-1).onClose?.();
      return true;
    });
    return () => subscription.remove();
  }, [entries]);
  return (
    <OverlayContext.Provider value={api}>
      <View style={styles.fill}>
        <View style={styles.fill} pointerEvents={entries.length ? 'none' : 'auto'}
          accessibilityElementsHidden={!!entries.length}
          importantForAccessibility={entries.length ? 'no-hide-descendants' : 'auto'}>
          {children}
        </View>
        {entries.map((entry, index) => (
          <View key={entry.id} style={[StyleSheet.absoluteFill, styles.layer]}
            pointerEvents={index === entries.length - 1 ? 'auto' : 'none'}
            accessibilityViewIsModal={index === entries.length - 1}
            accessibilityElementsHidden={index !== entries.length - 1}
            importantForAccessibility={index === entries.length - 1 ? 'yes' : 'no-hide-descendants'}>
            {entry.children}
          </View>
        ))}
      </View>
    </OverlayContext.Provider>
  );
}

export default function Overlay({ children, onClose }) {
  const api = useContext(OverlayContext);
  const id = useId();
  useLayoutEffect(() => { api.set(id, children, onClose); }, [api, id, children, onClose]);
  useLayoutEffect(() => () => api.remove(id), [api, id]);
  return null;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  layer: { zIndex: 100, elevation: 100 },
});
