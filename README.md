# 🌌 KiyoBrowser

[![Version](https://img.shields.io/badge/version-1.0.1--BETA-blueviolet?style=for-the-badge)](https://github.com/KhaledKiyo/KiyoBrowser/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-41.0.1-47848F?style=for-the-badge&logo=electron)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/platform-Arch%20Linux-1793D1?style=for-the-badge&logo=arch-linux)](https://archlinux.org/)

> A modern, design-first browser built with Electron — crafted for people who care about how their tools look, feel, and protect their privacy.

---

## 🌟 Why KiyoBrowser?

Most browsers prioritize raw features over aesthetics or bloat their codebase with telemetry. KiyoBrowser takes a different approach:
- **Design-First UI:** A beautiful, responsive glassmorphism interface with highly interactive elements.
- **Privacy-Centric:** A custom-built, enterprise-grade Privacy Shield that blocks trackers, unmasks CNAME cloaking, and strips out cosmetic ads.
- **Lightweight Architecture:** No SQLite dependencies or heavy external modules. State is managed via fast, debounced JSON persistence and scoped DOM updates.

> ⚠️ **This is a BETA release.** Built and tested primarily on **Arch Linux**.

---

## ✨ Key Features

- 🎨 **Unified Theming:** Switch between curated design tokens and custom themes dynamically across all internal pages.
- 🛡️ **Kiyo Privacy Shield:** High-performance request interception, CNAME heuristic unmasking, and dynamic cosmetic CSS filtering.
- 🕵️ **Private Windows:** Fully isolated partition sessions that leave no trace.
- 🔍 **Advanced Navigation:** Live URL autocomplete with integrated search engine suggestions and localized history/bookmark search.
- 🚀 **Performance Optimized:** surgical DOM patching for heavy lists (Bookmarks/History) and debounced disk writes to minimize I/O overhead.
- 📌 **Built-in Tools:** Integrated Find-in-page, Zoom controls, Download Manager, and a quick-access Note app (`kiyo://note`).

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + T` | New Tab |
| `Ctrl + Shift + N` | New Private Window |
| `Ctrl + W` | Close current tab |
| `Ctrl + L` | Focus address bar |
| `Ctrl + R` | Reload page |
| `Ctrl + F` | Find in page |
| `Ctrl + = / - / 0` | Zoom In / Out / Reset |
| `Ctrl + B` | Open Bookmarks |
| `Ctrl + H` | Open History |
| `Ctrl + Shift + J` | Open Downloads |
| `Ctrl + ,` | Open Settings |

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

## 🛠️ Architecture

- **Electron Core**: Multi-process architecture using `WebContentsView` for secure tab isolation.
- **IPC Bridge**: Strongly typed, context-isolated Preload scripts for safe Main-to-Renderer communication.
- **State Management**: Centralized Main process state (`windows`, `views`, `settings`) synchronized to renderers via IPC events.

---

## 📄 License

Distributed under the [MIT License](LICENSE).

---

<p align="center">Made with ❤️ by <a href="https://github.com/KhaledKiyo">KhaledKiyo</a></p>
