const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SOURCE = `import WidgetKit
import SwiftUI
import ActivityKit
internal import ExpoWidgets

private let biuWidgetGroup = "group.com.biuplayer.mobile"
private let biuWidgetTimelineKey = "__expo_widgets_LyricsWidget_timeline"

private struct LyricsEntry: TimelineEntry {
  let date: Date
  let title: String
  let artist: String
  let currentLine: String
  let nextLine: String

  static let placeholder = LyricsEntry(
    date: .now,
    title: "Biu Player",
    artist: "",
    currentLine: "让音乐继续流动",
    nextLine: "播放歌曲后歌词会在这里更新"
  )
}

private struct LyricsTimelineProvider: TimelineProvider {
  func placeholder(in context: Context) -> LyricsEntry { .placeholder }

  func getSnapshot(in context: Context, completion: @escaping (LyricsEntry) -> Void) {
    completion(loadEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LyricsEntry>) -> Void) {
    let entry = loadEntry()
    completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(60))))
  }

  private func loadEntry() -> LyricsEntry {
    let props: [String: Any]?
    if #available(iOS 16.1, *),
       let activity = Activity<LiveActivityAttributes>.activities.first,
       let data = activity.content.state.props.data(using: .utf8) {
      props = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    } else if let defaults = UserDefaults(suiteName: biuWidgetGroup),
              let timeline = defaults.array(forKey: biuWidgetTimelineKey) as? [[String: Any]] {
      props = timeline.last?["props"] as? [String: Any]
    } else {
      props = nil
    }
    guard let props else {
      return .placeholder
    }
    func text(_ key: String) -> String { props[key] as? String ?? "" }
    return LyricsEntry(
      date: .now,
      title: text("title").isEmpty ? "Biu Player" : text("title"),
      artist: text("artist"),
      currentLine: text("currentLine").isEmpty ? "纯音乐 / 暂无歌词" : text("currentLine"),
      nextLine: text("nextLine")
    )
  }
}

private struct LyricsWidgetView: View {
  @Environment(\\.widgetFamily) private var family
  let entry: LyricsEntry

  @ViewBuilder
  var body: some View {
    if #available(iOS 17.0, *) {
      content.containerBackground(for: .widget) { widgetBackground }
    } else {
      content.background(widgetBackground)
    }
  }

  @ViewBuilder
  private var content: some View {
    Group {
      if family == .accessoryRectangular {
        VStack(alignment: .leading, spacing: 3) {
          Text(entry.title).font(.caption2.weight(.semibold)).lineLimit(1)
          Text(entry.currentLine).font(.caption.weight(.bold)).lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      } else {
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 7) {
            Image(systemName: "music.note")
              .foregroundStyle(Color(red: 251 / 255, green: 114 / 255, blue: 153 / 255))
            Text(entry.title)
              .font(.system(size: 12, weight: .semibold, design: .rounded))
              .foregroundStyle(.white)
              .lineLimit(1)
            Spacer(minLength: 6)
            Text(entry.artist)
              .font(.system(size: 10, weight: .medium))
              .foregroundStyle(Color.white.opacity(0.62))
              .lineLimit(1)
          }
          Text(entry.currentLine)
            .font(.system(size: 19, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(2)
          if !entry.nextLine.isEmpty {
            Text(entry.nextLine)
              .font(.system(size: 13, weight: .medium, design: .rounded))
              .foregroundStyle(Color.white.opacity(0.58))
              .lineLimit(1)
          }
        }
        .padding(15)
      }
    }
  }

  private var widgetBackground: some View {
    LinearGradient(
      colors: [
        Color(red: 55 / 255, green: 39 / 255, blue: 45 / 255),
        Color(red: 27 / 255, green: 32 / 255, blue: 24 / 255),
        Color(red: 12 / 255, green: 15 / 255, blue: 10 / 255)
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }
}

struct LyricsWidget: Widget {
  let name = "LyricsWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: name, provider: LyricsTimelineProvider()) { entry in
      LyricsWidgetView(entry: entry)
    }
    .configurationDisplayName("Biu 桌面歌词")
    .description("显示当前播放歌曲与歌词")
    .supportedFamilies([.systemMedium, .accessoryRectangular])
    .contentMarginsDisabled()
  }
}
`;

module.exports = function withBiuLyricsWidgets(config) {
  return withDangerousMod(config, ['ios', async (modConfig) => {
    const targetDir = path.join(modConfig.modRequest.platformProjectRoot, 'ExpoWidgetsTarget');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'LyricsWidget.swift'), SOURCE);
    return modConfig;
  }]);
};
