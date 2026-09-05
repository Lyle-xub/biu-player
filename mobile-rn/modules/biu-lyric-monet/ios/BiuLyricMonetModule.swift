import ExpoModulesCore
import UIKit

public final class BiuLyricMonetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BiuLyricMonet")

    View(BiuLyricMonetView.self) {
      Prop("text") { (view, value: String) in view.text = value }
      Prop("fontSize") { (view, value: Double) in view.fontSize = CGFloat(value) }
      Prop("lineHeight") { (view, value: Double) in view.lineHeight = CGFloat(value) }
      Prop("padding") { (view, value: Double) in view.glowPadding = CGFloat(value) }
      Prop("tightRadius") { (view, value: Double) in view.tightRadius = CGFloat(value) }
      Prop("wideRadius") { (view, value: Double) in view.wideRadius = CGFloat(value) }
    }
  }
}

public final class BiuLyricMonetView: ExpoView {
  var text = "" { didSet { setNeedsDisplay() } }
  var fontSize: CGFloat = 30 { didSet { setNeedsDisplay() } }
  var lineHeight: CGFloat = 35.4 { didSet { setNeedsDisplay() } }
  var glowPadding: CGFloat = 21.6 { didSet { setNeedsDisplay() } }
  var tightRadius: CGFloat = 8.4 { didSet { setNeedsDisplay() } }
  var wideRadius: CGFloat = 19.5 { didSet { setNeedsDisplay() } }

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isOpaque = false
    backgroundColor = .clear
    clipsToBounds = false
    isUserInteractionEnabled = false
    contentMode = .redraw
  }

  public override func draw(_ rect: CGRect) {
    guard !text.isEmpty, let context = UIGraphicsGetCurrentContext() else { return }
    context.clear(bounds)
    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)

    let font = UIFont.systemFont(ofSize: fontSize, weight: .bold)
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byClipping
    paragraph.alignment = .left
    let attributed = NSAttributedString(string: text, attributes: [
      .font: font,
      .foregroundColor: UIColor.white,
      .paragraphStyle: paragraph,
    ])
    let textRect = CGRect(
      x: glowPadding,
      y: glowPadding + max(0, (lineHeight - font.lineHeight) * 0.5),
      width: max(0, bounds.width - glowPadding * 2),
      height: max(lineHeight, font.lineHeight)
    )
    let options: NSStringDrawingOptions = [.usesLineFragmentOrigin, .usesFontLeading]

    func drawShadow(radius: CGFloat, alpha: CGFloat) {
      context.saveGState()
      context.setShadow(offset: .zero, blur: radius, color: UIColor.white.withAlphaComponent(alpha).cgColor)
      attributed.draw(with: textRect, options: options, context: nil)
      context.restoreGState()
    }

    // Folia glowShadow: a broad lingering halo under a sharper inner halo.
    drawShadow(radius: wideRadius, alpha: 0.48)
    drawShadow(radius: tightRadius, alpha: 0.92)

    // The React Native base text and glyph sweep own the fill. Remove the source
    // glyphs from this isolated transparent layer so only their continuous halo remains.
    context.saveGState()
    context.setBlendMode(.clear)
    attributed.draw(with: textRect, options: options, context: nil)
    context.restoreGState()
  }
}
