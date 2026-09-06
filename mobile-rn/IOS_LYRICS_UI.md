# iOS 系统歌词与独立运行

## 安装

模拟器验收使用 `npm run ios:standalone -- --device <模拟器UUID>`。
Release 会内置 main.jsbundle，无需 Metro；普通 `npm run ios` 是开发包，
未连接开发服务器时会进入 Expo Development Build 启动页。
不能以 simctl 返回 PID 代替首页验收。

## 渲染

实时活动及灵动岛：`patches/expo-widgets+57.0.17.patch` 内的
`WidgetLiveActivity.swift`。
桌面悬浮歌词：`modules/biu-lyrics-pip/ios/BiuLyricsPiPModule.swift`。
两者共享 `BiuMonetLyrics.swift` 的时间与歌词数据；Folia 光效保留在 PiP。

- 双槽按 1/2 → 3/2 → 3/4 交替；两行字号一致，换句硬切。
  当前句在器乐空档保持，下一句真正开始时才交接。
  文字内容显式使用 contentTransition(.identity)，高亮层移除使用 identity；
  焦点变化禁用隐式动画，避免默认模糊过渡使新旧歌词短暂重叠。
- 实时活动和灵动岛将系统 `ProgressView(timerInterval:)` 直接放入文字高亮遮罩。
  进度层纵向放大，以亮度转透明度去除未完成轨道，再柔化扫描边界。
  每行仅保留一个系统计时层，高亮以透明字形图像为底，仅使用一次计时遮罩。
  固定字形光晕预渲染并缓存，去掉滚动层的实时阴影、字形模糊和重复字形遮罩。
  整行先合成再统一位移；不使用 drawingGroup 冻结系统计时，未开始的歌词不发光。
  不把计时读回 JS/Swift 状态；歌词固定显示，换句直接硬切，取消横向位移和滚动动画。
  长句按实际窗口宽度和系统分词分页，唱到约 75% 处的词尾直接硬切；
  右侧未唱的上下文保留到下一页，不拆词、不平移、不渐变。短句在灵动岛居中。
  每页扫描使用整句时间线的对应区间，分页不重置整句播放进度。
  使用透明字形图像取代动态 Text，减少系统内容替换的模糊过渡；短句保持居中。
  高亮层常驻并使用透明度开关，尚未到达起始时间的句子不接入计时器。
  这是系统计时遮罩方案，编译与逻辑检查不能证明 WidgetKit 在遮罩合成后仍持续刷新，
  需要用户在实际实时活动中验收；不宣称完整复刻 Folia 的逐字时序与尾光。
- 桌面 PiP 保留 Folia 的实测字素扫描、柔边渐变、两层独立光晕和
  Smoothstep 尾光。标点参与同一字形坐标，扫描和滚动共用时间值。
- 普通 LRC 没有逐字时间时遵循 Folia 的整句 token；不人为猜测两字/三字分词。
  有逐字时间时保留时间空档，短句也按其完整时长扫描。
- 光晕半径 font × 0.28 / 0.65，柔边 clamp(font × 0.45, 6, 16)，
  爬升 1.18 倍词时长、尾光 1.05 秒、最大强度 0.88。
  SwiftUI 两层 shadow 必须独立绘制，串联会对内层光晕再次投影。
- 桌面 PiP 900 × 200，44 pt 双行，独立 30 FPS 绘制时钟；
  暂停、seek、换歌及明显时间漂移才校正锚点。
- 灵动岛紧凑区 13 pt、展开区 16 pt；当前句带系统计时扫描和轻微光晕。
  长按展开使用全宽 bottom 区域，按上一句／当前句／下一句纵向排列三行；
  当前句保留扫描和轻微光晕，上下文弱化显示，换句硬切。
  上一句只传文本，复用双槽中的当前句和下一句，实际可用宽度由 iOS 分配。
  系统在双活动并列时选择的 minimal 区域显示五柱播放指示，不显示歌词；
  五柱保持静态高度、播放时提亮。这是频谱样式指示，不是音频 FFT。
  App 无法查询别的 App 的活动数量，展示模式由系统决定。
- 封面缩采样到 24 × 24，以饱和度加权挑选主要色相，避免互补色平均成灰褐色。
  加载失败使用默认色，旧封面结果不会覆盖新歌曲。
  PiP 使用低饱和炭灰底和封面色柔光，慢速移动不在每次换句时跳回起点。
  实时活动背景叠加低饱和封面色径向柔光和白色微光，使用静态渐变而不引入额外刷新。
  PiP 边框内收 14 px，64 px 圆角，2.5 px 描边（900 × 200 视频坐标）；
  边框在歌词光晕之后绘制，减少系统圆角裁切及光晕冲淡边缘。

