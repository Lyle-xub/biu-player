import ExpoModulesCore
import ExpoWidgets
import AVKit
import AVFoundation
import CoreMedia
import CoreVideo
import CoreImage
import UIKit

public final class BiuLyricsPiPModule: Module {
  private let renderer = BiuLyricsPiPRenderer()

  public func definition() -> ModuleDefinition {
    Name("BiuLyricsPiP")

    OnDestroy {
      DispatchQueue.main.async { [renderer] in renderer.setEnabled(false) }
    }

    Function("setEnabled") { (enabled: Bool) in
      DispatchQueue.main.async { [weak renderer] in renderer?.setEnabled(enabled) }
    }

    Function("update") { (json: String) in
      DispatchQueue.main.async { [weak renderer] in renderer?.update(json) }
    }

    AsyncFunction("coverColor") { (url: URL, promise: Promise) in
      func resolve(_ data: Data?) {
        promise.resolve(data.flatMap(Self.coverAccent))
      }
      if url.isFileURL {
        resolve(try? Data(contentsOf: url))
        return
      }
      var request = URLRequest(url: url)
      request.setValue("https://www.bilibili.com/", forHTTPHeaderField: "Referer")
      URLSession.shared.dataTask(with: request) { data, _, _ in resolve(data) }.resume()
    }
  }

  private static func coverAccent(_ data: Data) -> [Double]? {
    guard let image = CIImage(data: data), !image.extent.isEmpty else { return nil }
    let size = 24
    let output = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
      .transformed(by: CGAffineTransform(scaleX: CGFloat(size) / image.extent.width, y: CGFloat(size) / image.extent.height))
    var rgba = [UInt8](repeating: 0, count: size * size * 4)
    rgba.withUnsafeMutableBytes { bytes in
      guard let address = bytes.baseAddress else { return }
      CIContext(options: [.workingColorSpace: NSNull()]).render(
        output, toBitmap: address, rowBytes: size * 4,
        bounds: CGRect(x: 0, y: 0, width: size, height: size),
        format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB()
      )
    }
    // Pick the strongest hue family instead of mixing complementary colors
    // into gray/brown. Ignore black/white borders and transparent artwork.
    var weights = [CGFloat](repeating: 0, count: 18)
    var colors = [[CGFloat]](repeating: [0, 0, 0], count: 18)
    for pixel in stride(from: 0, to: rgba.count, by: 4) where rgba[pixel + 3] > 240 {
      let rgb = (0..<3).map { CGFloat(rgba[pixel + $0]) / 255 }
      var hue: CGFloat = 0, saturation: CGFloat = 0, brightness: CGFloat = 0
      UIColor(red: rgb[0], green: rgb[1], blue: rgb[2], alpha: 1)
        .getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: nil)
      guard saturation > 0.18, brightness > 0.16 else { continue }
      let bucket = min(17, Int(hue * 18))
      let weight = saturation * min(1, brightness * 2)
      weights[bucket] += weight
      for channel in 0..<3 { colors[bucket][channel] += rgb[channel] * weight }
    }
    guard let index = weights.indices.max(by: { weights[$0] < weights[$1] }), weights[index] > 2 else {
      return [0.35, 0.36, 0.40]
    }
    return colors[index].map { Double($0 / weights[index]) }
  }
}

