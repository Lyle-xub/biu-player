/* Biu Player RN · 线性图标（react-native-svg，无第三方图标库依赖） */
import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

const I = ({ size = 22, color = '#f2f3ef', children, viewBox = '0 0 24 24' }) => (
  <Svg width={size} height={size} viewBox={viewBox} fill="none">{children}</Svg>
);

const stroke = (color, extra = {}) => ({
  stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', ...extra,
});

export const IconHome = ({ size, color }) => (
  <I size={size} color={color}>
    <Path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19Z" {...stroke(color)} />
    <Path d="M9.5 20v-6h5v6" {...stroke(color)} />
  </I>
);

export const IconRadio = ({ size, color }) => (
  <I size={size} color={color}>
    <Circle cx={12} cy={12} r={2} {...stroke(color)} />
    <Path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" {...stroke(color)} />
  </I>
);

export const IconSearch = ({ size, color }) => (
  <I size={size} color={color}>
    <Circle cx={11} cy={11} r={7} {...stroke(color)} />
    <Path d="m20 20-3.8-3.8" {...stroke(color)} />
  </I>
);

export const IconUser = ({ size, color }) => (
  <I size={size} color={color}>
    <Circle cx={12} cy={8} r={4} {...stroke(color)} />
    <Path d="M4.5 20c1.6-3.4 4.3-5 7.5-5s5.9 1.6 7.5 5" {...stroke(color)} />
  </I>
);

export const IconPlay = ({ size = 26, color = '#0b0d09' }) => (
  <I size={size} color={color}>
    <Path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z" fill={color} />
  </I>
);

export const IconPause = ({ size = 26, color = '#0b0d09' }) => (
  <I size={size} color={color}>
    <Rect x={6.5} y={4.5} width={4} height={15} rx={1.2} fill={color} />
    <Rect x={13.5} y={4.5} width={4} height={15} rx={1.2} fill={color} />
  </I>
);

export const IconNext = ({ size = 24, color }) => (
  <I size={size} color={color}>
    <Path d="M6 5.8v12.4a1 1 0 0 0 1.55.83l8.7-6.2a1 1 0 0 0 0-1.66L7.55 4.97A1 1 0 0 0 6 5.8Z" fill={color} />
    <Path d="M18.5 5v14" {...stroke(color, { strokeWidth: 2.2 })} />
  </I>
);

export const IconPrev = ({ size = 24, color }) => (
  <I size={size} color={color}>
    <Path d="M18 5.8v12.4a1 1 0 0 1-1.55.83l-8.7-6.2a1 1 0 0 1 0-1.66l8.7-6.2A1 1 0 0 1 18 5.8Z" fill={color} />
    <Path d="M5.5 5v14" {...stroke(color, { strokeWidth: 2.2 })} />
  </I>
);

export const IconHeart = ({ size = 22, color, filled = false }) => (
  <I size={size} color={color}>
    <Path
      d="M12 20.3C7.2 17 3.6 13.8 3.6 9.9 3.6 7.2 5.7 5 8.3 5c1.5 0 2.9.8 3.7 2 .8-1.2 2.2-2 3.7-2 2.6 0 4.7 2.2 4.7 4.9 0 3.9-3.6 7.1-8.4 10.4Z"
      {...(filled ? { fill: color } : stroke(color))}
    />
  </I>
);

export const IconBack = ({ size = 22, color }) => (
  <I size={size} color={color}>
    <Path d="m14.5 5.5-6.5 6.5 6.5 6.5" {...stroke(color, { strokeWidth: 2 })} />
  </I>
);

export const IconNote = ({ size = 14, color }) => (
  <I size={size} color={color}>
    <Path d="M9 18V6l10-2.5V15" {...stroke(color)} />
    <Circle cx={6.8} cy={18} r={2.2} {...stroke(color)} />
    <Circle cx={16.8} cy={15} r={2.2} {...stroke(color)} />
  </I>
);

export const IconStar = ({ size = 20, color, filled = false }) => (
  <I size={size} color={color}>
    <Path
      d="m12 3.6 2.47 5.28 5.78.66-4.3 3.95 1.15 5.7L12 16.44l-5.1 2.75 1.15-5.7-4.3-3.95 5.78-.66Z"
      {...(filled ? { fill: color } : { ...stroke(color), fill: 'none' })}
    />
  </I>
);

export const IconMore = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Circle cx={5.5} cy={12} r={1.4} fill={color} />
    <Circle cx={12} cy={12} r={1.4} fill={color} />
    <Circle cx={18.5} cy={12} r={1.4} fill={color} />
  </I>
);

export const IconVolumeLow = ({ size = 18, color }) => (
  <I size={size} color={color}>
    <Path d="M4 9.5v5h3.2L12 18.4V5.6L7.2 9.5Z" fill={color} />
    <Path d="M15 9.8a3.2 3.2 0 0 1 0 4.4" {...stroke(color)} />
  </I>
);

export const IconVolumeHigh = ({ size = 18, color }) => (
  <I size={size} color={color}>
    <Path d="M4 9.5v5h3.2L12 18.4V5.6L7.2 9.5Z" fill={color} />
    <Path d="M15 9.8a3.2 3.2 0 0 1 0 4.4M17.2 7.2a6.4 6.4 0 0 1 0 9.6" {...stroke(color)} />
  </I>
);

export const IconLyric = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M7 17.5a2.5 2.5 0 1 0 .01-5.01A2.5 2.5 0 0 0 7 17.5ZM9.5 15V5.8L18 4v8.5" {...stroke(color)} />
    <Path d="M15.5 15a2.5 2.5 0 1 0 .01-5.01A2.5 2.5 0 0 0 15.5 15Z" {...stroke(color)} />
  </I>
);

export const IconQueue = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M4 6.5h16M4 11h16M4 15.5h9" {...stroke(color, { strokeWidth: 1.9 })} />
  </I>
);

export const IconVideo = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Rect x={3.5} y={6} width={12.5} height={12} rx={3} {...stroke(color)} />
    <Path d="m16 10.8 4.5-2.6v7.6L16 13.2" {...stroke(color)} />
  </I>
);

export const IconChevronDown = ({ size = 22, color }) => (
  <I size={size} color={color}>
    <Path d="m5.5 9 6.5 6.5L18.5 9" {...stroke(color, { strokeWidth: 2 })} />
  </I>
);

export const IconShare = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M12 3.5v10M8.5 6.5 12 3l3.5 3.5" {...stroke(color)} />
    <Path d="M6 10.5H5a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 5 20.5h14a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1" {...stroke(color)} />
  </I>
);
