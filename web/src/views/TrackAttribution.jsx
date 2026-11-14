import React from 'react';
import { useTrackSource } from '../trackSource.js';

export function TrackAttribution({ track, artist = false }) {
  return <ResolvedTrackAttribution track={useTrackSource(track)} artist={artist} />;
}

export function ResolvedTrackAttribution({ track: t, artist = false }) {
  const source = t.isSegment && (artist ? t.parentUp : t.parentTitle);
  return <><span className="track-primary">{artist ? t.up : t.title}</span>{source ? (
    artist && t.parentMid ? <button type="button" className="track-source source-up"
      aria-label={`打开 ${source} 的 UP 主页`} onClick={event => {
        event.stopPropagation(); window.biuActions.openUpPage(t.parentMid);
      }}>· {source}</button> : <span className="track-source">· {source}</span>
  ) : null}</>;
}
