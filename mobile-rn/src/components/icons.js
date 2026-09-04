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

export const IconEdit = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="m15 4 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-4-4L5 15Z" {...stroke(color)} />
  </I>
);

export const IconTrash = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" {...stroke(color)} />
  </I>
);

export const IconCheck = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="m5 12 4.5 4.5L19 7" {...stroke(color)} />
  </I>
);

export const IconReorder = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M4 6h9M4 12h9M4 18h9m3-9 3-3 3 3M19 6v12m-3-3 3 3 3-3" {...stroke(color)} />
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

export const IconRepeat = ({ size = 20, color, single = false }) => (
  <I size={size} color={color}>
    <Path d="m17 3 3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" {...stroke(color)} />
    {single ? <Path d="m10.5 11 1.5-1v5M10.5 15h3" {...stroke(color, { strokeWidth: 1.5 })} /> : null}
  </I>
);

export const IconShuffle = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M4 6h2c4 0 8 12 12 12h2M4 18h2c1.5 0 3-1.7 4.5-4M13.5 10C15 7.7 16.5 6 18 6h2M17 3l3 3-3 3M17 15l3 3-3 3" {...stroke(color)} />
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

export const IconChevronRight = ({ size = 18, color }) => (
  <I size={size} color={color}>
    <Path d="m9.5 5.5 6.5 6.5-6.5 6.5" {...stroke(color, { strokeWidth: 2 })} />
  </I>
);

export const IconPlus = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M12 5v14M5 12h14" {...stroke(color, { strokeWidth: 2 })} />
  </I>
);

export const IconThumbUp = ({ size = 20, color, filled = false }) => (
  <I size={size} color={color}>
    <Path
      d="M7 10.5v9.8H4.4a1 1 0 0 1-1-1v-7.8a1 1 0 0 1 1-1H7Zm0 .2 4.1-6.4c.5-.7 1.6-.6 2 .2.3.6.4 1.4.2 2.1l-.8 2.9h6.3a1.6 1.6 0 0 1 1.6 1.9l-1.4 7a2 2 0 0 1-2 1.6H7"
      {...(filled ? { fill: color } : stroke(color))}
    />
  </I>
);

export const IconCoin = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Circle cx={12} cy={12} r={8.5} {...stroke(color)} />
    <Circle cx={12} cy={12} r={4} {...stroke(color, { strokeWidth: 1.5 })} />
  </I>
);

export const IconComment = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path
      d="M20 11.5c0 4.1-3.6 7.5-8 7.5-1 0-2-.15-2.9-.44L4.5 20l1.1-3.2A7.3 7.3 0 0 1 4 11.5C4 7.4 7.6 4 12 4s8 3.4 8 7.5Z"
      {...stroke(color)}
    />
  </I>
);

export const IconDownload = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M12 3.5v10M8.5 10 12 13.5 15.5 10" {...stroke(color)} />
    <Path d="M4.5 15.5v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" {...stroke(color)} />
  </I>
);

export const IconSplit = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M4 7.5h4l3 4.5M4 16.5h4l8-9h4" {...stroke(color)} />
    <Path d="m17.5 5 2.5 2.5-2.5 2.5M17.5 14l2.5 2.5-2.5 2.5" {...stroke(color, { strokeWidth: 1.6 })} />
  </I>
);

export const IconClock = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Circle cx={12} cy={12} r={8.5} {...stroke(color)} />
    <Path d="M12 7v5.2l3.4 2" {...stroke(color)} />
  </I>
);

export const IconSettings = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M4 7h9.6M18.4 7H20M4 12h1.6M10.4 12H20M4 17h7.6M16.4 17H20" {...stroke(color)} />
    <Circle cx={16} cy={7} r={2.4} {...stroke(color)} />
    <Circle cx={8} cy={12} r={2.4} {...stroke(color)} />
    <Circle cx={14} cy={17} r={2.4} {...stroke(color)} />
  </I>
);

export const IconPlaylist = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M4 6.5h12M4 11h12M4 15.5h7" {...stroke(color, { strokeWidth: 1.9 })} />
    <Path d="M14.5 13.8v6.4a.8.8 0 0 0 1.22.68l4.6-3.2a.8.8 0 0 0 0-1.36l-4.6-3.2a.8.8 0 0 0-1.22.68Z" fill={color} />
  </I>
);

export const IconShare = ({ size = 20, color }) => (
  <I size={size} color={color}>
    <Path d="M12 3.5v10M8.5 6.5 12 3l3.5 3.5" {...stroke(color)} />
    <Path d="M6 10.5H5a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 5 20.5h14a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1" {...stroke(color)} />
  </I>
);
