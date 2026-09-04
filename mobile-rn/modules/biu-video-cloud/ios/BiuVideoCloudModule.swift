import ExpoModulesCore
import AVFoundation
import CoreVideo
import Darwin

public class BiuVideoCloudModule: Module {
  private let lock = NSLock()
  private var cancelled = false
  private func cancel(_ value: Bool) { lock.lock(); cancelled=value; lock.unlock() }
  private func check(_ deadline: Date) throws {
    lock.lock(); let stopped=cancelled; lock.unlock()
    if stopped || Date() > deadline { throw problem("视频同步已取消或超时") }
  }
  private func problem(_ message: String) -> NSError { NSError(domain:"BiuVideoCloud",code:1,userInfo:[NSLocalizedDescriptionKey:message]) }
  public func definition() -> ModuleDefinition {
    Name("BiuVideoCloud")
    Events("progress")
    Function("cancel") { self.cancel(true) }
    Function("prepare") { self.cancel(false) }
    Function("replaceFile") { (source: String, target: String) in
      guard let from=URL(string:source),let to=URL(string:target),from.isFileURL,to.isFileURL,rename(from.path,to.path)==0 else {throw self.problem("同步配置保存失败")}
    }
    AsyncFunction("encode") { (input: String, output: String, sid: String) -> [String: Any] in
      try self.encode(input,output,sid)
    }
    AsyncFunction("decode") { (input: String, sid: String) -> [String: Any] in
      try self.decode(input,sid)
    }
  }
  private func encode(_ input: String, _ output: String, _ sid: String) throws -> [String: Any] {
    let deadline=Date().addingTimeInterval(600)
    guard let inputURL=URL(string:input),let outputURL=URL(string:output),inputURL.isFileURL,outputURL.isFileURL else {throw problem("无效文件地址")}
    let payload=try Data(contentsOf:inputURL)
    guard (192...524288).contains(payload.count) else {throw problem("音乐库超过视频容量")}
    let carrier=BIUCarrier(payload:payload,snapshot:sid)
    guard carrier.failure.isEmpty else {throw problem(carrier.failure)}
    let count=Int(carrier.frames()),width=1920,height=1080
    try FileManager.default.createDirectory(at:outputURL.deletingLastPathComponent(),withIntermediateDirectories:true)
    try? FileManager.default.removeItem(at:outputURL)
    let writer=try AVAssetWriter(outputURL:outputURL,fileType:.mp4)
    var success=false
    defer {if !success {writer.cancelWriting();try? FileManager.default.removeItem(at:outputURL)}}
    let stream=AVAssetWriterInput(mediaType:.video,outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264,AVVideoWidthKey:width,AVVideoHeightKey:height,AVVideoCompressionPropertiesKey:[AVVideoAverageBitRateKey:4_000_000,AVVideoMaxKeyFrameIntervalKey:30]])
    stream.expectsMediaDataInRealTime=false
    let adapter=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:stream,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA,kCVPixelBufferWidthKey as String:width,kCVPixelBufferHeightKey as String:height])
    guard writer.canAdd(stream) else {throw problem("设备不支持视频编码")}
    writer.add(stream);guard writer.startWriting() else {throw problem("无法创建视频")};writer.startSession(atSourceTime:.zero)
    for index in 0..<count {
      try check(deadline)
      guard let data=carrier.grid(Int32(index)),let pool=adapter.pixelBufferPool else {throw problem("视频画面生成失败")}
      var buffer: CVPixelBuffer?
      guard CVPixelBufferPoolCreatePixelBuffer(nil,pool,&buffer)==kCVReturnSuccess,let buffer else {throw problem("视频内存不足")}
      CVPixelBufferLockBaseAddress(buffer,[])
      let stride=CVPixelBufferGetBytesPerRow(buffer),base=CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to:UInt8.self)
      data.withUnsafeBytes { bytes in
        let modules=bytes.bindMemory(to:UInt8.self)
        for y in 0..<height {for x in 0..<width {let p=y*stride+x*4,v=modules[(y/15)*128+x/15];base[p]=v;base[p+1]=v;base[p+2]=v;base[p+3]=255}}
      }
      CVPixelBufferUnlockBaseAddress(buffer,[])
      for repeatIndex in 0..<15 {
        while !stream.isReadyForMoreMediaData {try check(deadline);if writer.status == .failed {throw problem("视频编码失败")};Thread.sleep(forTimeInterval:0.005)}
        guard adapter.append(buffer,withPresentationTime:CMTime(value:Int64(index*15+repeatIndex),timescale:30)) else {throw problem("视频写入失败")}
      }
      sendEvent("progress",["type":"encode","frames":index+1,"total":count])
    }
    stream.markAsFinished();let finished=DispatchSemaphore(value:0)
    writer.finishWriting {finished.signal()}
    while finished.wait(timeout:.now()+0.1) == .timedOut {try check(deadline)}
    guard writer.status == .completed else {throw problem("视频写入失败")}
    success=true;return ["snapshotId":sid,"symbols":count,"duration":Double(count)/2]
  }
  private func decode(_ input: String, _ sid: String) throws -> [String: Any] {
    let deadline=Date().addingTimeInterval(300)
    guard let url=URL(string:input),url.isFileURL else {throw problem("无效视频地址")}
    let size=(try FileManager.default.attributesOfItem(atPath:url.path)[.size] as? NSNumber)?.intValue ?? 0
    guard size>0 && size<=536870912 else {throw problem("视频大小超出限制")}
    let carrier=BIUCarrier(snapshot:sid);guard carrier.failure.isEmpty else {throw problem(carrier.failure)}
    let asset=AVURLAsset(url:url)
    guard let track=asset.tracks(withMediaType:.video).first else {throw problem("未找到视频轨道")}
    let reader=try AVAssetReader(asset:asset)
    let stream=AVAssetReaderTrackOutput(track:track,outputSettings:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
    stream.alwaysCopiesSampleData=false;reader.add(stream);guard reader.startReading() else {throw problem("无法读取视频")}
    defer {reader.cancelReading()}
    var last = -0.25,scanned=0
    while let sample=stream.copyNextSampleBuffer() {
      try check(deadline)
      let seconds=CMSampleBufferGetPresentationTimeStamp(sample).seconds
      if seconds-last<0.24 {continue};last=seconds
      guard let image=CMSampleBufferGetImageBuffer(sample) else {continue}
      CVPixelBufferLockBaseAddress(image,.readOnly)
      let width=CVPixelBufferGetWidthOfPlane(image,0),height=CVPixelBufferGetHeightOfPlane(image,0),stride=CVPixelBufferGetBytesPerRowOfPlane(image,0)
      let base=CVPixelBufferGetBaseAddressOfPlane(image,0)!.assumingMemoryBound(to:UInt8.self)
      var levels=Data(count:128*72)
      levels.withUnsafeMutableBytes { bytes in
        let out=bytes.bindMemory(to:UInt8.self)
        for y in 0..<72 {for x in 0..<128 {var sum=0
          for dy in -1...1 {for dx in -1...1 {let px=min(width-1,Int((Double(x)+0.5+Double(dx)*0.2)*Double(width)/128)),py=min(height-1,Int((Double(y)+0.5+Double(dy)*0.2)*Double(height)/72));sum+=Int(base[py*stride+px])}}
          out[y*128+x]=UInt8(sum/9)
        }}
      }
      CVPixelBufferUnlockBaseAddress(image,.readOnly);scanned+=1
      if let payload=carrier.feed(levels) {return ["payload":payload.base64EncodedString(),"scannedFrames":scanned]}
      if !carrier.failure.isEmpty {throw problem(carrier.failure)}
      if scanned%4==0 {sendEvent("progress",["type":"frame","frame":scanned,"mediaSeconds":seconds])}
    }
    throw problem("视频数据不足或校验失败，请等待转码后重试")
  }
}
