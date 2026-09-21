package expo.modules.biumediaexport

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher

class BiuMediaExportModule : Module() {
  // Never occupy the shared Expo queue or the playback/main thread with file IO.
  private val dispatcher = Executors.newSingleThreadExecutor { task ->
    Thread(task, "biu-media-export").apply { priority = Thread.MIN_PRIORITY }
  }.asCoroutineDispatcher()
  private val scope = CoroutineScope(SupervisorJob() + dispatcher)
  override fun definition() = ModuleDefinition {
    Name("BiuMediaExport")
    AsyncFunction("mux") { video: String, audio: String, output: String ->
      mux(video, audio, output)
    }.runOnQueue(scope)
    OnDestroy { dispatcher.close() }
  }
  private fun local(uri: String): String {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "无效的本地视频文件" }
    return requireNotNull(parsed.path)
  }
  private fun mux(video: String, audio: String, output: String) {
    val destination = local(output)
    val extractors = listOf(MediaExtractor(), MediaExtractor())
    var muxer: MediaMuxer? = null
    var success = false
    try {
      muxer = MediaMuxer(destination, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      val sources = listOf(local(video), local(audio))
      val types = listOf("video/", "audio/")
      val tracks = extractors.mapIndexed { index, extractor ->
        extractor.setDataSource(sources[index])
        val track = (0 until extractor.trackCount).firstOrNull {
          extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith(types[index]) == true
        } ?: error("下载文件缺少${types[index]}轨道")
        val format = extractor.getTrackFormat(track)
        if (index == 0 && format.containsKey(MediaFormat.KEY_ROTATION)) {
          muxer.setOrientationHint(format.getInteger(MediaFormat.KEY_ROTATION))
        }
        extractor.selectTrack(track)
        muxer.addTrack(format)
      }
      muxer.start()
      var buffer = ByteBuffer.allocateDirect(if (Build.VERSION.SDK_INT >= 28) 1024 * 1024 else 32 * 1024 * 1024)
      val info = MediaCodec.BufferInfo()
      val counts = intArrayOf(0, 0)
      while (true) {
        val index = extractors.indices.filter { extractors[it].sampleTime >= 0 }
          .minByOrNull { extractors[it].sampleTime } ?: break
        val extractor = extractors[index]
        val required = if (Build.VERSION.SDK_INT >= 28) extractor.sampleSize else buffer.capacity().toLong()
        require(required in 1..(32L * 1024 * 1024)) { "视频帧过大或文件损坏" }
        if (required > buffer.capacity()) buffer = ByteBuffer.allocateDirect(required.toInt())
        buffer.clear()
        val size = extractor.readSampleData(buffer, 0)
        require(size > 0) { "视频文件不完整" }
        require(extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_ENCRYPTED == 0) { "不支持导出加密轨道" }
        val flags = if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
        info.set(0, size, extractor.sampleTime, flags)
        buffer.position(0); buffer.limit(size)
        muxer.writeSampleData(tracks[index], buffer, info)
        counts[index]++
        extractor.advance()
      }
      require(counts.all { it > 0 }) { "下载文件缺少音画内容" }
      muxer.stop()
      success = true
    } finally {
      extractors.forEach { it.release() }
      try { muxer?.release() } finally { if (!success) File(destination).delete() }
    }
  }
}
