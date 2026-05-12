# 🌌 KiyoBrowser

[![Version](https://img.shields.io/badge/version-1.0.0--BETA-blueviolet?style=for-the-badge)](https://github.com/KhaledKiyo/KiyoBrowser/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-31.7.7-47848F?style=for-the-badge&logo=electron)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/platform-Arch%20Linux-1793D1?style=for-the-badge&logo=arch-linux)](https://archlinux.org/)
[![Status](https://img.shields.io/badge/status-BETA-orange?style=for-the-badge)]()

> A modern, design-first browser built with Electron — crafted for Arch Linux, for people who care about how their tools look and feel.

---

## Why KiyoBrowser?

Most browsers prioritize features over aesthetics, leaving you stuck with Chrome's dated interface or Brave's utilitarian design. KiyoBrowser takes the opposite approach — a beautiful, glassmorphism UI with a focus on customization over convention.

> ⚠️ **This is a BETA release.** Expect rough edges. Built and tested primarily on **Arch Linux**. Runs on Windows but has not been fully tested there.

---

## ✨ Features

- 🎨 **Design-first UI** — Modern glassmorphism aesthetic built to replace the tired look of classic browsers
- 🎭 **Dynamic Themes** — Switch between **Zenith**, **Aurora**, **Neon**, and **Classic** themes on the fly (`Ctrl+J`)
- 🛡️ **Built-in Ad Blocker** — High-performance request interception powered by [Ghostery](https://github.com/ghostery/adblocker)
- 📚 **Persistent History & Bookmarks** — Data stored reliably via SQLite
- 📥 **Download Manager** — Non-intrusive toast notifications with real-time download progress
- 🗂️ **Multi-tab Browsing** — Smooth tab workflow with keyboard shortcuts

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/KhaledKiyo/KiyoBrowser.git
cd KiyoBrowser

# 2. Install dependencies
npm install

# 3. Launch the browser
npm start
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + T` | New tab |
| `Ctrl + W` | Close tab |
| `Ctrl + L` | Focus address bar |
| `Ctrl + J` | Cycle themes |
| `Ctrl + H` | Toggle history / settings panel |

---

## 🖥️ Platform Support

| Platform | Status |
|---|---|
| Arch Linux | ✅ Fully supported |
| Other Linux distros | ✅ Should work |
| Windows | ⚠️ Runs, not fully tested |
| macOS | ❓ Untested |

---

## 🛠️ Tech Stack

- **[Electron](https://www.electronjs.org/)** — Cross-platform desktop framework
- **[Ghostery Adblocker](https://github.com/ghostery/adblocker)** — Ad and tracker blocking engine
- **SQLite** — Lightweight local database for history and bookmarks

---

## 🗺️ Roadmap

This is a BETA. Planned for future releases:

- [ ] Settings page UI
- [ ] More theme options
- [ ] Extension support
- [ ] Better Windows compatibility
- [ ] Stable `1.0.0` release

---

## 📄 License

Distributed under the [MIT License](LICENSE).

---

<p align="center">Made with ❤️ by <a href="https://github.com/KhaledKiyo">KhaledKiyo</a></p>
