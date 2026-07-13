# SAP Help Assistant — Web Interface

A local AI chat interface for querying SAP Business Network documentation. Runs entirely on your machine — no data leaves your computer except the API call to your AI service.

---

## Prerequisites

Install the following once before getting started.

| Tool | Required version | Download |
|------|-----------------|----------|
| Git | Any recent version | https://git-scm.com/downloads |
| Node.js | v18 or higher | https://nodejs.org |
| Python | 3.8 or higher | https://www.python.org/downloads |

To verify, open a terminal and run `node --version` and `python3 --version` (Mac) or `python --version` (Windows). If any command says "not found", install that tool first.

You also need a **Hyperspace AI API Key and Base URL** — available from [Hyperspace AI](https://ai-docs.portal.hyperspace.tools.sap/). You will enter these in the web interface the first time you use it; they are saved automatically in your browser after that.

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

Open the `BusinessNetwork-Help-MCP` folder and double-click the launch file:

- **macOS:** `Launch SAP Help Assistant.app`
- **Windows:** `Launch SAP Help Assistant.vbs`

The browser opens automatically at `http://localhost:5001`.

> **Tip:** Bookmark `http://localhost:5001`. Next time, just double-click the launch file and then open the bookmark — no need to go back to the folder.

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