private final class BiuLyricsPiPRenderer: NSObject,
  AVPictureInPictureControllerDelegate,
  AVPictureInPictureSampleBufferPlaybackDelegate {
  private let width = 900
  private let height = 200
  private let displayLayer = AVSampleBufferDisplayLayer()
  private var controller: AVPictureInPictureController?
  private weak var hostView: UIView?
  private var displayLink: CADisplayLink?
  private var frameNumber: Int64 = 0
  private var enabled = false
  private var retryStart = false
  private var retryCount = 0
  private var payload = BiuLyricsFrame.decode("{}")
  private var metrics: [BiuMonetMetrics?] = [nil, nil]
  private var clock = BiuLyricsClock()

  override init() {
    super.init()
    NotificationCenter.default.addObserver(self, selector: #selector(shutDown),
      name: UIApplication.willTerminateNotification, object: nil)
  }

  deinit { NotificationCenter.default.removeObserver(self) }

  @objc private func shutDown() { setEnabled(false) }

  func setEnabled(_ value: Bool) {
    guard value != enabled else { return }
    enabled = value
    if value {
      guard AVPictureInPictureController.isPictureInPictureSupported() else { return }
      retryCount = 0
      configureIfNeeded()
      renderFrame()
      startIfPossible()
    } else {
      retryStart = false
      controller?.stopPictureInPicture()
      stopClock()
    }
  }

  func update(_ json: String) {
    let next = BiuLyricsFrame.decode(json)
    clock.update(next, at: Date())
    for slot in 0..<2 {
      if next.line(slot) != payload.line(slot) {
        metrics[slot] = next.line(slot).map { BiuMonetMetrics(line: $0, fontSize: 44) }
      }
    }
    payload = next
    guard enabled, AVPictureInPictureController.isPictureInPictureSupported() else { return }
    configureIfNeeded()
    renderFrame()
    startClock()
    startIfPossible()
  }

  private func configureIfNeeded() {
    guard controller == nil else { return }
    displayLayer.videoGravity = .resizeAspect
    displayLayer.backgroundColor = BiuMonetPalette.background.cgColor
    displayLayer.frame = CGRect(x: 0, y: 0, width: width, height: height)

    if let window = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap({ $0.windows })
      .first(where: { $0.isKeyWindow }) {
      let host = UIView(frame: CGRect(x: 0, y: 0, width: 3, height: 1))
      host.alpha = 0.01
      host.isUserInteractionEnabled = false
      host.clipsToBounds = true
      window.addSubview(host)
      displayLayer.frame = host.bounds
      host.layer.addSublayer(displayLayer)
      hostView = host
    }

    let source = AVPictureInPictureController.ContentSource(
      sampleBufferDisplayLayer: displayLayer,
      playbackDelegate: self
    )
    let pip = AVPictureInPictureController(contentSource: source)
    pip.delegate = self
    pip.requiresLinearPlayback = true
    pip.canStartPictureInPictureAutomaticallyFromInline = true
    controller = pip
  }

  private func startIfPossible() {
    guard enabled, let controller, !controller.isPictureInPictureActive else { return }
    if controller.isPictureInPicturePossible {
      retryStart = false
      retryCount = 0
      controller.startPictureInPicture()
      startClock()
    } else if !retryStart && retryCount < 8 {
      retryStart = true
      retryCount += 1
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
        self?.retryStart = false
        self?.startIfPossible()
      }
    }
  }

  private func startClock() {
    guard enabled, displayLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(tick))
    link.preferredFramesPerSecond = 30
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func stopClock() {
    displayLink?.invalidate()
    displayLink = nil
  }

  @objc private func tick() {
    guard enabled else { stopClock(); return }
    renderFrame()
  }

  private func renderFrame() {
    guard let pixelBuffer = makePixelBuffer() else { return }
    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
    guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }
    let rowBytes = CVPixelBufferGetBytesPerRow(pixelBuffer)
    guard let context = CGContext(
      data: base,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: rowBytes,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
    ) else { return }

    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    UIGraphicsPushContext(context)
    drawLyrics(in: context)
    UIGraphicsPopContext()

    var format: CMVideoFormatDescription?
    guard CMVideoFormatDescriptionCreateForImageBuffer(
      allocator: kCFAllocatorDefault,
      imageBuffer: pixelBuffer,
      formatDescriptionOut: &format
    ) == noErr, let format else { return }
    var timing = CMSampleTimingInfo(
      duration: CMTime(value: 1, timescale: 30),
      presentationTimeStamp: CMTime(value: frameNumber, timescale: 30),
      decodeTimeStamp: .invalid
    )
    frameNumber += 1
    var sample: CMSampleBuffer?
    guard CMSampleBufferCreateReadyWithImageBuffer(
      allocator: kCFAllocatorDefault,
      imageBuffer: pixelBuffer,
      formatDescription: format,
      sampleTiming: &timing,
      sampleBufferOut: &sample
    ) == noErr, let sample else { return }
    if displayLayer.status == .failed { displayLayer.flush() }
    displayLayer.enqueue(sample)
  }

  private func makePixelBuffer() -> CVPixelBuffer? {
    let attributes: [CFString: Any] = [
      kCVPixelBufferCGImageCompatibilityKey: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey: true,
      kCVPixelBufferIOSurfacePropertiesKey: [:]
    ]
    var buffer: CVPixelBuffer?
    CVPixelBufferCreate(
      kCFAllocatorDefault,
      width,
      height,
      kCVPixelFormatType_32BGRA,
      attributes as CFDictionary,
      &buffer
    )
    return buffer
  }

  private func drawLyrics(in context: CGContext) {
    let date = Date()
    let time = clock.time(at: date)
    let focus = payload.activeSlot ?? 0
    var hue: CGFloat = 0, saturation: CGFloat = 0
    payload.backgroundColor.getHue(&hue, saturation: &saturation, brightness: nil, alpha: nil)
    // Mostly neutral charcoal, with cover color confined to soft light pools.
    // This keeps pale, highly saturated and skin-tone covers equally readable.
    UIColor(hue: hue, saturation: min(0.18, saturation * 0.25), brightness: 0.095, alpha: 1).setFill()
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let drift = CGFloat(sin(time / 18))
    let glowCenter = CGPoint(x: CGFloat(width) * (0.28 + 0.08 * drift), y: 0)
    let tint = UIColor(hue: hue, saturation: min(0.48, saturation * 0.65), brightness: 0.46, alpha: 0.27)
    if let glow = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [
      tint.cgColor, tint.withAlphaComponent(0).cgColor
    ] as CFArray, locations: [0, 1]) {
      context.drawRadialGradient(glow, startCenter: glowCenter, startRadius: 0,
        endCenter: glowCenter, endRadius: CGFloat(width) * 0.58, options: [])
    }
    // Fixed, equal-size rows; a line change is an immediate replacement.
    for slot in 0..<2 {
      if let current = metrics[slot] {
        drawSlot(current, slot: slot, time: time, focused: focus == slot, in: context)
      }
    }
    // PiP adds its own rounded mask. Keep the entire rim inside that mask,
    // and paint it after lyric halos so they cannot wash out parts of it.
    context.saveGState()
    let rim = CGRect(x: 14, y: 14, width: CGFloat(width) - 28, height: CGFloat(height) - 28)
    context.addPath(CGPath(roundedRect: rim, cornerWidth: 64, cornerHeight: 64, transform: nil))
    context.setLineWidth(2.5)
    context.replacePathWithStrokedPath()
    context.clip()
    if let highlight = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [
      UIColor.white.withAlphaComponent(0.30).cgColor,
      UIColor.white.withAlphaComponent(0.14).cgColor
    ] as CFArray, locations: [0, 1]) {
      context.drawLinearGradient(highlight, start: .zero,
        end: CGPoint(x: width, y: height), options: [])
    }
    context.restoreGState()
  }

  private func drawSlot(_ metrics: BiuMonetMetrics, slot: Int, time: Double, focused: Bool,
                        in context: CGContext) {
    let viewport = CGFloat(width) - 88
    let renderTime = focused ? time : min(time, metrics.line.from)
    let scroll = metrics.scroll(at: renderTime, viewport: viewport)
    let x = 44 + max(0, (viewport - metrics.width) / 2) - scroll
    let y = CGFloat(slot == 0 ? 44 : 102)
    context.saveGState()
    context.clip(to: CGRect(x: 30, y: 0, width: CGFloat(width) - 60, height: CGFloat(height)))
    context.setAlpha(focused ? 1 : 0.72)
    context.translateBy(x: x, y: y)
    metrics.draw(in: context, origin: .zero, time: renderTime, focused: focused)
    context.restoreGState()
  }

  func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
    startClock()
  }

  func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
    if !enabled { stopClock() }
  }

  func pictureInPictureController(
    _ pictureInPictureController: AVPictureInPictureController,
    failedToStartPictureInPictureWithError error: Error
  ) {
    retryStart = false
  }

  func pictureInPictureController(
    _ pictureInPictureController: AVPictureInPictureController,
    setPlaying playing: Bool
  ) {
    // PiP only presents lyrics; its clock follows the audio payload.
    // Do not create a second, independent playback state here.
  }

  func pictureInPictureControllerTimeRangeForPlayback(
    _ pictureInPictureController: AVPictureInPictureController
  ) -> CMTimeRange {
    CMTimeRange(start: .zero, duration: .positiveInfinity)
  }

  func pictureInPictureControllerIsPlaybackPaused(
    _ pictureInPictureController: AVPictureInPictureController
  ) -> Bool { payload.playing != true }

  func pictureInPictureController(
    _ pictureInPictureController: AVPictureInPictureController,
    didTransitionToRenderSize newRenderSize: CMVideoDimensions
  ) {
    renderFrame()
  }

  func pictureInPictureController(
    _ pictureInPictureController: AVPictureInPictureController,
    skipByInterval skipInterval: CMTime,
    completion completionHandler: @escaping () -> Void
  ) {
    completionHandler()
  }
}
