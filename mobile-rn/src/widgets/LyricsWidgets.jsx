import React from 'react';
import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  activityBackgroundTint, background, containerBackground, font, foregroundStyle,
  frame, lineLimit, opacity, padding, strokeBorder,
} from '@expo/ui/swift-ui/modifiers';
import { shapes } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, createWidget } from 'expo-widgets';

const LyricsWidgetView = (props) => {
  'widget';
  return (
    <VStack alignment="leading" spacing={7} modifiers={[
      frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'leading' }),
      padding({ all: 15 }),
      containerBackground('#20251d', 'widget'),
    ]}>
      <HStack spacing={7}>
        <Image systemName="music.note" color="#fb7299" />
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle('#f7f8f4'), lineLimit(1)]}>
          {props.title || 'Biu Player'}
        </Text>
        <Spacer />
        <Text modifiers={[font({ size: 10 }), foregroundStyle('#bec1b9'), lineLimit(1)]}>{props.artist || ''}</Text>
      </HStack>
      <Text modifiers={[font({ size: 19, weight: 'bold', design: 'rounded' }), foregroundStyle('#ffffff'), lineLimit(2)]}>
        {props.currentLine || '纯音乐 / 暂无歌词'}
      </Text>
      {props.nextLine ? (
        <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle('#bdc0b8'), lineLimit(1), opacity(0.75)]}>
          {props.nextLine}
        </Text>
      ) : null}
    </VStack>
  );
};

const LyricsActivityView = (props) => {
  'widget';
  const panel = {
    type: 'linearGradient',
    colors: ['#34392f', '#20241d', '#151812'],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  };
  const lockLine = props.lockScreenLyrics === false ? '正在播放' : (props.currentLine || '纯音乐 / 暂无歌词');
  const islandLine = props.dynamicIslandLyrics === false ? (props.title || 'Biu Player') : (props.currentLine || '纯音乐');
  const islandNextLine = props.dynamicIslandLyrics === false ? '正在播放' : (props.nextLine || islandLine);
  return {
    banner: (
      <VStack alignment="leading" spacing={7} modifiers={[
        frame({ maxWidth: Infinity, minHeight: 94, alignment: 'leading' }),
        padding({ all: 15 }),
        background(panel, shapes.roundedRectangle({ cornerRadius: 20 })),
        activityBackgroundTint('#20241d'),
        strokeBorder({ color: '#596050', width: 1, shape: 'roundedRectangle', cornerRadius: 20 }),
      ]}>
        <HStack spacing={7}>
          <Image systemName="music.note" color="#fb7299" />
          <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle('#f7f8f4'), lineLimit(1)]}>
            {props.title || 'Biu Player'}
          </Text>
          <Spacer />
          <Text modifiers={[font({ size: 10 }), foregroundStyle('#bec1b9'), lineLimit(1)]}>{props.artist || ''}</Text>
        </HStack>
        <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <Text modifiers={[font({ size: 19, weight: 'bold', design: 'rounded' }), foregroundStyle('#ffffff'), lineLimit(2)]}>
            {lockLine}
          </Text>
          {props.lockScreenLyrics !== false && props.nextLine ? (
            <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle('#bdc0b8'), lineLimit(1), opacity(0.76)]}>
              {props.nextLine}
            </Text>
          ) : null}
        </VStack>
      </VStack>
    ),
    bannerSmall: (
      <VStack alignment="leading" spacing={4} modifiers={[
        frame({ maxWidth: Infinity, minHeight: 58, alignment: 'leading' }),
        padding({ all: 10 }), background('#20241d'), activityBackgroundTint('#20241d'),
      ]}>
        <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle('#fb7299'), lineLimit(1)]}>
          {props.title || 'Biu Player'}
        </Text>
        <Text modifiers={[font({ size: 15, weight: 'bold', design: 'rounded' }), foregroundStyle('#ffffff'), lineLimit(1)]}>
          {lockLine}
        </Text>
      </VStack>
    ),
    compactLeading: (
      <Text modifiers={[font({ size: 10, weight: 'bold' }), foregroundStyle('#ffffff'), lineLimit(1)]}>
        {islandLine}
      </Text>
    ),
    compactTrailing: (
      <Text modifiers={[font({ size: 10, weight: 'semibold' }), foregroundStyle('#d7d8d4'), lineLimit(1)]}>
        {islandNextLine}
      </Text>
    ),
    minimal: (
      <Text modifiers={[font({ size: 9, weight: 'bold' }), foregroundStyle('#ffffff'), lineLimit(1)]}>{islandLine}</Text>
    ),
    expandedLeading: (
      <Text modifiers={[font({ size: 14, weight: 'bold', design: 'rounded' }), foregroundStyle('#ffffff'), lineLimit(1), padding({ leading: 8, top: 7 })]}>
        {islandLine}
      </Text>
    ),
    expandedTrailing: (
      <Text modifiers={[font({ size: 13, weight: 'semibold', design: 'rounded' }), foregroundStyle('#d7d8d4'), lineLimit(1), padding({ trailing: 8, top: 7 })]}>
        {islandNextLine}
      </Text>
    ),
    expandedBottom: (
      <VStack spacing={3} alignment="leading" modifiers={[padding({ horizontal: 10, bottom: 8 })]}>
        {props.dynamicIslandLyrics !== false ? (
          <Text modifiers={[font({ size: 12 }), foregroundStyle('#bdc0b8'), lineLimit(1)]}>{props.nextLine || ''}</Text>
        ) : null}
        <Text modifiers={[font({ size: 10, weight: 'medium' }), foregroundStyle('#fb7299'), lineLimit(1)]}>
          {props.title || 'Biu Player'} · {props.artist || ''}
        </Text>
      </VStack>
    ),
  };
};

export const LyricsWidget = createWidget('LyricsWidget', LyricsWidgetView);
export const LyricsLiveActivity = createLiveActivity('LyricsLiveActivity', LyricsActivityView);
