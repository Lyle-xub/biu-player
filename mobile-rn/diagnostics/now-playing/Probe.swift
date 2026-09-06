import UIKit
import AVFoundation
import MediaPlayer

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  var audio: AVAudioPlayer!
  var targets: [Any] = []
  var track = 1
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let controller = UIViewController()
    controller.view.backgroundColor = .black
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
    do {
      try AVAudioSession.sharedInstance().setCategory(.playback)
      try AVAudioSession.sharedInstance().setActive(true)
      audio = try AVAudioPlayer(contentsOf: Bundle.main.url(forResource: "tone", withExtension: "wav")!)
      audio.numberOfLoops = -1
      audio.volume = 0.04
      let c = MPRemoteCommandCenter.shared()
      c.skipForwardCommand.isEnabled = false
      c.skipBackwardCommand.isEnabled = false
      for (command, action) in [
        (c.playCommand, { self.audio.play(); self.publish() }),
        (c.pauseCommand, { self.audio.pause(); self.publish() }),
        (c.togglePlayPauseCommand, { self.audio.isPlaying ? self.audio.pause() : self.play(); self.publish() }),
        (c.nextTrackCommand, { self.track += 1; self.publish() }),
        (c.previousTrackCommand, { self.track -= 1; self.publish() })
      ] {
        command.isEnabled = true
        targets.append(command.addTarget { _ in DispatchQueue.main.async(execute: action); return .success })
      }
      application.beginReceivingRemoteControlEvents()
      audio.play()
      publish()
    } catch { print("PROBE ERROR: \(error)") }
    return true
  }
  func play() { audio.play() }
  func publish() {
    let center = MPNowPlayingInfoCenter.default()
    center.nowPlayingInfo = [MPMediaItemPropertyTitle: "原生控件诊断 \(track)",
      MPMediaItemPropertyArtist: "AVAudioPlayer · 无 Expo / 歌词 / PiP",
      MPMediaItemPropertyPlaybackDuration: 120,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: audio.currentTime,
      MPNowPlayingInfoPropertyPlaybackRate: audio.isPlaying ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
      MPNowPlayingInfoPropertyPlaybackQueueCount: 3,
      MPNowPlayingInfoPropertyPlaybackQueueIndex: 1]
    center.playbackState = audio.isPlaying ? .playing : .paused
  }
}
