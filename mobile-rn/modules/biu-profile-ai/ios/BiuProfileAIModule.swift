import ExpoModulesCore
import onnxruntime_objc
import CryptoKit
import UIKit
import ImageIO

public final class BiuProfileAIModule: Module {
  private let queue = DispatchQueue(label: "biu.profile-ai", qos: .utility)
  private var env: ORTEnv?
  private var session: ORTSession?
  private var loaded = ""
  private func allowed() -> Bool {
    let p = ProcessInfo.processInfo
    return !p.isLowPowerModeEnabled && p.thermalState != .serious && p.thermalState != .critical
  }
  private func url(_ value: String) throws -> URL {
    guard let url = URL(string: value), url.isFileURL else { throw NSError(domain:"BiuAI",code:1) }
    return url
  }
  public func definition() -> ModuleDefinition {
    Name("BiuProfileAI")
    AsyncFunction("available") { self.allowed() }.runOnQueue(queue)
    AsyncFunction("release") { self.session = nil; self.loaded = "" }.runOnQueue(queue)
    AsyncFunction("trimCache") { (uri: String, limit: Int) throws in
      guard (0...2000).contains(limit) else { throw NSError(domain:"缓存容量无效",code:6) }
      let files = try FileManager.default.contentsOfDirectory(at:self.url(uri),includingPropertiesForKeys:[.contentModificationDateKey,.isRegularFileKey])
      let entries = files.compactMap { file -> (URL,Date)? in
        guard file.pathExtension == "json", let values = try? file.resourceValues(forKeys:[.contentModificationDateKey,.isRegularFileKey]), values.isRegularFile == true else { return nil }
        return (file,values.contentModificationDate ?? .distantPast)
      }.sorted { $0.1 < $1.1 }
      for entry in entries.prefix(max(0,entries.count-limit)) { try FileManager.default.removeItem(at:entry.0) }
    }.runOnQueue(queue)
    AsyncFunction("hashFile") { (uri: String) throws -> String in
      let handle = try FileHandle(forReadingFrom: self.url(uri)); defer { try? handle.close() }
      var hash = SHA256()
      while let data = try handle.read(upToCount:65536), !data.isEmpty { hash.update(data:data) }
      return hash.finalize().map { String(format:"%02x",$0) }.joined()
    }.runOnQueue(queue)
    AsyncFunction("encode") { (kind: String, model: String, payload: String) throws -> String in
      guard self.allowed(), ["text","image"].contains(kind) else { throw NSError(domain:"设备繁忙，已暂停本地分析",code:2) }
      if self.loaded != model {
        self.session = nil; self.loaded = ""
        if self.env == nil { self.env = try ORTEnv(loggingLevel:.warning) }
        let options = try ORTSessionOptions(); try options.setIntraOpNumThreads(1)
        self.session = try ORTSession(env:self.env!,modelPath:self.url(model).path,sessionOptions:options)
        self.loaded = model
      }
      let active = self.session!
      var inputs = [String:ORTValue]()
      if kind == "text" {
        let ids = try JSONDecoder().decode([Int64].self,from:Data(payload.utf8))
        guard ids.count >= 2 && ids.count <= 128 else { throw NSError(domain:"输入过长",code:3) }
        for name in try active.inputNames() {
          let values = name == "input_ids" ? ids : Array(repeating:Int64(name == "attention_mask" ? 1 : 0),count:ids.count)
          let data = values.withUnsafeBytes { NSMutableData(bytes:$0.baseAddress!,length:$0.count) }
          inputs[name] = try ORTValue(tensorData:data,elementType:.int64,shape:[1,NSNumber(value:ids.count)])
        }
      } else {
        let imageURL = try self.url(payload)
        guard let source = CGImageSourceCreateWithURL(imageURL as CFURL,nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceThumbnailMaxPixelSize:1024,kCGImageSourceCreateThumbnailWithTransform:true] as CFDictionary) else { throw NSError(domain:"封面无效",code:4) }
        let side = min(image.width,image.height)
        guard let cropped = image.cropping(to:CGRect(x:(image.width-side)/2,y:(image.height-side)/2,width:side,height:side)) else { throw NSError(domain:"封面无效",code:4) }
        var bytes = [UInt8](repeating:0,count:256*256*4)
        try bytes.withUnsafeMutableBytes { raw in
          guard let context = CGContext(data:raw.baseAddress,width:256,height:256,bitsPerComponent:8,bytesPerRow:256*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else { throw NSError(domain:"封面解码失败",code:4) }
          context.interpolationQuality = .medium
          context.draw(cropped,in:CGRect(x:0,y:0,width:256,height:256))
        }
        var total:Double = 0, squares:Double = 0
        for i in 0..<(256*256) { let v = Double(Int(bytes[i*4])+Int(bytes[i*4+1])+Int(bytes[i*4+2]))/765; total += v; squares += v*v }
        let average = total/65536
        guard squares/65536-average*average > 0.0001 else { throw NSError(domain:"封面缺少可识别内容",code:4) }
        let mean:[Float] = [0.48145466,0.4578275,0.40821073], std:[Float] = [0.26862954,0.26130258,0.27577711]
        var pixels = [Float](repeating:0,count:3*256*256)
        for i in 0..<(256*256) { for c in 0..<3 { pixels[c*256*256+i] = (Float(bytes[i*4+c])/255-mean[c])/std[c] } }
        let data = pixels.withUnsafeBytes { NSMutableData(bytes:$0.baseAddress!,length:$0.count) }
        inputs["pixel_values"] = try ORTValue(tensorData:data,elementType:.float,shape:[1,3,256,256])
      }
      let outputName = try active.outputNames()[0]
      let result = try active.run(withInputs:inputs,outputNames:[outputName],runOptions:nil)
      let data = try result[outputName]!.tensorData() as Data
      guard data.count >= 512*4 else { throw NSError(domain:"模型输出无效",code:5) }
      let values:[Float] = data.withUnsafeBytes { raw in (0..<512).map { raw.loadUnaligned(fromByteOffset:$0*4,as:Float.self) } }
      let norm = sqrt(values.reduce(Float(0)) { $0+$1*$1 })
      guard norm > 0, norm.isFinite else { throw NSError(domain:"模型输出无效",code:5) }
      return String(data:try JSONEncoder().encode(values.map { $0/norm }),encoding:.utf8)!
    }.runOnQueue(queue)
    OnDestroy { self.queue.async { self.session = nil; self.env = nil } }
  }
}
