# Biu Player

基于 B 站公开接口的桌面音乐播放器（Electron）。沉浸式暗色设计，封面取色驱动背景。

> 非官方项目，仅供学习与研究使用，与哔哩哔哩无任何官方关联。
> 核心接口思路参考了 [wood3n/biu](https://github.com/wood3n/biu) 与
> [SocialSisterYi/bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)。
> 歌词层级与转场动效思路参考了 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major) 的 Monet 视觉模式。

## 运行

```bash
npm install   # 若 electron 二进制缺失：cd node_modules/electron && node install.js
npm start     # electron .
npm run check # 检查主进程、preload 与渲染层语法
```

也可以直接用浏览器打开 `renderer/index.html` 预览界面（无 window.bili 桥时自动降级为 mock 数据，不能播放）。

## 功能

- **歌单库**：「我喜欢」本地收藏 + B 站音乐区实时热榜（ranking/v2, rid=3）
- **B 站登录**：应用内扫码登录，或打开 B 站官方手机验证码页；Cookie 仅保存在 Electron 会话中
- **收藏夹**：登录后自动同步 B 站收藏夹，可直接播放
- **电台**：音乐电台直播列表，点击即播放 HLS 直播流（内置 hls.js），整列表进入队列可连续切台
- **搜索**：视频搜索（过滤 ≤60s 短视频），单曲 / 歌单 / UP 主 / 视频分区筛选
- **播放页**
  - 歌词模式：B 站 AI 字幕转时间轴歌词，莫奈风格扫光、层级缩放与柔化过渡，点击歌词跳转
  - 原视频模式：直接播放 B 站音视频合一 MP4 流，支持弹幕、清晰度、与音频模式无缝续播
  - 热评胶囊 + 热门评论列表、播放/弹幕/点赞/投币/收藏统计
  - 封面取色驱动沉浸式背景
- **播放控制**：播放/暂停、上一首/下一首、音量（持久化）、列表循环/单曲循环/随机播放
- **切换动效**：页面前后层滑动、模糊和缩放过渡，播放页歌词/视频模式柔和切换，支持系统「减少动态效果」
- **设置**（全部真实生效，localStorage 持久化）
  - 在线音质：标准 / 高品 / 无损（无损优先 DASH FLAC 通道，需登录/大会员）
  - 视频清晰度、弹幕开关、背景模糊度
  - 桌面歌词：置顶悬浮窗，实时同步当前歌词行
- **快捷键**：`1/2/3/4` 切视图 · `空格` 播放暂停 · `←/→` 快退/快进 5s · `↑/↓` 音量 · `Esc` 关面板

## 架构

```
main.js        主进程：UA/Referer 伪装、buvid3 风控、WBI 签名、CDN 请求头注入、
               扫码/验证码登录与 Cookie 管理、图片代理、桌面歌词窗口
preload.js     渲染层桥：window.bili.{get,image,auth*,win*,lyric*}
lyric.html     桌面歌词悬浮窗（transparent + alwaysOnTop）
renderer/
  api.js       B 站接口封装；无桥时降级 mock 数据
  app.js       全部交互逻辑与播放状态
  vendor/hls.min.js  直播 HLS 播放
```

## 接口要点

- 播放地址主用 `x/player/wbi/playurl`（WBI 签名，`fnval=16` 取 DASH），
  失败降级 `x/player/playurl` → `x/web-interface/playurl`；优先选 DASH 音频流
- 扫码登录使用 `x/passport-login/web/qrcode/generate` + `poll`，手机验证码由 B 站官方页完成
- 歌词来自 `x/player/v2` 的 AI 字幕（`subtitle_url`），无字幕的稿件显示提示
- 原视频使用 `platform=html5&fnval=1` 请求音视频合一 MP4，由本地 `<video>` 直接播放
- 直播流用 `live.bilibili.com/room/v1/playUrl/playUrl`（platform=h5 → m3u8）
- 发往 `bilivideo.com / bilivideo.cn / hdslb.com / acgvideo.com` 的请求统一补
  Referer/UA，否则 CDN 返回 403

## 已知限制

- 「跟随系统主题」未实现：本设计为深色沉浸式，无亮色主题
- 无损/高码率音频受 B 站登录与大会员权限限制
- **歌词（AI 字幕）通常需登录后才可获取**，且并非所有稿件都有；
  时间轴为 AI 生成，可能与实际演唱略有偏差
- HTML5 原视频流的实际清晰度受稿件、登录和大会员权限影响，接口会自动回退到可播档位
- UP 主关注、B 站点赞等写操作未接入（需 CSRF 与完整登录态）
