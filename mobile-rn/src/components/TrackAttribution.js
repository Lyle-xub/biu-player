import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';

export function TrackTitle({ track, style, numberOfLines = 1 }) {
  const source = track.isSegment && track.parentTitle;
  return <View style={styles.line}>
    <Text style={[style, styles.text, source && styles.primary]} numberOfLines={numberOfLines}>{track.title}</Text>
    {source ? <Text style={styles.source} numberOfLines={1}>· {source}</Text> : null}
  </View>;
}

export function TrackArtist({ track, onPressUp, style }) {
  const source = track.isSegment && track.parentUp;
  const label = track.isSegment ? source : track.up;
  const link = label ? (onPressUp ? <TouchableOpacity
    accessibilityRole="link" accessibilityLabel={`打开 ${label} 的 UP 主页`}
    onPress={(event) => { event?.stopPropagation?.(); onPressUp(); }}
    hitSlop={6} style={styles.link}>
    <Text style={source ? styles.source : [style, styles.upLink]} numberOfLines={1}>{source ? `· ${source}` : label}</Text>
  </TouchableOpacity> : <Text style={source ? styles.source : style} numberOfLines={1}>{source ? `· ${source}` : label}</Text>) : null;
  return <View style={styles.line}>
    {track.isSegment ? <Text style={[style, styles.text, source && styles.primary]} numberOfLines={1}>{track.up}</Text> : null}
    {link}
  </View>;
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'baseline', minWidth: 0, gap: 5 },
  text: { flexShrink: 1, minWidth: 0 },
  // Keep the source visible even when a recognized title or artist is long.
  primary: { maxWidth: '65%', flexShrink: 0 },
  source: { color: colors.text3, fontSize: 10, fontWeight: '400', flexShrink: 1 },
  link: { flexShrink: 1, minWidth: 0 },
  upLink: { color: colors.accent },
});
