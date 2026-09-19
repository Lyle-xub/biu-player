const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('iOS native interruption resumes only the intended current item, never a preload or explicit pause', { skip: process.platform !== 'darwin' }, () => {
  const source = fs.readFileSync(path.join(__dirname, '../mobile-rn/node_modules/expo-video/ios/VideoPlayer.swift'), 'utf8');
  const start = source.indexOf('  private var playbackRequested = false');
  const end = source.indexOf('  private(set) var isPlaying = false', start);
  assert.ok(start > 0 && end > start);
  const harness = `import Foundation
class VideoManager { static let shared = VideoManager(); func onPlaybackRequested() {} }
class AVPlayerItem { enum Status { case readyToPlay, failed }; var status = Status.readyToPlay }
class FakePlayer {
  var currentItem: AVPlayerItem? = AVPlayerItem()
  var rate: Float = 0
  var plays = 0
  func play() { rate = 1; plays += 1 }
  func pause() { rate = 0 }
}
class Player {
  let ref = FakePlayer()
  var showNowPlayingNotification = true
  var staysActiveInBackground = true
  var isMuted = false
${source.slice(start, end)}
}
let p = Player()
p.playWithIntent(); p.beginAudioInterruption()
precondition(p.ref.rate == 0 && p.canResumeAfterInterruption)
p.resumeAfterInterruption()
precondition(p.ref.rate == 1 && p.ref.plays == 2)
p.resumeAfterInterruption()
precondition(p.ref.plays == 2, "one resume per interruption")
p.beginAudioInterruption(); p.pauseWithIntent(); p.resumeAfterInterruption()
precondition(p.ref.rate == 0 && p.ref.plays == 2, "explicit pause wins over late resume")
p.beginAudioInterruption(); p.resumeAfterInterruption()
precondition(p.ref.plays == 2, "already paused music never resumes")
p.playWithIntent(); p.beginAudioInterruption(); p.ref.currentItem = AVPlayerItem(); p.resumeAfterInterruption()
precondition(p.ref.rate == 0, "source change invalidates the ticket")
p.playWithIntent(); p.beginAudioInterruption(); p.ref.currentItem?.status = .failed; p.resumeAfterInterruption()
precondition(p.ref.rate == 0, "failed item does not retry blindly")
p.ref.currentItem = AVPlayerItem(); p.playWithIntent(); p.beginAudioInterruption(); p.cancelInterruptionResume(); p.resumeAfterInterruption()
precondition(p.ref.rate == 0, "system veto and remote next cancel the ticket")
let preload = Player(); preload.showNowPlayingNotification = false; preload.playWithIntent(); preload.beginAudioInterruption()
precondition(!preload.canResumeAfterInterruption)
let muted = Player(); muted.isMuted = true; muted.playWithIntent(); muted.beginAudioInterruption()
precondition(!muted.canResumeAfterInterruption)
let retired = Player(); retired.playWithIntent(); retired.beginAudioInterruption(); retired.showNowPlayingNotification = false
retired.resumeAfterInterruption(); precondition(retired.ref.rate == 0)
print("native interruption checks passed")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-interruption-'));
  try {
    const file = path.join(dir, 'Checks.swift'), bin = path.join(dir, 'checks');
    fs.writeFileSync(file, harness);
    execFileSync('xcrun', ['swiftc', file, '-o', bin], { timeout: 60000 });
    assert.match(execFileSync(bin, { encoding: 'utf8' }), /checks passed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
