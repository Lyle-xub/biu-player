const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const cache = path.join(os.homedir(), '.gradle/caches/modules-2/files-2.1');
function jar(group, name, version) {
  const dir = path.join(cache, group, name, version);
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.jar')).map(f => path.join(dir, f))[0];
}
const compiler = jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.1.20');
test('Android native focus loss/gain and quiet-media recovery preserve user intent and exclude preload players', { skip: !compiler }, () => {
  const root = path.join(__dirname, '../mobile-rn/node_modules/expo-video/android/src/main/java/expo/modules/video');
  const source = fs.readFileSync(path.join(root, 'player/VideoPlayer.kt'), 'utf8');
  const methods = source.slice(source.indexOf('  private var interruptedItem:'), source.indexOf('  internal val firstFrameEventGenerator:'));
  assert.ok(methods.includes('pauseForInterruption'));
  const files = {
    'Focus.kt': fs.readFileSync(path.join(root, 'managers/AudioFocusManager.kt'), 'utf8'),
    'Context.kt': `package android.content
class Context(val audio: android.media.AudioManager) { companion object { const val AUDIO_SERVICE = "audio" }; fun getSystemService(name: String): Any = audio }`,
    'Audio.kt': `package android.media
import android.os.Handler
class AudioAttributes { companion object { const val USAGE_MEDIA=1; const val CONTENT_TYPE_MOVIE=1 }; class Builder { fun setUsage(v:Int)=this; fun setContentType(v:Int)=this; fun build()=AudioAttributes() } }
class AudioFocusRequest(val focusGain:Int) { class Builder(val gain:Int) { fun setWillPauseWhenDucked(v:Boolean)=this; fun setOnAudioFocusChangeListener(v:AudioManager.OnAudioFocusChangeListener)=this; fun setAudioAttributes(v:AudioAttributes)=this; fun build()=AudioFocusRequest(gain) } }
class AudioPlaybackConfiguration
class AudioManager {
  companion object { const val AUDIOFOCUS_GAIN=1; const val AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK=3; const val AUDIOFOCUS_LOSS=-1; const val AUDIOFOCUS_LOSS_TRANSIENT=-2; const val AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK=-3; const val AUDIOFOCUS_REQUEST_GRANTED=1; const val STREAM_MUSIC=3; const val MODE_NORMAL=0 }
  interface OnAudioFocusChangeListener { fun onAudioFocusChange(focusChange:Int) }
  open class AudioPlaybackCallback { open fun onPlaybackConfigChanged(configs:MutableList<AudioPlaybackConfiguration>?) {} }
  var isMusicActive=false; var mode=0; var grants=true; var requests=0; var abandons=0; var callback:AudioPlaybackCallback?=null
  fun requestAudioFocus(r:AudioFocusRequest):Int { requests++; return if(grants) 1 else 0 }
  fun requestAudioFocus(l:OnAudioFocusChangeListener,s:Int,t:Int):Int { requests++; return if(grants) 1 else 0 }
  fun abandonAudioFocusRequest(r:AudioFocusRequest) { abandons++ }
  fun abandonAudioFocus(l:OnAudioFocusChangeListener) { abandons++ }
  fun registerAudioPlaybackCallback(c:AudioPlaybackCallback,h:Handler) { callback=c }
  fun unregisterAudioPlaybackCallback(c:AudioPlaybackCallback) { callback=null }
  fun changed() { callback?.onPlaybackConfigChanged(mutableListOf()) }
}`,
    'OS.kt': `package android.os
object Build { object VERSION { var SDK_INT=35 }; object VERSION_CODES { const val O=26 } }
class Looper { companion object {
 val main=Looper(); var isMain=true
 fun getMainLooper()=main
 fun myLooper():Looper?=if(isMain) main else null
 fun fromJS(action:()->Unit) { isMain=false; try { action() } finally { isMain=true } }
 fun requireMain() { check(isMain) { "Player accessed on JS thread" } }
} }
class Handler(l:Looper) { companion object { val tasks=mutableListOf<Runnable>(); fun flush() { val copy=tasks.toList(); tasks.clear(); copy.forEach { it.run() } } }; fun post(r:Runnable) { tasks.add(r) }; fun removeCallbacks(r:Runnable) { tasks.removeAll { it===r } }; fun postDelayed(r:Runnable,t:Long) { tasks.add(r) } }`,
    'Annotation.kt': `package androidx.media3.common.util
annotation class UnstableApi`,
    'Media.kt': `package androidx.media3.common
class MediaItem
object Player { const val STATE_ENDED=4 }`,
    'App.kt': `package expo.modules.kotlin
class AppContext(val reactContext:android.content.Context?) { val mainQueue=kotlinx.coroutines.Scope() }`,
    'Coroutine.kt': `package kotlinx.coroutines
class Scope
fun Scope.launch(action:()->Unit) { if(android.os.Looper.isMain) action() else android.os.Handler.tasks.add(Runnable { action() }) }`,
    'Error.kt': `package expo.modules.video
class FailedToGetAudioFocusManagerException:Exception()`,
    'Mode.kt': `package expo.modules.video.enums
enum class AudioMixingMode(val priority:Int) { MIX_WITH_OTHERS(0), AUTO(1), DUCK_OTHERS(2), DO_NOT_MIX(3) }`,
    'Listener.kt': `package expo.modules.video.listeners
import expo.modules.video.player.VideoPlayer
import expo.modules.video.enums.AudioMixingMode
interface VideoPlayerListener { fun onAudioMixingModeChanged(player:VideoPlayer,audioMixingMode:AudioMixingMode,oldAudioMixingMode:AudioMixingMode?) {} ; fun onIsPlayingChanged(player:VideoPlayer,isPlaying:Boolean,oldIsPlaying:Boolean?) {}; fun onVolumeChanged(player:VideoPlayer,volume:Float,oldVolume:Float?) {}; fun onMutedChanged(player:VideoPlayer,muted:Boolean,oldMuted:Boolean?) {} }`,
    'Player.kt': `package expo.modules.video.player
import androidx.media3.common.Player
import expo.modules.video.listeners.VideoPlayerListener
import expo.modules.video.enums.AudioMixingMode
class FakePlayer(val owner:VideoPlayer) { var currentMediaItem:androidx.media3.common.MediaItem?=androidx.media3.common.MediaItem(); var playWhenReady=false
 get() { android.os.Looper.requireMain(); return field }
 set(v) { android.os.Looper.requireMain(); field=v }; var playbackState=3; var playerError:Exception?=null; var plays=0
fun play() { playWhenReady=true; plays++; owner.playing=true; owner.listener?.onIsPlayingChanged(owner,true,false) }
fun pause() { playWhenReady=false; owner.playing=false; owner.listener?.onIsPlayingChanged(owner,false,true) } }
class VideoPlayer {
val player=FakePlayer(this); var showNowPlayingNotification=true; var staysActiveInBackground=true; var muted=false; var playing=false; var volume=1f; var userVolume=1f; var audioMixingMode=AudioMixingMode.DO_NOT_MIX; var listener:VideoPlayerListener?=null
fun addListener(l:VideoPlayerListener) { listener=l }; fun removeListener(l:VideoPlayerListener) { listener=null }
${methods}
}`,
    'Checks.kt': `import android.media.AudioManager
import android.os.Handler
import expo.modules.video.player.VideoPlayer
import expo.modules.video.managers.AudioFocusManager
fun main(args:Array<String>) {
 android.os.Build.VERSION.SDK_INT=args.firstOrNull()?.toInt() ?: 35
 val audio=AudioManager(); val focus=AudioFocusManager(expo.modules.kotlin.AppContext(android.content.Context(audio)))
 val p=VideoPlayer()
 // Expo constructs and configures players from the JS thread, before playback.
 android.os.Looper.fromJS { focus.registerPlayer(p) }; Handler.flush()
 android.os.Looper.fromJS {
   focus.onAudioMixingModeChanged(p,p.audioMixingMode,null)
   focus.onVolumeChanged(p,1f,null)
   focus.onMutedChanged(p,false,null)
   focus.onIsPlayingChanged(p,false,null)
 }; Handler.flush()
 p.playWithIntent()
 val requests=audio.requests; focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
 check(!p.playing && p.canResumeAfterInterruption); check(audio.abandons==0)
 val pre=VideoPlayer(); pre.muted=true; pre.showNowPlayingNotification=false; focus.registerPlayer(pre); pre.playWithIntent()
 check(audio.requests==requests && audio.abandons==0) // muted preload must not disturb the suspended focus request
 focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN); check(p.playing && !p.canResumeAfterInterruption)
 focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT); p.pauseWithIntent(); focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN); check(!p.playing)
 p.playWithIntent(); focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT); p.player.currentMediaItem=androidx.media3.common.MediaItem(); focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN); check(!p.playing)
 p.playWithIntent(); focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS)
 Handler.flush(); check(!p.playing) // no blind timer resume before external playback was observed
 audio.isMusicActive=true; audio.changed(); Handler.flush(); check(!p.playing)
 audio.isMusicActive=false; audio.changed(); Handler.flush();
 if (android.os.Build.VERSION.SDK_INT < 26) { check(!p.playing); focus.onAppForegrounded() }; check(p.playing)
 focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS); audio.isMusicActive=true; focus.onAppForegrounded(); check(!p.playing)
 audio.isMusicActive=false; audio.mode=2; focus.onAppForegrounded(); check(!p.playing)
 audio.mode=0; audio.grants=false; focus.onAppForegrounded(); check(!p.playing && p.canResumeAfterInterruption)
 audio.grants=true; focus.onAppForegrounded(); check(p.playing)
 focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK); check(!p.playing); focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN); check(p.playing)
 // Removing one player must not read the remaining paused player from JS either.
 p.pauseWithIntent()
 android.os.Looper.fromJS { focus.unregisterPlayer(pre) }; Handler.flush()
 android.os.Looper.fromJS { focus.unregisterPlayer(p) }; Handler.flush()
 check(audio.callback==null)
 println("native Android interruption checks passed")
}`,
  };
  const stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.1.20');
  const cp = [compiler, stdlib, jar('org.jetbrains.kotlin','kotlin-script-runtime','2.1.20'), jar('org.jetbrains.kotlin','kotlin-reflect','1.6.10'), jar('org.jetbrains.intellij.deps','trove4j','1.0.20200330'), jar('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm','1.8.0'), jar('org.jetbrains','annotations','13.0')].filter(Boolean).join(path.delimiter);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-focus-'));
  try {
    const names = Object.entries(files).map(([name, text]) => { const file=path.join(dir,name);fs.writeFileSync(file,text);return file; });
    const out=path.join(dir,'checks.jar');
    execFileSync('java',['-cp',cp,'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-no-stdlib','-no-reflect','-classpath',stdlib,'-d',out,...names],{timeout:60000,stdio:'pipe'});
    for (const sdk of ['24', '35']) {
      assert.match(execFileSync('java',['-cp',`${out}${path.delimiter}${stdlib}`,'ChecksKt',sdk],{encoding:'utf8'}),/checks passed/);
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
