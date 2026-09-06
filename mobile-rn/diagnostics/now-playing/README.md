# 独立系统播放控件对照

`Probe.swift` 只使用 UIKit、AVAudioPlayer 和 MediaPlayer，不包含 Biu、Expo、
ActivityKit、视频视图或歌词 PiP。注册播放、暂停、上一首、下一首，开始播放
一段低音量测试音。切歌按钮会改变卡片标题中的编号，便于判断命令是否到达。

2026-09-06，在 Xcode 27 的 iPhone 17 / iOS 26.4 模拟器中，用户和截图均确认：
该样例与 Biu 一样显示卡片和进度，但缺少全部播放控制按钮。
这说明不能单凭 Biu 的界面现象，认定按钮缺失完全由 Biu 的播放器代码造成。

该对照也有明确限制：它同样使用 MediaPlayer 的应用级控制中心，尚不能区分
模拟器运行时、系统媒体界面与该接口路径的问题。需要在另一运行时或真机上对照。

在已启动的 Apple Silicon 模拟器上运行：

```sh
bash run.sh SIMULATOR_UDID
```

脚本用系统 Python 生成测试音，再编译、正常签名并安装样例。
退出样例后，可用 `xcrun simctl uninstall SIMULATOR_UDID com.biuplayer.nowplayingprobe`
删除本次诊断应用。
它仅用于诊断，不属于 Biu 的应用包，也不会修改歌曲、账户或歌单。
