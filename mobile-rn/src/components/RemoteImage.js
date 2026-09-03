import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { imageHeaders } from '../api/client';

const RETRY_DELAYS = [250, 750];

export function optimizedImageUri(value, width, height, attempt = 0) {
  if (!value) return null;
  const normalized = String(value).startsWith('//')
    ? `https:${value}` : String(value).replace(/^http:/, 'https:');
  try {
    const url = new URL(normalized);
    const match = url.hostname.match(/^i([0-2])\.hdslb\.com$/i);
    if (!match) return normalized;
    if (attempt > 0) url.hostname = `i${(Number(match[1]) + attempt) % 3}.hdslb.com`;
    url.pathname = url.pathname.replace(/@[^/]+$/, '');
    const w = Math.max(1, Math.round(width || 640));
    const h = Math.max(1, Math.round(height || w));
    url.pathname += `@${w}w_${h}h_1c.webp`;
    return url.toString();
  } catch (e) {
    return normalized;
  }
}

export default function RemoteImage({ uri, width, height, style, fallback = null, cachePolicy = 'disk', ...props }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    setAttempt(0);
    setFailed(false);
    return () => clearTimeout(timer.current);
  }, [uri]);

  const retry = () => {
    if (attempt >= RETRY_DELAYS.length) {
      setFailed(true);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAttempt((value) => value + 1), RETRY_DELAYS[attempt]);
  };

  return (
    <View style={[styles.frame, style]}>
      {fallback}
      {uri && !failed ? (
        <Image
          {...props}
          key={`${uri}:${attempt}`}
          source={{ uri: optimizedImageUri(uri, width, height, attempt), headers: imageHeaders() }}
          style={StyleSheet.absoluteFill}
          contentFit={props.contentFit || 'cover'}
          cachePolicy={cachePolicy}
          recyclingKey={uri}
          transition={attempt ? 0 : 120}
          onError={retry}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
});
