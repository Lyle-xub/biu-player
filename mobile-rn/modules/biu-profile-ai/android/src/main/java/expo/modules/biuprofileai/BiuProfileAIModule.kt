package expo.modules.biuprofileai

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import ai.onnxruntime.*
import android.app.ActivityManager
import android.content.Context
import android.os.PowerManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import java.io.File
import java.net.URI
import java.nio.LongBuffer
import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlinx.coroutines.*
import org.json.JSONArray
import kotlin.math.sqrt

class BiuProfileAIModule : Module() {
  private val dispatcher = Executors.newSingleThreadExecutor { task -> Thread({
    android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND); task.run()
  }, "biu.profile-ai") }.asCoroutineDispatcher()
  private val scope = CoroutineScope(SupervisorJob() + dispatcher)
  private val env by lazy { OrtEnvironment.getEnvironment() }
  private var session: OrtSession? = null
  private var loaded = ""
  private fun file(uri: String) = File(URI(uri))
  private fun allowed(): Boolean {
    val context = appContext.reactContext ?: return false
    val memory = ActivityManager.MemoryInfo()
    (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memory)
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return !memory.lowMemory && !power.isPowerSaveMode && (android.os.Build.VERSION.SDK_INT < 29 || power.currentThermalStatus < PowerManager.THERMAL_STATUS_MODERATE)
  }
  override fun definition() = ModuleDefinition {
    Name("BiuProfileAI")
    AsyncFunction("available") { allowed() }.runOnQueue(scope)
    AsyncFunction("release") { session?.close(); session = null; loaded = "" }.runOnQueue(scope)
    AsyncFunction("trimCache") { uri: String, limit: Int ->
      check(limit in 0..2000)
      val entries=file(uri).listFiles()?.filter { it.isFile && it.name.endsWith(".json") } ?: emptyList()
      entries.sortedBy { it.lastModified() }.take(maxOf(0,entries.size-limit)).forEach { it.delete() }
    }.runOnQueue(scope)
    AsyncFunction("hashFile") { uri: String ->
      val digest = MessageDigest.getInstance("SHA-256")
      file(uri).inputStream().use { input -> val buffer=ByteArray(65536); var size=input.read(buffer)
        while(size>=0){if(size>0)digest.update(buffer,0,size);size=input.read(buffer)} }
      digest.digest().joinToString("") { "%02x".format(it) }
    }.runOnQueue(scope)
    AsyncFunction("encode") { kind: String, model: String, payload: String ->
      check(allowed()) { "设备繁忙，已暂停本地分析" }
      check(kind == "text" || kind == "image")
      if(loaded != model){session?.close();session=null;loaded=""
        OrtSession.SessionOptions().use { options -> options.setIntraOpNumThreads(1);options.setInterOpNumThreads(1)
          options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL)
          session=env.createSession(file(model).absolutePath,options) };loaded=model }
      val active=session!!
      val inputs=mutableMapOf<String,OnnxTensor>()
      try {
        if(kind=="text"){
          val json=JSONArray(payload);check(json.length() in 2..128)
          for(name in active.inputNames){val ids=LongArray(json.length()){i->if(name=="input_ids")json.getLong(i) else if(name=="attention_mask")1L else 0L}
            inputs[name]=OnnxTensor.createTensor(env,LongBuffer.wrap(ids),longArrayOf(1,ids.size.toLong()))}
        }else{
          val source=file(payload);check(source.length()<=4*1024*1024)
          val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeFile(source.path,bounds)
          check(bounds.outWidth>0&&bounds.outHeight>0)
          val options=BitmapFactory.Options().apply { inSampleSize=1;while(minOf(bounds.outWidth,bounds.outHeight)/inSampleSize>512)inSampleSize*=2 }
          val bitmap=BitmapFactory.decodeFile(source.path,options) ?: error("封面无效")
          val side=minOf(bitmap.width,bitmap.height)
          val crop=Bitmap.createBitmap(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side)
          val resized=Bitmap.createScaledBitmap(crop,256,256,true)
          val pixels=IntArray(256*256);resized.getPixels(pixels,0,256,0,0,256,256)
          val mean=floatArrayOf(.48145466f,.4578275f,.40821073f);val std=floatArrayOf(.26862954f,.26130258f,.27577711f)
          val values=FloatArray(3*256*256)
          var total=0.0;var squares=0.0
          try {
            for(i in pixels.indices){
              val red=Color.red(pixels[i]);val green=Color.green(pixels[i]);val blue=Color.blue(pixels[i])
              val value=(red+green+blue)/765.0;total+=value;squares+=value*value
              values[i]=(red/255f-mean[0])/std[0]
              values[65536+i]=(green/255f-mean[1])/std[1]
              values[131072+i]=(blue/255f-mean[2])/std[2]
            }
            val average=total/pixels.size
            check(squares/pixels.size-average*average > 0.0001) { "封面缺少可识别内容" }
          }finally{if(resized!==crop)resized.recycle();if(crop!==bitmap)crop.recycle();bitmap.recycle()}
          inputs["pixel_values"]=OnnxTensor.createTensor(env,FloatBuffer.wrap(values),longArrayOf(1,3,256,256))
        }
        active.run(inputs).use { result ->
          val output=result[0] as OnnxTensor;val buffer=output.floatBuffer
          check(buffer.remaining()>=512);val values=FloatArray(512);buffer.get(values)
          val norm=sqrt(values.fold(0.0){n,v->n+v*v});check(norm>0&&norm.isFinite())
          JSONArray(values.map { it/norm }).toString()
        }
      }finally{inputs.values.forEach{it.close()}}
    }.runOnQueue(scope)
    OnDestroy { scope.cancel();CoroutineScope(dispatcher).launch { session?.close();session=null;dispatcher.close() } }
  }
}
