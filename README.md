# SAP Help Assistant

A local AI chat interface for querying SAP Help Portal documentation. Uses a pre-built local cache for fast responses and an on-device semantic search model for accurate multilingual matching.

## Prerequisites

Install the following once before setup. These are standard developer tools.

| Tool | Required version | Download |
|------|-----------------|----------|
| Git | Any recent version | https://git-scm.com/downloads |
| Node.js | v18 or higher | https://nodejs.org |
| Python | 3.8 or higher | https://www.python.org/downloads |

To verify your versions, open a terminal and run:
```
node --version
python3 --version   # macOS / Linux
python --version    # Windows
```

If any command says "not found", install that tool first before continuing.

---

## Step 1 — One-time setup (~15 minutes)

Open a terminal, then copy and run the following commands.

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

The setup script installs all dependencies and builds the local search index. It takes about 15 minutes on the first run — mostly downloading the AI model (~90 MB). You will see progress messages throughout. When it finishes, you will see "Setup complete!"

---

## Step 2 — Launch

After setup completes, open the folder you just cloned (`BusinessNetwork-Help-MCP`). You will find the launch files there.

**macOS:** Double-click **`Launch SAP Help Assistant.app`**

**Windows:** Double-click **`Launch SAP Help Assistant.vbs`**

The app starts a local server and opens the chat interface in your browser automatically at `http://localhost:5001`.

> **Tip:** After the browser opens, bookmark `http://localhost:5001`. On future sessions, just double-click the launch file first, then use the bookmark — you do not need to go back to the folder every time.

---

## Keeping Up to Date

Updates fall into two types. Run the appropriate command from inside the `BusinessNetwork-Help-MCP` folder.

**Type A — Documentation update** (new documents added, search index changed):

macOS / Linux:
```bash
git pull
bash setup.sh
```

Windows:
```
git pull
setup.bat
```

This takes about 1-2 minutes (model is already downloaded, only the index is rebuilt).

**Type B — Interface or feature update** (web page design, bug fixes, no new documents):

macOS / Linux:
```bash
git pull
```

Windows:
```
git pull
```

That's it. No rebuild needed — just relaunch the app.

The release notes will tell you which type each update is.

---

## Using with Claude Code (MCP)

If you use Claude Code CLI, you can also register this as an MCP server for direct in-terminal access.

First find your folder path: run `pwd` (macOS) or `cd` (Windows) inside the `BusinessNetwork-Help-MCP` folder.

**macOS / Linux:**
```bash
claude mcp add sap-help node /your/path/to/BusinessNetwork-Help-MCP/index.js
```

**Windows:**
```
claude mcp add sap-help node C:\your\path\to\BusinessNetwork-Help-MCP\index.js
```

---

## Covered Documentation

- SAP Business Network — Buyer Administration (Transaction Rules, Invoice Rules)
- SAP Business Network — Supplier Administration
- SAP Business Network — Guide to Invoicing
- SAP Business Network — Freight Collaboration (BNL)
- SAP Business Network — Global Track and Trace (GTT)
- cXML Solutions Guide and Reference Guide
- CIG and SBN Overview (SAP ERP / S/4HANA integration)
- Test Central guides (buyer and supplier)
- EDI guides — ANSI X12 and EDIFACT
- And more — see `doc-sources.json` for the full list
