const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Execute the production clock on the host with an in-memory ActivityKit sink.
// No simulator, app launch, audio playback or system UI is involved.
test('native lyrics advance without JS, honor seeks/offsets, coalesce updates and stop', { skip: process.platform !== 'darwin' }, () => {
  const source = fs.readFileSync(path.join(__dirname, '../mobile-rn/node_modules/expo-widgets/ios/LiveActivity.swift'), 'utf8');
  const driver = source.slice(source.indexOf('@available(iOS 16.2, *)\n@MainActor\nfinal class BiuLyricsActivityClock'));
  assert.ok(driver.startsWith('@available'));
  const metadata = fs.readFileSync(path.join(__dirname, '../mobile-rn/node_modules/expo-video/ios/Records/VideoMetadata.swift'), 'utf8');
  const playbackWindow = metadata.slice(metadata.indexOf('struct BiuPlaybackWindow {'));
  assert.ok(playbackWindow.startsWith('struct BiuPlaybackWindow'));
  const model = fs.readFileSync(path.join(__dirname, '../mobile-rn/node_modules/expo-widgets/ios/Widgets/BiuMonetLyrics.swift'), 'utf8');
  const pagination = model.slice(model.indexOf('struct BiuLyricPage {'), model.indexOf('public struct BiuMonetLine'));
  assert.ok(pagination.startsWith('struct BiuLyricPage'));
  const harness = `import Foundation
struct LiveActivityAttributes {
  struct ContentState { var name: String; var props: String }
}
struct ActivityContent<T> { var state: T; var staleDate: Date? }
enum ActivityState { case active, stale }
@MainActor var received: [[String: Any]] = []
struct Activity<T> {
  var id: String { "test" }
  var activityState: ActivityState { .active }
  static var activities: [Activity<T>] { [Self()] }
  @MainActor func update(_ content: ActivityContent<LiveActivityAttributes.ContentState>) async {
    received.append(try! JSONSerialization.jsonObject(with: Data(content.state.props.utf8)) as! [String: Any])
    try? await Task.sleep(nanoseconds: 20_000_000)
  }
}
${driver}
${playbackWindow}
${pagination}
@main struct Checks {
  @MainActor static func settle() async { try? await Task.sleep(nanoseconds: 70_000_000) }
  @MainActor static func tick(_ position: Double, _ date: Double, _ playing: Bool = true, key: String = "BV:1") {
    NotificationCenter.default.post(name: Notification.Name("BiuPlayerPlaybackClock"), object: nil,
      userInfo: ["mediaKey": key, "position": position, "updatedAt": date, "playing": playing])
  }
  @MainActor static func main() async {
    let measure: (String) -> Double = { Double($0.count) }
    let pages = biuLyricPages("one two six ten red end", viewport: 16, measure: measure)
    precondition(pages[0].text == "one two six ten ")
    precondition(abs(pages[0].advance * 23 - 12) < 0.000001, "advance at the word ending near three quarters of the viewport")
    precondition(pages[1].text == "ten red end", "carry the unsung last quarter into the next page")
    precondition(biuLyricPageIndex(pages, progress: pages[0].advance - 0.00001) == 0)
    precondition(biuLyricPageIndex(pages, progress: pages[0].advance) == 1)
    precondition(biuLyricPageIndex(pages, progress: 1) == pages.count - 1)
    precondition(biuLyricPageIndex(pages, progress: 0) == 0, "seek back restores the first page")
    let cjk = biuLyricPages("今天我们一起走过美丽的城市", viewport: 6, measure: measure)
    precondition(cjk.count > 1 && cjk.last!.text.hasSuffix("城市"))
    precondition(cjk.allSatisfy { $0.to > $0.from && $0.advance > $0.from })
    let short = biuLyricPages("短句！", viewport: 20, measure: measure)
    precondition(short.count == 1 && short[0].advance == 1)
    let segment = BiuPlaybackWindow(sourceDuration: 400, segmentStart: 20, segmentEnd: 40)
    precondition(segment.duration == 20 && segment.elapsed(25) == 5, "publish song duration and elapsed, not source duration")
    precondition(segment.elapsed(0) == 0 && segment.elapsed(100) == 20)
    precondition(segment.sourceTime(5) == 25 && segment.sourceTime(-8) == 20 && segment.sourceTime(100) == 40,
      "system seeking converts back to source time and stays within the segment")
    let next = BiuPlaybackWindow(sourceDuration: 400, segmentStart: 40, segmentEnd: 70)
    precondition(next.duration == 30 && next.elapsed(45) == 5 && next.sourceTime(5) == 45,
      "same-video segment switches use the new range")
    let whole = BiuPlaybackWindow(sourceDuration: 400, segmentStart: nil, segmentEnd: nil)
    precondition(whole.duration == 400 && whole.elapsed(25) == 25 && whole.sourceTime(5) == 5)
    let loading = BiuPlaybackWindow(sourceDuration: .nan, segmentStart: 20, segmentEnd: 40)
    precondition(loading.duration == 20 && loading.elapsed(.nan) == 0)
    precondition(BiuPlaybackWindow(sourceDuration: 35, segmentStart: 20, segmentEnd: 40).duration == 15)
    precondition(BiuPlaybackWindow(sourceDuration: 400, segmentStart: 40, segmentEnd: 20).duration == 400)
    let live = BiuPlaybackWindow(sourceDuration: .infinity, segmentStart: nil, segmentEnd: nil)
    precondition(live.duration == nil && live.elapsed(25) == 25)
    let clock = BiuLyricsActivityClock.shared
    let lines: [[String: Any]] = (0..<40).map { i in
      ["id": "\\(i)", "text": "歌词\\(i)", "from": Double(i * 10), "to": Double(i * 10 + 8), "words": []]
    }
    let config: [String: Any] = ["_timeline": lines, "_mediaKey": "BV:1", "_audioOffset": -20.0,
      "clockRevision": "song:0", "position": 0.0, "updatedAt": 100.0, "playing": true]
    let props = String(data: try! JSONSerialization.data(withJSONObject: config), encoding: .utf8)!
    let clean = BiuLyricsActivityClock.snapshot(props)
    precondition(!clean.contains("_timeline") && !clean.contains("_mediaKey") && !clean.contains("_audioOffset"))
    clock.configure(id: "test", props: props)
    await settle()
    tick(25, 100)
    await settle()
    precondition(received.last!["position"] as! Double == 5, "segment offset")
    precondition(received.last!["activeSlot"] as! Int == 0)
    precondition(received.last!["previousLyric"] == nil, "first line has no preceding lyric")
    let anchor = received.last!["clockAnchor"] as! Double
    let count = received.count
    tick(25.25, 100.25)
    await settle()
    precondition(received.count == count, "throttle ordinary native samples")
    tick(26, 101)
    await settle()
    precondition(received.count == count, "short-line timer needs no one-second updates")
    tick(31, 106)
    await settle()
    precondition(received.last!["activeSlot"] as! Int == 1, "next line without JS")
    precondition(received.last!["clockAnchor"] as! Double == anchor, "line changes retain the same system timer anchor")
    let slots = received.last!["slots"] as! [[String: Any]]
    precondition(slots[0]["id"] as! String == "2" && slots[1]["id"] as! String == "1")
    precondition(received.last!["previousLyric"] as! String == "歌词0", "expanded lyrics include the previous line in chronological order")
    tick(31, 106.1, false)
    await settle()
    precondition(received.last!["playing"] as! Bool == false, "pause immediately")
    let revision = received.last!["clockRevision"] as! String
    tick(21, 106.2, false)
    await settle()
    precondition(received.last!["clockRevision"] as! String != revision, "paused remote seek resets animation")
    precondition(received.last!["previousLyric"] == nil, "seeking to the first line clears old expanded context")
    let beforeWrongTrack = received.count
    tick(200, 107, key: "other:2")
    await settle()
    precondition(received.count == beforeWrongTrack)
    tick(32, 108)
    await Task.yield()
    for i in 0..<15 { tick(Double(33 + i * 3), Double(109 + i)) }
    await settle()
    precondition(received.last!["position"] as! Double == 55, "latest pending snapshot wins")
    precondition(received.count <= beforeWrongTrack + 2, "slow ActivityKit cannot accumulate old ticks")
    precondition(received.allSatisfy { $0["_timeline"] == nil })
    clock.stop(id: "test")
    let stoppedCount = received.count
    tick(80, 200)
    await settle()
    precondition(received.count == stoppedCount, "stop cannot resurrect activity")
    var future = config
    future["_audioOffset"] = 0.0
    future["_timeline"] = [["id": "future", "text": "未开唱", "from": 3.0, "to": 7.0, "words": []]]
    clock.configure(id: "test", props: String(data: try! JSONSerialization.data(withJSONObject: future), encoding: .utf8)!)
    await settle()
    tick(0, 300)
    await settle()
    let waitingCount = received.count
    tick(2, 302)
    await settle()
    precondition(received.count == waitingCount, "a future short line remains unlit without animation updates")
    tick(3, 303)
    await settle()
    precondition(received.count == waitingCount + 1 && received.last!["position"] as! Double == 3,
      "first lyric onset must publish even though the active slot did not change")
    clock.stop()
    future["_timeline"] = [["id": "long", "text": "这是一句需要横向滚动的歌词", "from": 0.0, "to": 8.0, "words": []]]
    clock.configure(id: "test", props: String(data: try! JSONSerialization.data(withJSONObject: future), encoding: .utf8)!)
    await settle()
    tick(0, 400)
    await settle()
    let pageCount = received.count
    tick(0.25, 400.25)
    await settle()
    precondition(received.count == pageCount, "coalesce position samples between page refreshes")
    tick(0.5, 400.5)
    await settle()
    precondition(received.count == pageCount + 1, "long lyrics receive progress to advance their visible page")
    precondition(received.last!["scrollToEnd"] == nil && received.last!["scrollDuration"] == nil,
      "page snapshots contain no movement animation targets")
    tick(11, 411)
    await settle()
    precondition(received.last!["position"] as! Double == 11,
      "a delayed sample crossing the lyric end must publish the final scroll position")
    let finishedCount = received.count
    tick(12, 412)
    await settle()
    precondition(received.count == finishedCount, "completed lyrics hold still during the instrumental gap")
    clock.stop()
    print("native lyric clock checks passed")
  }
}
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-lyric-clock-'));
  try {
    const file = path.join(dir, 'checks.swift'), binary = path.join(dir, 'checks');
    fs.writeFileSync(file, harness);
    execFileSync('xcrun', ['swiftc', '-parse-as-library', file, '-o', binary], { timeout: 60000 });
    assert.match(execFileSync(binary, [], { encoding: 'utf8', timeout: 10000 }), /checks passed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