## WidgetKit 边界

实时活动是远程内容快照。原生 VideoPlayerObserver 的播放时间与播放状态回调直接发送歌词时钟，
不再依赖 NowPlayingManager 或系统媒体卡片是否存在。
在换句、首次开唱、句末、暂停和 seek 时提交更新；长句约半秒发送位置供各窗口选择页面，
只有页面内容发生变化才硬切，不再发送滚动动画目标；
在途更新只保留最新待发布内容。JS 仅在配置变化时传完整时间线，时间线保存在
App 内存中；系统显示不需要逐字时间，因此快照也清除 words 以减小状态体积。

系统计时遮罩使用稳定的 clockAnchor + 整句歌词起止时间；普通播放采样和换句
不修改锚点。只有播放状态变化和 seek 才重新校准，避免每秒重置系统计时。
不要依赖自定义 Animatable time、onAppear/onChange + State 循环，
不要用 Transaction 控制系统动画，也不要每秒替换整个视图 identity。
暂停、seek 与换歌通过 clockRevision 立即重置。

Apple 将活动更新动画限制为最多两秒，Always-On 息屏时不执行动画，
系统也可能延迟内容更新；这里不能承诺桌面程序同等持续帧率。
参考 [Apple 动画说明](https://developer.apple.com/documentation/widgetkit/animating-data-updates-in-widgets-and-live-activities)。

Folia 对照版本：
[MonetLyricsRail](https://github.com/chthollyphile/folia-major/blob/08fc072f803fa9059792069556ce763aa7e6f437/src/components/visualizer/monet/MonetLyricsRail.tsx)。

## 数据与生命周期

ActivityKit 的紧凑词时间格式为
[字素结束位置, 开始秒, 结束秒, 可选逐字时间…]；
空歌词槽仅传 ActivityKit/PiP JSON。桌面小组件快照只传标题、歌手、
当前/下一句和播放状态，不传 null：Expo Widgets 的 UserDefaults 存储不支持它。

正常后台播放保留歌词；关闭开关、清空播放或卸载同步组件结束活动。
启动先清理旧活动，start/update/end 串行避免旧任务复活。
原生终止回调尝试同步关闭 PiP 与实时活动；iOS 不保证划掉 App 时调用
终止回调，因此不能保证强制退出后立即关闭。

修改 node_modules 中的原生文件后运行 `npx patch-package expo-video expo-widgets`，
再编译安装。JS 备用 Widget 布局不控制这两处原生渲染。

## 检查

```sh
node --test test/ios-lyrics-clock.test.cjs
node --test --test-name-pattern='^system lyric|^scrubber|^Monet sweep|^media layout' test/mobile-player.test.cjs
bash test/ios-monet-checks.sh <模拟器UUID>
```

原生检查覆盖短句、逐字空档、尾光公式、背景色、暂停/seek、
后台时钟，以及滚动后字形/遮罩/光晕与原图裁剪逐像素一致。
播放页 iOS 收起手势限制在顶部 140 pt，避免原生返回手势取消进度条拖动。

同一视频内切换分切歌曲时，iOS 通过 expo-video 的 updateMetadata 单独更新系统标题、
歌手和封面，不替换 AVPlayerItem。原视频的 source identity 用于拒绝过期更新；
封面加载仍沿用已有缓存与 metadataRevision 防止旧封面覆盖新歌。

句末状态单独参与更新判定，采样跨过结尾时也补交最终高亮，随后在器乐空档保持。

分切歌曲通过 metadata 的 biuSegmentStart/biuSegmentEnd 给系统媒体控件传递范围。
NowPlaying 的总时长为片段长度、进度为原视频时间减片段起点；系统拖动则加回起点，
并限制在片段内。复用同一视频切换片段时随 updateMetadata 更新；播放完整视频清空范围。
歌词原生时钟仍使用原视频时间作为内部输入，统一在 _audioOffset 处扣除起点，避免重复扣减。

系统进度条通过 VideoPlayer.currentTime 的精确 seeker 路径定位，使用与 App 内拖动相同的容差，
避免默认 AVPlayer.seek 跳到片段外的附近关键帧。systemSeek 事件同步 App 的目标位置和歌词修订号，
不重复 seek、不改变播放状态；目标到达前忽略旧进度和结束事件。同视频不同片段的延迟事件按范围拒绝。
