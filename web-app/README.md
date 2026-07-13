# SAP Help Assistant — Web Interface

A local AI chat interface for querying SAP Business Network documentation. Runs entirely on your machine — no data leaves your computer except the API call to your AI service.

## Prerequisites

Install the following once. These are standard tools available on all platforms.

| Tool | Required version | Download |
|------|-----------------|----------|
| Git | Any recent version | https://git-scm.com/downloads |
| Node.js | v18 or higher | https://nodejs.org |
| Python | 3.8 or higher | https://www.python.org/downloads |

To verify, open a terminal and run:
```
node --version
python3 --version   # macOS / Linux
python --version    # Windows
```

If any command says "not found", install that tool first.

You also need a **Hyperspace AI API Key and Base URL** — available from [Hyperspace AI](https://ai-docs.portal.hyperspace.tools.sap/). You will enter these in the web interface when you first use it.

---

## Step 1 — One-time setup (~15 minutes)

Open a terminal, then run the following commands.

**macOS / Linux:**
```bash
git clone https://github.tools.sap/I560320/BusinessNetwork-Help-MCP.git
cd BusinessNetwork-Help-MCP
bash setup.sh
```

**Windows** — open Command Prompt (not PowerShell), then run:
```
git clone https://github.tools.sap/I560320/BusinessNetwork-Help-MCP.git
cd BusinessNetwork-Help-MCP
setup.bat
```

The setup script will:
1. Check that Node.js and Python are installed correctly
2. Install all Node.js and Python dependencies
3. Download the AI model (~90 MB) and build the local search index

This takes about 15 minutes on the first run. You will see progress messages throughout. When finished, you will see **"Setup complete!"**

---

## Step 2 — Launch

After setup, open the `BusinessNetwork-Help-MCP` folder. You will find the launch files there.

**macOS:** Double-click **`Launch SAP Help Assistant.app`**

**Windows:** Double-click **`Launch SAP Help Assistant.vbs`**

The app starts a local server and opens the chat interface in your browser automatically at `http://localhost:5001`.

> **Tip:** Bookmark `http://localhost:5001` after the first launch. On future sessions, double-click the launch file first, then open the bookmark — you do not need to go back to the folder every time.

---

## Using the Web Interface

1. Enter your **Base URL** and **API Key** in the fields at the top (from Hyperspace AI — you only need to do this once, they are saved in your browser)
2. Type your question and press **Enter** or click **Send**
3. Use the **📎** button (or drag-and-drop, or paste) to attach files — supported: images, text, CSV, XML, cXML, JSON, RTF, PDF, Word, Excel
4. Use the **Classic / Semantic** toggle to switch search modes:
   - **Classic**: keyword matching — fast, works well for exact terms
   - **Semantic**: AI-powered meaning matching — better for natural language questions and non-English queries (Chinese, Japanese)
5. Use **Clear** to start a new conversation

---

## Keeping Up to Date

Run the update script from inside the `BusinessNetwork-Help-MCP` folder.

**macOS / Linux:**
```bash
bash update.sh
```

**Windows:**
```
update.bat
```

The update script runs `git pull` and then checks whether the documentation cache has changed. If it has, it rebuilds the search index (about 1-2 minutes). If only the web interface was updated, it skips the rebuild and finishes immediately.

There is no automatic notification when updates are available. It is recommended to run the update script once a month or once a quarter to stay current.

---

## Notes

- The app runs entirely on your machine — your API key is stored only in your browser and is never shared
- Documentation content is bundled in `cache.json` — no internet access needed for searching
- The vector search index (`chroma_db/`) is built locally from `cache.json`
- Supports questions in English, Chinese, and Japanese
