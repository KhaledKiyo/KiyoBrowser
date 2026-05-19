# 🌌 KiyoBrowser

[![Version](https://img.shields.io/badge/version-1.0.1--BETA-blueviolet?style=for-the-badge)](https://github.com/KhaledKiyo/KiyoBrowser/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-42.0.1-47848F?style=for-the-badge&logo=electron)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/platform-Arch%20Linux-1793D1?style=for-the-badge&logo=arch-linux)](https://archlinux.org/)

> A modern, design-first browser built with Electron — crafted for people who care about how their tools look, feel, and protect their privacy.

---

## 🌟 Why KiyoBrowser?

Most browsers prioritize raw features over aesthetics or bloat their codebase with telemetry. KiyoBrowser takes a different approach:
- **Design-First UI:** A beautiful, responsive glassmorphism interface featuring dynamic chameleon UI elements that adapt to your browsing.
- **Privacy & Security Centric:** A custom-built, enterprise-grade Privacy Shield that blocks trackers and unmasks CNAME cloaking, alongside a locally encrypted AES-256 password vault.
- **Architected for Speed:** Employs an ultra-fast $O(1)$ Trigram Indexing Adblock engine, heavily throttled GPU animations, and memory-saving tab sleeping capabilities.

> ⚠️ **This is a BETA release.** Built and tested primarily on **Arch Linux**.

---

## ✨ Key Features

- 🎨 **Chameleon & Custom Theming:** Switch between curated design tokens dynamically across all internal pages. The browser ambient glow adapts to the active tab's favicon color.
- 🛡️ **Advanced Ad & Privacy Shield:** High-performance request interception powered by a **Trigram Indexing Engine** capable of sorting 12,000+ rules in $O(1)$ time, plus CNAME heuristic unmasking.
- 🔒 **Encrypted Password Manager:** Built-in AES-256 local vault. Automatically captures credentials securely and auto-fills them for you.
- 💤 **Tab Sleeping & Memory Management:** Inactive tabs gracefully "hibernate" to free up RAM and CPU cycles, waking up instantly when needed.
- 📚 **Tab Groups & Reader Mode:** Organize your workspace with color-coded, collapsible tab groups. Strip away clutter on news sites with a distraction-free Reader Mode.
- 🕵️ **Private Windows:** Fully isolated partition sessions that leave no trace, featuring strict Preload Isolation for web content.
- 🔍 **Advanced Navigation:** Live URL autocomplete with integrated search engine suggestions and localized history/bookmark search.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + T` | New Tab |
| `Ctrl + Shift + N` | New Private Window |
| `Ctrl + W` | Close current tab |
| `Ctrl + L` | Focus address bar |
| `Ctrl + R` | Reload page |
| `Ctrl + Shift + R` | Toggle Reader Mode |
| `Ctrl + F` | Find in page |
| `Ctrl + Shift + K` | Tab Search (Spotlight) |
| `Ctrl + Shift + P` | Open Password Manager |
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
- **Preload Security Isolation**: Web content is sandboxed with a strictly scoped `content-preload.js`, ensuring web pages cannot access privileged IPC shell commands or vault data.
- **State Management**: Centralized Main process state (`windows`, `views`, `settings`) synchronized to renderers via rapid, debounced delta-like updates.
- **Resource Optimization**: Unthrottled mouse movements and GPU-heavy `filter: blur()` animations are explicitly throttled or baked to keep idle CPU/GPU usage at 0%.

---

## 📄 License

Distributed under the [MIT License](LICENSE).

---

<p align="center">Made with ❤️ by <a href="https://github.com/KhaledKiyo">KhaledKiyo</a></p>
