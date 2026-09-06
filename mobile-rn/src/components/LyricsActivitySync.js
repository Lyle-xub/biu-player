import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { usePlayer } from '../player/PlayerContext';
import { trackKeyOf, segmentRange } from '../player/track';
import { loadTrackLyrics } from '../player/loadLyrics';
import { prepareSystemLyrics, systemLyricSlots } from '../player/systemLyrics';
import { LyricsLiveActivity, LyricsWidget } from '../widgets/LyricsWidgets';
import { extractCoverColor, setLyricsPiPEnabled, updateLyricsPiP } from 'biu-lyrics-pip';

const supported = Platform.OS === 'ios';
const defaultCoverColor = [9 / 255, 9 / 255, 11 / 255];
function artworkURL(value) {
  const url = String(value || '').trim();
  if (url.startsWith('//')) return `https:${url}`;
  return url.replace(/^http:/, 'https:');
}

export default function LyricsActivitySync() {
  const {
    current, position, playing, buffering, lyricSettings, seekRevision,
    desktopLyricsEnabled, lockScreenLyricsEnabled, dynamicIslandLyricsEnabled,
  } = usePlayer();
  const [lyricResult, setLyricResult] = useState({ key: null, lines: [] });
  const [activityRendererReady, setActivityRendererReady] = useState(!supported);
  const [coverColor, setCoverColor] = useState(defaultCoverColor);
  const lastWidgetPayload = useRef('');
  const activityQueue = useRef(Promise.resolve());
  const latestActivityPayload = useRef(null);
  const lastActivityInput = useRef(null);
  const key = trackKeyOf(current);
  const setting = lyricSettings[key];
  const lines = lyricResult.key === key ? lyricResult.lines : [];
  const lyricPosition = (Number(position) || 0) + (Number(setting?.offset) || 0);
  const needsLyrics = desktopLyricsEnabled || lockScreenLyricsEnabled || dynamicIslandLyricsEnabled;
  const needsActivity = lockScreenLyricsEnabled || dynamicIslandLyricsEnabled;

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    // ActivityKit outlives the JS process. End the previous playback session
    // before publishing this one, even when the renderer version is unchanged.
    activityQueue.current = Promise.resolve().then(async () => {
      await Promise.allSettled(LyricsLiveActivity.getInstances().map((instance) => instance.end('immediate')));
    }).catch(() => {}).then(() => {
      if (!cancelled) setActivityRendererReady(true);
    });
    return () => {
      cancelled = true;
      latestActivityPayload.current = null;
      setLyricsPiPEnabled(false);
      activityQueue.current = activityQueue.current.catch(() => {}).then(async () => {
        await Promise.allSettled(LyricsLiveActivity.getInstances().map((instance) => instance.end('immediate')));
      }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!supported || !needsLyrics) return undefined;
    let cancelled = false;
    setLyricResult({ key, lines: [] });
    loadTrackLyrics(current, setting).then((result) => {
      if (!cancelled) setLyricResult({ key, lines: result });
    }).catch(() => { if (!cancelled) setLyricResult({ key, lines: [] }); });
    return () => { cancelled = true; };
  }, [needsLyrics, key, current?.cid, setting?.lines]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setCoverColor(defaultCoverColor);
    const url = artworkURL(current?.pic);
    if (!supported || !url || !extractCoverColor) return undefined;
    extractCoverColor(url).then((value) => {
      if (!cancelled && Array.isArray(value)) setCoverColor(value);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [key, current?.pic]);

  const preparedLines = useMemo(() => prepareSystemLyrics(lines), [lines]);
  // Loading lyrics or updating settings must not stamp an old position as a
  // new audio sample; that makes every native clock correction jump backwards.
  const positionTimestamp = useMemo(() => Date.now() / 1000, [position, playing, buffering, seekRevision, key]);
  const { slots, activeSlot } = systemLyricSlots(preparedLines, lyricPosition);
  const slotKey = slots.map((line) => line?.id || '').join('|');
  // PiP receives JS clock corrections. ActivityKit receives a full timeline only
  // when its configuration changes, then follows native AVPlayer samples.
  const activityTick = Math.floor(lyricPosition);

  useEffect(() => {
    if (!supported || !activityRendererReady || !current) return;
    const line = slots[activeSlot];
    const nextLine = slots[1 - activeSlot];
    const base = {
      title: current.title || 'Biu Player',
      artist: current.up || '',
      artwork: current.pic || '',
      slots,
      activeSlot,
      currentLine: line?.text || '',
      nextLine: nextLine?.text || '',
      lineFrom: Number(line?.from) || 0,
      lineTo: Number(line?.to) || 0,
      position: lyricPosition,
      clockRevision: `${key}:${seekRevision || 0}:${Number(setting?.offset) || 0}`,
      updatedAt: positionTimestamp,
      playing: !!playing && !buffering,
      coverColor,
      highlightProgress: line && Number(line.to) > Number(line.from)
        ? Math.max(0, Math.min(1, (lyricPosition - Number(line.from)) / (Number(line.to) - Number(line.from))))
        : (line?.text ? 1 : 0),
    };

    if (desktopLyricsEnabled) {
      // Widget timelines are stored as a UserDefaults property list, not JSON.
      // Empty Monet slots contain null and must only go to ActivityKit / PiP.
      const snapshot = {
        title: base.title, artist: base.artist, currentLine: base.currentLine,
        nextLine: base.nextLine, playing: base.playing,
      };
      const serialized = JSON.stringify(snapshot);
      if (serialized !== lastWidgetPayload.current) {
        LyricsWidget.updateSnapshot(snapshot);
        lastWidgetPayload.current = serialized;
      }
      updateLyricsPiP(base);
      setLyricsPiPEnabled(true);
    }

    if (needsActivity) {
      const configuration = JSON.stringify([key, seekRevision, setting?.offset, playing, buffering,
        coverColor, lockScreenLyricsEnabled, dynamicIslandLyricsEnabled]);
      if (lastActivityInput.current?.configuration === configuration && lastActivityInput.current?.lines === preparedLines) return;
      lastActivityInput.current = { configuration, lines: preparedLines };
      const payload = {
        // Native-only data is stripped before submitting the small ActivityKit
        // snapshot. AVPlayer selects lines even when JS delivery is delayed.
        _timeline: preparedLines,
        _mediaKey: `${current.bvid || ''}:${current.cid || 0}`,
        _audioOffset: (Number(setting?.offset) || 0) - (segmentRange(current)?.from || 0),
        slots: base.slots,
        activeSlot: base.activeSlot,
        position: base.position,
        clockRevision: base.clockRevision,
        updatedAt: base.updatedAt,
        playing: base.playing,
        coverColor: base.coverColor,
        lockScreenLyrics: lockScreenLyricsEnabled,
        dynamicIslandLyrics: dynamicIslandLyricsEnabled,
      };
      latestActivityPayload.current = payload;
      // Serialize start/update/end. Disabling or unmounting during an in-flight
      // update cannot resurrect an activity, and slow updates skip obsolete ticks.
      activityQueue.current = activityQueue.current.catch(() => {}).then(async () => {
        if (latestActivityPayload.current !== payload) return;
        const instances = LyricsLiveActivity.getInstances();
        if (instances.length) {
          await instances[0].update(payload);
          await Promise.allSettled(instances.slice(1).map((instance) => instance.end('immediate')));
        } else {
          LyricsLiveActivity.start(payload, 'biu-player://lyrics');
        }
      }).catch(() => { lastActivityInput.current = null; });
    }
  }, [
    slotKey, activeSlot, activityRendererReady, activityTick, buffering, current, desktopLyricsEnabled, dynamicIslandLyricsEnabled,
    coverColor, lines, lockScreenLyricsEnabled, needsActivity, playing, seekRevision, setting?.offset,
  ]);

  useEffect(() => {
    if (!supported || desktopLyricsEnabled) return;
    lastWidgetPayload.current = '';
    setLyricsPiPEnabled(false);
    LyricsWidget.updateSnapshot({
      title: 'Biu Player', artist: '', currentLine: '桌面歌词已关闭', nextLine: '', playing: false,
    });
  }, [desktopLyricsEnabled]);

  useEffect(() => {
    if (!supported || (desktopLyricsEnabled && current)) return;
    setLyricsPiPEnabled(false);
  }, [current, desktopLyricsEnabled]);

  useEffect(() => {
    if (!supported || (needsActivity && current)) return;
    latestActivityPayload.current = null;
    lastActivityInput.current = null;
    activityQueue.current = activityQueue.current.catch(() => {}).then(async () => {
      await Promise.allSettled(LyricsLiveActivity.getInstances().map((instance) => instance.end('immediate')));
    }).catch(() => {});
  }, [current, needsActivity]);

  return null;
}
