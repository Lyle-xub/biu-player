package expo.modules.biuvideocloud

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.Image
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URI

class BiuVideoCloudModule : Module() {
  companion object { init { System.loadLibrary("biu_cloud") } }
  @Volatile private var cancelled = false
  private external fun encoder(payload: ByteArray, sid: String): Long
  private external fun frames(pointer: Long): Int
  private external fun grid(pointer: Long, index: Int): ByteArray
  private external fun freeEncoder(pointer: Long)
  private external fun decoder(sid: String): Long
  private external fun feed(pointer: Long, levels: ByteArray): ByteArray?
  private external fun freeDecoder(pointer: Long)
  private fun file(uri: String) = File(URI(uri))
  private fun checkActive(deadline: Long) { check(!cancelled && System.currentTimeMillis() < deadline) { "视频同步已取消或超时" } }
  override fun definition() = ModuleDefinition {
    Name("BiuVideoCloud")
    Events("progress")
    Function("cancel") { cancelled = true }
    Function("prepare") { cancelled = false }
    Function("replaceFile") { source: String, target: String -> android.system.Os.rename(file(source).absolutePath, file(target).absolutePath) }
    AsyncFunction("encode") { input: String, output: String, sid: String -> encodeVideo(input, output, sid) }
    AsyncFunction("decode") { input: String, sid: String -> decodeVideo(input, sid) }
  }
  private fun encodeVideo(input: String, output: String, sid: String): Map<String, Any> {
    val deadline = System.currentTimeMillis() + 10 * 60 * 1000
    val source = file(input); check(source.length() in 192..524288) { "音乐库超过视频容量" }
    val handle = encoder(source.readBytes(), sid)
    val width=1920; val height=1080; val symbols=frames(handle); val total=symbols*15
    val codec=MediaCodec.createEncoderByType("video/avc")
    var muxer: MediaMuxer?=null; var started=false; var success=false
    try {
      val format=MediaFormat.createVideoFormat("video/avc",width,height).apply {
        setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
        setInteger(MediaFormat.KEY_BIT_RATE,4_000_000);setInteger(MediaFormat.KEY_FRAME_RATE,30);setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1)
      }
      codec.configure(format,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);codec.start()
      file(output).parentFile?.mkdirs()
      muxer=MediaMuxer(file(output).absolutePath,MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      val info=MediaCodec.BufferInfo();var track=-1;var sent=0;var inputDone=false;var outputDone=false
      var y=ByteArray(width*height)
      while(!outputDone) {
        checkActive(deadline)
        if(!inputDone) {
          val index=codec.dequeueInputBuffer(10000)
          if(index>=0) {
            if(sent==total) { codec.queueInputBuffer(index,0,0,sent*1_000_000L/30,MediaCodec.BUFFER_FLAG_END_OF_STREAM);inputDone=true }
            else {
              if(sent%15==0) {
                val modules=grid(handle,sent/15)
                for(row in 0 until height)for(col in 0 until width)y[row*width+col]=if(modules[(row/15)*128+col/15].toInt()==0)16 else 235.toByte()
                sendEvent("progress",mapOf("type" to "encode","frames" to sent/15+1,"total" to symbols))
              }
              val image=codec.getInputImage(index) ?: error("设备不支持视频编码输入")
              fill(image,y,width,height);image.close()
              codec.queueInputBuffer(index,0,width*height*3/2,sent*1_000_000L/30,0);sent++
            }
          }
        }
        var out=codec.dequeueOutputBuffer(info,10000)
        while(out>=0) {
          val buffer=codec.getOutputBuffer(out)!!
          if(info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG==0 && info.size>0) {
            check(started);buffer.position(info.offset);buffer.limit(info.offset+info.size);muxer.writeSampleData(track,buffer,info)
          }
          outputDone=info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM!=0
          codec.releaseOutputBuffer(out,false);out=codec.dequeueOutputBuffer(info,0)
        }
        if(out==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) { check(!started);track=muxer.addTrack(codec.outputFormat);muxer.start();started=true }
      }
      muxer.stop();started=false;success=true
      return mapOf("snapshotId" to sid,"symbols" to symbols,"duration" to symbols/2.0)
    } finally {
      try {codec.stop()}catch(_:Exception){};codec.release()
      if(started)try{muxer?.stop()}catch(_:Exception){};muxer?.release();freeEncoder(handle)
      if(!success)file(output).delete()
    }
  }
  private fun fill(image: Image, y: ByteArray, width: Int, height: Int) {
    for(i in 0..2) {
      val plane=image.planes[i];val w=if(i==0)width else width/2;val h=if(i==0)height else height/2
      val row=if(i==0)null else ByteArray(w*plane.pixelStride){128.toByte()}
      for(r in 0 until h) {
        plane.buffer.position(r*plane.rowStride)
        if(i==0 && plane.pixelStride==1)plane.buffer.put(y,r*width,width)
        else if(i==0)for(c in 0 until w)plane.buffer.put(r*plane.rowStride+c*plane.pixelStride,y[r*width+c])
        else plane.buffer.put(row!!,0,(w-1)*plane.pixelStride+1)
      }
    }
  }
  private fun decodeVideo(input: String, sid: String): Map<String, Any> {
    val deadline=System.currentTimeMillis()+5*60*1000
    val source=file(input);check(source.length() in 1..536870912) { "视频大小超出限制" }
    val extractor=MediaExtractor();var codec: MediaCodec?=null;val handle=decoder(sid)
    try {
      extractor.setDataSource(source.absolutePath)
      val track=(0 until extractor.trackCount).firstOrNull {extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/")==true} ?: error("未找到视频轨道")
      extractor.selectTrack(track);val format=extractor.getTrackFormat(track)
      format.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      codec=MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!);codec.configure(format,null,null,0);codec.start()
      var inputDone=false;var outputDone=false;var last=-250000L;var scanned=0;val info=MediaCodec.BufferInfo()
      while(!outputDone) {
        checkActive(deadline)
        if(!inputDone) {
          val i=codec.dequeueInputBuffer(10000)
          if(i>=0) {val buffer=codec.getInputBuffer(i)!!;val size=extractor.readSampleData(buffer,0)
            if(size<0){codec.queueInputBuffer(i,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM);inputDone=true}
            else {codec.queueInputBuffer(i,0,size,extractor.sampleTime,0);extractor.advance()}}
        }
        val i=codec.dequeueOutputBuffer(info,10000)
        if(i>=0) {
          try {
            if(info.size>0 && info.presentationTimeUs-last>=240000) {
              last=info.presentationTimeUs;val image=codec.getOutputImage(i) ?: error("设备不支持视频帧读取")
              val levels=try {sample(image)}finally{image.close()};scanned++
              val payload=feed(handle,levels)
              if(scanned%4==0)sendEvent("progress",mapOf("type" to "frame","frame" to scanned,"mediaSeconds" to last/1e6))
              if(payload!=null)return mapOf("payload" to Base64.encodeToString(payload,Base64.NO_WRAP),"scannedFrames" to scanned)
            }
            outputDone=info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM!=0
          } finally {codec.releaseOutputBuffer(i,false)}
        }
      }
      error("视频数据不足或校验失败，请等待转码后重试")
    } finally {try{codec?.stop()}catch(_:Exception){};codec?.release();extractor.release();freeDecoder(handle)}
  }
  private fun sample(image: Image): ByteArray {
    val crop=image.cropRect;val plane=image.planes[0];val result=ByteArray(128*72)
    for(y in 0 until 72)for(x in 0 until 128) {
      var sum=0
      for(dy in -1..1)for(dx in -1..1) {
        val px=crop.left+((x+.5+dx*.2)*crop.width()/128).toInt().coerceIn(0,crop.width()-1)
        val py=crop.top+((y+.5+dy*.2)*crop.height()/72).toInt().coerceIn(0,crop.height()-1)
        sum+=plane.buffer.get(py*plane.rowStride+px*plane.pixelStride).toInt() and 255
      }
      result[y*128+x]=(sum/9).toByte()
    }
    return result
  }
}
