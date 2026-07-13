# SAP Help Assistant — Web Interface

A local AI chat interface for querying SAP Business Network documentation. Runs entirely on your machine — no data leaves your computer except the API call to your AI service.

---

## Prerequisites

Run all commands below in a terminal — **macOS:** Terminal, **Windows:** Command Prompt (not PowerShell).

Two things are required before you begin:

**1. Git** — needed to download the project.

| | Verification command | Install if missing |
|-|----------------------|--------------------|
| **Git** (required) | `git --version` | **macOS:** `xcode-select --install` |
| | | **Windows:** `winget install Git.Git` |

> **macOS:** If you don't have Homebrew, the setup script installs it automatically. Node.js and Python are also installed automatically — you do not need to install them manually.

After installing Git, close and **reopen** your terminal before continuing.

**2. Hyperspace AI API Key and Base URL** — needed to power the chat. Available from [Hyperspace AI](https://ai-docs.portal.hyperspace.tools.sap/). You will enter these in the web interface the first time you use it; they are saved automatically in your browser after that.

---

## Step 1 — One-time setup (~15 minutes)

Open a terminal and run:

```
git clone https://github.tools.sap/I560320/BusinessNetwork-Help-MCP.git
cd BusinessNetwork-Help-MCP
```

Then run the setup script:
- **macOS:** `bash setup.sh`
- **Windows:** open Command Prompt (not PowerShell), then run `setup.bat`

The script installs all dependencies and builds the local search index. It takes about 15 minutes on the first run. When finished, you will see **"Setup complete!"**

---

## Step 2 — Launch

The folder is created in your current terminal directory — typically `/Users/yourname/BusinessNetwork-Help-MCP` on macOS or `C:\Users\yourname\BusinessNetwork-Help-MCP` on Windows. Run `pwd` (macOS) or `cd` (Windows) to confirm the exact path. The folder can be moved anywhere on your machine at any time without affecting the app.

Open the `BusinessNetwork-Help-MCP` folder and double-click the launch file:

- **macOS:** `Launch SAP Help Assistant.app`
- **Windows:** `Launch SAP Help Assistant.vbs`

The browser opens automatically at `http://localhost:5001`.

> **Tip:** You can create a shortcut on your desktop — right-click the file and choose **Make Alias** (macOS) or **Send to → Desktop (create shortcut)** (Windows). Do not copy the file itself to the desktop, as it needs to stay in the project folder to work correctly.

---

## Using the Web Interface

1. Enter your **Base URL** and **API Key** at the top (first time only — saved automatically after that)
2. Type your question and press **Enter** or click **Send**
3. Use the **📎** button (or drag-and-drop, or paste) to attach files — supported formats: images, text, CSV, XML, cXML, JSON, RTF, PDF, Word, Excel
4. Use the **Classic / Semantic** toggle to switch search modes:
   - **Classic**: keyword matching — fast, works well for exact terms
   - **Semantic**: AI-powered meaning matching — better for natural language and non-English queries (Chinese, Japanese)
5. Use **Clear** to start a new conversation

---

## Keeping Up to Date

There are no automatic notifications. It is recommended to run the update script once a month or once a quarter.

From inside the `BusinessNetwork-Help-MCP` folder, run:
- **macOS:** `bash update.sh`
- **Windows:** double-click `update.bat`

The script pulls the latest changes and rebuilds the search index only if new documents were added. If it was a web interface update only, it finishes in seconds.

---

## Notes

- The app runs entirely on your machine — your API key is stored only in your browser and is never shared
- Documentation content is bundled in `cache.json` — no internet access needed for searching
- Supports questions in English, Chinese, and Japanese
