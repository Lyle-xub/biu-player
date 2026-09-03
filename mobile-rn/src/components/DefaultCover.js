/* 与桌面端 renderer/api.js coverSVG 相同的稳定随机封面。 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function defaultCoverSeed(id, base = 20, variants = 12) {
  const numeric = Number(id);
  if (Number.isSafeInteger(numeric)) return base + Math.abs(numeric) % variants;
  let hash = 2166136261;
  for (const ch of String(id || '')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return base + (hash >>> 0) % variants;
}

export function coverDesign(seed) {
  const r = mulberry(seed * 7919 + 13);
  const h1 = Math.floor(r() * 360);
  const h2 = (h1 + 40 + r() * 80) % 360;
  const c1 = `hsl(${h1}, 48%, ${36 + r() * 20}%)`;
  const c2 = `hsl(${h2}, 52%, ${20 + r() * 16}%)`;
  const c3 = `hsl(${(h1 + 160) % 360}, 65%, 72%)`;
  // 桌面端在选取图形前会先生成四组图形的随机参数，保持同样的调用顺序。
  const circleX = 60 + r() * 30;
  const circleY = 20 + r() * 25;
  const waveY = 55 + r() * 15;
  const ellipseX = 30 + r() * 40;
  const gradientX = r() > 0.5 ? 1 : 0;
  const shape = Math.floor(r() * 4);
  return { c1, c2, c3, circleX, circleY, waveY, ellipseX, gradientX, shape };
}

export default function DefaultCover({ seed = 1, style }) {
  const d = coverDesign(seed);
  const gradientId = `default-cover-${seed}`;
  return (
    <View style={[styles.frame, style]}>
      <Svg viewBox="0 0 100 100" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2={d.gradientX} y2="1">
            <Stop offset="0" stopColor={d.c1} />
            <Stop offset="1" stopColor={d.c2} />
          </LinearGradient>
        </Defs>
        <Rect width="100" height="100" fill={`url(#${gradientId})`} />
        {d.shape === 0 ? (
          <>
            <Circle cx={d.circleX} cy={d.circleY} r="18" fill={d.c3} opacity="0.55" />
            <Circle cx="25" cy="75" r="28" fill={d.c2} opacity="0.8" />
          </>
        ) : d.shape === 1 ? (
          <>
            <Path d={`M0 78 Q 50 ${d.waveY} 100 78 L 100 100 L 0 100Z`} fill={d.c3} opacity="0.45" />
            <Circle cx="30" cy="30" r="13" fill={d.c3} opacity="0.7" />
          </>
        ) : d.shape === 2 ? (
          <>
            <Rect x="10" y="15" width="38" height="28" fill={d.c3} opacity="0.6" rx="3.5" rotation="-6" origin="10,15" />
            <Rect x="42" y="45" width="42" height="32" fill={d.c2} rx="3.5" rotation="4" origin="42,45" />
          </>
        ) : (
          <>
            <Ellipse cx={d.ellipseX} cy="35" rx="30" ry="12" fill={d.c2} opacity="0.85" />
            <Ellipse cx="55" cy="62" rx="34" ry="13" fill={d.c3} opacity="0.4" />
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
});
