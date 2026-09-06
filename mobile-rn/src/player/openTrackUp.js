export const canOpenTrackUp = (track) => track?.isSegment
  ? !!(track.parentMid || track.parentBvid || track.bvid)
  : !!(track?.up && (track.mid || track.bvid));

export async function openTrackUp(navigation, track, resolveTrackUp) {
  const mid = await resolveTrackUp(track);
  if (mid) navigation.navigate('Up', { mid });
}
