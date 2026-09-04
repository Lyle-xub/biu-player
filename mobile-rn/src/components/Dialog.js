import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { colors } from '../theme';

export function Dialog({ visible, onClose, children }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} placement="center" animationType="fade">
      <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" bounces={false} contentContainerStyle={styles.content}>
        {children}
      </ScrollView>
    </BottomSheet>
  );
}

export default function ConfirmDialog({ config, onClose }) {
  return (
    <Dialog visible={!!config} onClose={onClose}>
      <Text style={styles.title} accessibilityRole="header">{config?.title}</Text>
      <Text style={styles.message}>{config?.message}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancel} onPress={onClose} accessibilityRole="button" accessibilityLabel="取消">
          <Text style={styles.cancelText}>取消</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.confirm, config?.destructive && styles.destructive]}
          accessibilityRole="button" accessibilityLabel={config?.confirmText}
          onPress={() => { onClose(); config?.onConfirm(); }}>
          <Text style={styles.confirmText}>{config?.confirmText}</Text>
        </TouchableOpacity>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14 },
  title: { color: colors.text, fontSize: 18, fontWeight: '600' },
  message: { color: colors.text2, fontSize: 14, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancel: { flex: 1, minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  confirm: { flex: 1, minHeight: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  destructive: { backgroundColor: colors.danger },
  cancelText: { color: colors.text2, fontSize: 14 },
  confirmText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
