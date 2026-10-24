import Cocoa
import Darwin
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private let platforms = ["900", "uu", "c5", "buff"]
    private let saveLock = NSLock()
    private var window: NSWindow!
    private var webView: WKWebView!
    private var robotFileURL: URL?

    func applicationDidFinishLaunching(_ notification: Notification) {
        installEditMenu()
        let content = WKUserContentController()
        content.add(self, name: "copy")
        content.add(self, name: "save")
        if let source = loadRobotSource() {
            let script = WKUserScript(
                source: "window.ROBOT_SOURCE = \(source);",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            content.addUserScript(script)
        }

        let config = WKWebViewConfiguration()
        config.userContentController = content

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1240, height: 780),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Steam 机器人"
        window.minSize = NSSize(width: 980, height: 560)
        window.delegate = self
        window.center()

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        if #available(macOS 12.0, *) {
            webView.underPageBackgroundColor = NSColor(srgbRed: 0.953, green: 0.937, blue: 0.902, alpha: 1)
        }
        window.contentView?.addSubview(webView)

        guard let html = Bundle.main.url(forResource: "index", withExtension: "html") else {
            fail("找不到页面文件")
            return
        }
        webView.loadFileURL(html, allowingReadAccessTo: html.deletingLastPathComponent())
        window.makeFirstResponder(webView)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func installEditMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "退出 Steam 机器人", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editItem = NSMenuItem()
        editItem.title = "编辑"
        main.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        NSApp.mainMenu = main
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func windowWillClose(_ notification: Notification) {
        NSApp.terminate(nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "copy", let text = message.body as? String {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(text, forType: .string)
            return
        }
        if message.name == "save", let body = message.body as? [String: Any] {
            let id = (body["id"] as? NSNumber)?.intValue ?? 0
            let tags = body["tags"] as? [String] ?? []
            let remark = body["remark"] as? String ?? ""
            saveMeta(id: id, tags: tags, remark: remark)
        }
    }

    private func besideAppFile() -> URL {
        Bundle.main.bundleURL
            .deletingLastPathComponent()
            .appendingPathComponent("data/steam-bot-management.json")
    }

    private func loadRobotSource() -> String? {
        let besideApp = besideAppFile()
        let bundled = Bundle.main.url(forResource: "steam-bot-management", withExtension: "json")
        let url = FileManager.default.fileExists(atPath: besideApp.path) ? besideApp : bundled
        guard let url, let text = try? String(contentsOf: url, encoding: .utf8) else {
            fail("找不到 steam-bot-management.json")
            return nil
        }
        robotFileURL = url
        return text
    }

    private func saveMeta(id: Int, tags: [String], remark: String) {
        let cleanTags = platforms.filter { tags.contains($0) }
        saveLock.lock()
        defer { saveLock.unlock() }
        let target = besideAppFile()
        let lockFd = open(target.deletingLastPathComponent().appendingPathComponent(".write.lock").path, O_CREAT | O_RDWR, 0o644)
        if lockFd >= 0 {
            flock(lockFd, LOCK_EX)
        }
        defer {
            if lockFd >= 0 {
                flock(lockFd, LOCK_UN)
                close(lockFd)
            }
        }
        let source = FileManager.default.fileExists(atPath: target.path) ? target : robotFileURL
        guard let source,
              let data = try? Data(contentsOf: source),
              let object = try? JSONSerialization.jsonObject(with: data),
              var rows = object as? [[String: Any]] else {
            warn("读不到账号文件，标记没有写入")
            return
        }
        guard let index = rows.firstIndex(where: { ($0["id"] as? NSNumber)?.intValue == id }) else { return }
        rows[index]["tags"] = cleanTags
        rows[index]["remark"] = remark
        do {
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            let text = jsonText(rows)
            let temporary = target.deletingLastPathComponent().appendingPathComponent(".steam-bot-management.json.tmp")
            try text.write(to: temporary, atomically: true, encoding: .utf8)
            _ = try FileManager.default.replaceItemAt(target, withItemAt: temporary)
            robotFileURL = target
        } catch {
            warn("标记没有写入：\(error.localizedDescription)")
        }
    }

    private func jsonText(_ rows: [[String: Any]]) -> String {
        var lines = ["["]
        for (index, row) in rows.enumerated() {
            let id = (row["id"] as? NSNumber)?.intValue ?? 0
            let isUsed = (row["is_used"] as? NSNumber)?.intValue ?? 0
            let tags = (row["tags"] as? [String] ?? []).map { jsonString($0) }.joined(separator: ", ")
            let comma = index == rows.count - 1 ? "" : ","
            lines.append("  {")
            lines.append("    \"id\": \(id),")
            lines.append("    \"steam_account\": \(jsonString(row["steam_account"] as? String ?? "")),")
            lines.append("    \"pass_word\": \(jsonString(row["pass_word"] as? String ?? "")),")
            lines.append("    \"shared_secret\": \(jsonString(row["shared_secret"] as? String ?? "")),")
            lines.append("    \"is_used\": \(isUsed),")
            lines.append("    \"update_time\": \(jsonString(row["update_time"] as? String ?? "")),")
            lines.append("    \"tags\": [\(tags)],")
            lines.append("    \"remark\": \(jsonString(row["remark"] as? String ?? "")),")
            lines.append("    \"steam_id\": \(jsonString(row["steam_id"] as? String ?? "")),")
            lines.append("    \"persona_name\": \(jsonString(row["persona_name"] as? String ?? ""))")
            lines.append("  }\(comma)")
        }
        lines.append("]")
        return lines.joined(separator: "\n") + "\n"
    }

    private func jsonString(_ value: String) -> String {
        var out = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\\":
                out += "\\\\"
            case "\"":
                out += "\\\""
            case "\n":
                out += "\\n"
            case "\r":
                out += "\\r"
            case "\t":
                out += "\\t"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
        return out
    }

    private func warn(_ message: String) {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = "没保存上"
            alert.informativeText = message
            alert.runModal()
        }
    }

    private func fail(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "打不开"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
