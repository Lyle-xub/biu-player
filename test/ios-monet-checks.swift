// Compiled together with BiuMonetLyrics.swift by the native lyric preview.
import UIKit

func runMonetChecks() {
  func frame(_ position: Double, _ stamp: Double, playing: Bool = true, revision: String = "track:0") -> BiuLyricsFrame {
    BiuLyricsFrame.decode("""
      {"position":\(position),"updatedAt":\(stamp),"playing":\(playing),"clockRevision":"\(revision)"}
      """)
  }
  func date(_ seconds: Double) -> Date { Date(timeIntervalSince1970: seconds) }
  var clock = BiuLyricsClock()
  clock.update(frame(2, 1000), at: date(1000))
  assert(abs(clock.time(at: date(1000.49)) - 2.49) < 0.0001)
  clock.update(frame(2.45, 1000.5), at: date(1000.5))
  assert(abs(clock.time(at: date(1000.5)) - 2.5) < 0.0001, "sample jitter cannot rewind the scan")
  clock.update(frame(2.45, 1000.5), at: date(1000.6))
  assert(abs(clock.time(at: date(1000.6)) - 2.6) < 0.0001, "re-publishing lyrics preserves the audio timestamp")
  clock.update(frame(2.6, 1000.6, playing: false), at: date(1000.6))
  assert(clock.time(at: date(1008)) == 2.6, "pause freezes the clock")
  clock.update(frame(0.2, 1008, revision: "track:1"), at: date(1008))
  assert(abs(clock.time(at: date(1008.1)) - 0.3) < 0.0001, "seek resets immediately")
  assert(abs(clock.time(at: date(1100)) - 92.2) < 0.0001,
    "the PiP display-link clock keeps moving between delayed background samples")

  let short = BiuMonetLine(id: "short", text: "好！", from: 0, to: 0.8, words: [[2, 0, 0.8]])
  let shortFrame = frame(0.1, 1000)
  assert(shortFrame.time(at: date(1005)) == 5.1,
    "a delayed ActivityKit update must catch up instead of freezing after 0.75 seconds")

  let line = BiuMonetLine(id: "punctuation", text: "“Hello, 世界！” — 横向滚动与光效同步",
    from: 0, to: 10, words: [[8, 0, 3], [15, 3, 6], [24, 6, 10]])
  let metrics = BiuMonetMetrics(line: line, fontSize: 44)
  assert(metrics.words.map(\.text).joined() == line.text)
  assert(metrics.words.allSatisfy(\.timed))
  var lastScroll: CGFloat = 0
  for step in 0...600 {
    let scroll = metrics.scroll(at: Double(step) / 60, viewport: 160)
    assert(scroll >= lastScroll - 0.001)
    assert(scroll - lastScroll < 10, "punctuation must not jump the scroll cursor")
    lastScroll = scroll
  }

  // A translated drawing must be pixel-identical to a crop of the full line:
  // catches masks or shadows accidentally using viewport/global coordinates.
  func render(width: CGFloat, shift: CGFloat) -> CGImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: CGSize(width: width, height: 150), format: format).image { renderer in
      UIColor.black.setFill()
      renderer.fill(CGRect(x: 0, y: 0, width: width, height: 150))
      metrics.draw(in: renderer.cgContext, origin: CGPoint(x: 24 - shift, y: 44), time: 7.5, focused: true)
    }.cgImage!
  }
  let full = render(width: 1600, shift: 0)
  let scrolled = render(width: 300, shift: 150)
  let fullData = full.dataProvider!.data!
  let scrolledData = scrolled.dataProvider!.data!
  let a = CFDataGetBytePtr(fullData)!
  let b = CFDataGetBytePtr(scrolledData)!
  var difference = 0
  for y in 10..<140 {
    for x in 20..<280 {
      for channel in 0..<4 {
        difference += abs(Int(a[y * full.bytesPerRow + (x + 150) * 4 + channel])
          - Int(b[y * scrolled.bytesPerRow + x * 4 + channel]))
      }
    }
  }
  assert(difference < 100, "glyph, scan and halo must translate together: \(difference)")

  let shortMetrics = BiuMonetMetrics(line: short, fontSize: 44)
  // Compare sampled values against Folia MonetWordSweep's smoothstep envelope.
  for step in 0...120 {
    let time = Double(step) / 60
    let peak = short.to * 1.18
    let tail = max(short.to, short.to + 1.05)
    let p = min(1, max(0, time <= peak ? time / peak
      : 1 - (time - peak) / max(0.18, tail - peak)))
    assert(abs(Double(shortMetrics.words[0].glow(at: time, lineEnd: short.to))
      - p * p * (3 - 2 * p) * 0.88) < 0.000001)
  }
  let cover = BiuLyricsFrame.decode("{\"coverColor\":[0.8,0.2,0.1]}")
  var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
  cover.backgroundColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
  assert(red > green && green > blue && red <= 0.26 && alpha == 1,
    "both system surfaces preserve the cover hue and readable background contrast")
  assert(shortMetrics.words[0].filledWidth(at: 0.2) > 0)
  assert(shortMetrics.words[0].filledWidth(at: 0.6) > shortMetrics.words[0].filledWidth(at: 0.2))
  assert(shortMetrics.words[0].glow(at: 0.6, lineEnd: short.to)
    > shortMetrics.words[0].glow(at: 0.2, lineEnd: short.to))

  let timed = BiuMonetLine(id: "timed", text: "光效", from: 0, to: 1,
    words: [[2, 0, 1, 0, 0.2, 0.8, 1]])
  let timedWord = BiuMonetMetrics(line: timed, fontSize: 44).words[0]
  assert(abs(timedWord.filledWidth(at: 0.5) - timedWord.offsets[1]) < 0.001,
    "Folia grapheme timing gaps must hold the scan at the measured glyph boundary")
  assert(timedWord.filledWidth(at: 0.9) > timedWord.offsets[1])
  print("MONET_CHECKS_PASSED: exact Folia timing, short lines, continuous clock, pause/seek, punctuation, translated glyph/halo pixels")
}
