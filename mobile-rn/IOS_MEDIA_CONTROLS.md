# iOS 系统播放控件

## 故障分析

复现场景：iPhone 17，iOS 26.4 模拟器，系统媒体卡片缺少上一首/下一首。

后续界面验收发现：仅把上一首/下一首注册到系统，并不足以让控件显示。
运行中的 AVPlayer 速率为 1，系统却一直记录为 Paused；通过调试器补写
`MPNowPlayingInfoCenter.playbackState` 后，系统立即变为 Playing，用户确认
媒体卡片恢复。现在初次发布、播放/暂停更新、停止清理均显式同步该状态。

同时发现关闭签名的模拟器构建只有 linker 签名，Identifier 为 `BiuPlayer`，
Info.plist 未绑定；MediaRemoteUI 也按 `BiuPlayer` 查找应用。重新用 Xcode
本地签名构建后，系统正确识别 `com.biuplayer.mobile` 和显示名 Biu Player。
模拟器测试不能使用 `CODE_SIGNING_ALLOWED=NO` 作为发布控件的验收环境。

此前补丁在 iOS 26 创建 `MPNowPlayingSession(players: [player])`，同一个
`AVPlayer` 又交给 expo-video 的 `AVPlayerViewController` 显示视频。
Apple 明确说明一个 AVPlayer 只能属于一个 Now Playing 会话，不能将自建会话
绑定到 AVPlayerViewController 使用的播放器：
https://developer.apple.com/documentation/mediaplayer/mpnowplayingsession

此前还在换源、就绪、会话激活时反复重建按钮；清理代码将可空 target 传给
`removeTarget`，可能误删新注册或其他模块的 handler。元数据加载也缺少取消与
当前曲目校验，慢请求可能覆盖新曲目的系统信息。

## 修复约定

- 所有 iOS 版本使用应用级 `MPRemoteCommandCenter.shared()` 和
  `MPNowPlayingInfoCenter.default()`。VideoView 保持
  `updatesNowPlayingInfoCenter = false`。不额外绑定播放器会话。
- 元数据的 playback rate 与系统 playbackState 都必须同步；模拟器不会可靠地从音频会话推断状态。
- 控制按钮在主线程注册，随播放器生命周期清理，切歌不拆卸 handler。
  上一首/下一首发给 PlayerContext 的当前队列；禁用占用相同位置的快进/快退命令。
- 音频会话交给 Expo VideoManager 统一管理，避免反复切换音频模式。
- 立即发布已有曲目信息；异步元数据和封面必须仍属于当前曲目才能写入。
- 切歌发布信息时附带缓存封面，未命中则在下载期间暂留已有封面；首次播放、无封面和下载失败使用 Biu 占位图。
  封面缓存最多 12 张，刷新使用独立 revision 拒绝取消后仍到达的旧回调。
  这避免了原先每次刷新先移除 artwork、导致系统短暂显示喇叭占位图的空窗。
  CDN 封面统一使用 HTTPS，hdslb 请求带 Bilibili Referer。
- 按产品选择保留独立歌词 Live Activity。它与系统播放入口是两个入口；
  歌词活动本身没有上一首/下一首按钮，应展开系统播放入口进行切歌。

原生代码通过 `patches/expo-video+57.0.3.patch` 保存。`npm install` 的
postinstall 会应用补丁，`expo.autolinking.buildFromSource` 必须继续包含
`expo-video`。修改原生补丁后必须重新编译安装，单独刷新 Metro 不会生效。

## 回归

在仓库根目录运行：

```sh
node --test --test-name-pattern='^iOS transport|^system previous|^player publishes system|^reordered segments|^background automatic' test/mobile-player.test.cjs
```

系统界面验收（必须实际操作，JS 回归和编译成功不能替代）：

1. 播放至少三首的队列，打开控制中心，确认上一首/暂停/下一首。
2. 连续切换前后曲目，确认标题、封面和正在播放的歌曲一致。
3. 进入和退出视频页后重复切歌，确认控件仍存在。
4. 切到单曲循环，手动下一首仍切歌；自然结束才重播本曲。
5. 暂停后上一首、重新排列队列后下一首，确认跟随最新队列。
6. 返回主屏，区分歌词活动和系统播放入口，展开后者检查切歌。
7. 锁屏及后台自动换曲后重复上述检查；最终发布前在真机上再验证。

## 构建与验证记录（2026-09-06）

在 mobile-rn 目录用正常模拟器签名构建（不需要真机证书）：

```sh
xcodebuild -workspace ios/BiuPlayer.xcworkspace -scheme BiuPlayer -configuration Release \
  -destination 'platform=iOS Simulator,id=F45D32EF-B824-4697-9F41-998C58F7D237' \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-
```

- 带本地签名的 Release 完整构建、安装和启动成功；codesign 标识为 com.biuplayer.mobile。
- 系统日志确认正确应用标识、PreviousTrack/NextTrack 启用和 Paused → Playing 状态转换。
- 5 项定向回归通过，包括初始、动态和停止状态同步的回归约束。
- 上一轮全量移动端测试为 42/47 通过，5 项因既有测试 mock 未隔离 RN/Expo 模块而加载失败。
- 用户确认补写播放状态后媒体卡片恢复，但新版签名包仍缺少按钮。独立 AVAudioPlayer 诊断 App 也没有按钮，重启 26.4 后用户反馈诊断卡片消失。尚未解决；按用户要求暂停该问题的排查。
