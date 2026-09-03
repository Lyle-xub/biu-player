/* Biu Player RN · 二维码本地渲染（qrcode 核心库出矩阵，react-native-svg 画路径） */
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
// core 子路径是纯 JS 实现，避开主入口对 node fs / DOM canvas 的依赖
// eslint-disable-next-line import/no-unresolved
import QRCodeGen from 'qrcode/lib/core/qrcode';

export default function QrCode({ text, size = 220, color = '#171810', background = '#ffffff' }) {
  const { path, cells } = useMemo(() => {
    const qr = QRCodeGen.create(text, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    let d = '';
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z `;
      }
    }
    return { path: d, cells: n };
  }, [text]);

  return (
    <View style={{ width: size, height: size, backgroundColor: background, borderRadius: 12, overflow: 'hidden', padding: 10 }}>
      <Svg width="100%" height="100%" viewBox={`-1 -1 ${cells + 2} ${cells + 2}`}>
        <Path d={path} fill={color} />
      </Svg>
    </View>
  );
}
