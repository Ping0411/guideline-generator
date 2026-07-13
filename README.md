# SAP Help Assistant

A local AI chat interface for querying SAP Help Portal documentation. Uses a pre-built local cache for fast responses and an on-device semantic search model for accurate multilingual matching.

## Prerequisites

Install the following once before setup. These are standard developer tools.

| Tool | Required version | Download |
|------|-----------------|----------|
| Git | Any recent version | https://git-scm.com/downloads |
| Node.js | v18 or higher | https://nodejs.org |
| Python | 3.8 or higher | https://www.python.org/downloads |

To verify your versions, run these in a terminal:
```
node --version
python3 --version   # macOS / Linux
python --version    # Windows
```

---

## Step 1 — One-time setup (~15 minutes)

Clone the repository and run the setup script. This installs all dependencies and builds the local search index. You only need to do this once.

**macOS / Linux:**
```bash
git clone https://github.tools.sap/I560320/BusinessNetwork-Help-MCP.git
cd BusinessNetwork-Help-MCP
bash setup.sh
```

**Windows** (run in Command Prompt, not PowerShell):
```
git clone https://github.tools.sap/I560320/BusinessNetwork-Help-MCP.git
cd BusinessNetwork-Help-MCP
setup.bat
```

The setup script will:
1. Install Node.js dependencies
2. Install Python dependencies (Flask, ChromaDB, sentence-transformers)
3. Download the AI model (~90 MB) and build the local search index

---

## Step 2 — Launch

**macOS:** Double-click **`Launch SAP Help Assistant.app`**

**Windows:** Double-click **`Launch SAP Help Assistant.vbs`**

The app starts a local server and opens the chat interface in your browser automatically.

> **Tip:** Bookmark `http://localhost:5001` after the first launch. Next time you can open the bookmark directly — as long as the app is already running.

---

## Keeping Up to Date

When the documentation cache is updated, pull the latest changes and rebuild the index:

**macOS / Linux:**
```bash
git pull && bash setup.sh
```

**Windows:**
```
git pull
setup.bat
```

---

## Using with Claude Code (MCP)

If you use Claude Code CLI, you can also register this as an MCP server for direct in-terminal access:

**macOS / Linux:**
```bash
claude mcp add sap-help node /path/to/BusinessNetwork-Help-MCP/index.js
```

**Windows:**
```
claude mcp add sap-help node C:\path\to\BusinessNetwork-Help-MCP\index.js
```

Replace the path with the actual location of your cloned folder (`pwd` on Mac, `cd` on Windows).

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
