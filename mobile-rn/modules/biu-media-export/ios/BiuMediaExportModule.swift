import ExpoModulesCore
import AVFoundation

public class BiuMediaExportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BiuMediaExport")
    AsyncFunction("mux") { (video: String, audio: String, output: String) async throws in
      try await Self.mux(video, audio, output)
    }
  }
  private static func problem(_ text: String) -> NSError {
    NSError(domain: "BiuMediaExport", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
  }
  private static func mux(_ video: String, _ audio: String, _ output: String) async throws {
    guard let videoURL = URL(string: video), let audioURL = URL(string: audio),
      let outputURL = URL(string: output), videoURL.isFileURL, audioURL.isFileURL, outputURL.isFileURL
    else { throw problem("无效的本地视频文件") }
    let composition = AVMutableComposition()
    for (url, type) in [(videoURL, AVMediaType.video), (audioURL, AVMediaType.audio)] {
      let asset = AVURLAsset(url: url)
      guard let source = try await asset.loadTracks(withMediaType: type).first,
        let target = composition.addMutableTrack(withMediaType: type, preferredTrackID: kCMPersistentTrackID_Invalid)
      else { throw problem("下载文件缺少音画轨道") }
      let range = try await source.load(.timeRange)
      guard range.duration.isNumeric, range.duration > .zero else { throw problem("下载文件不完整") }
      try target.insertTimeRange(range, of: source, at: range.start)
      if type == .video { target.preferredTransform = try await source.load(.preferredTransform) }
    }
    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough)
    else { throw problem("无法合并当前视频编码") }
    exporter.outputURL = outputURL
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = true
    var success = false
    defer { if !success { try? FileManager.default.removeItem(at: outputURL) } }
    await exporter.export()
    guard exporter.status == .completed else { throw exporter.error ?? problem("视频合并失败") }
    success = true
  }
}
