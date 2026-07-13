# SAP Help Assistant

A local AI assistant for querying SAP Business Network documentation. Two versions are available — choose the one that fits your workflow:

| Version | Best for | Setup guide |
|---------|----------|-------------|
| **Web Interface** | General users — chat in a browser, no coding required | [web-app/README.md](web-app/README.md) |
| **Claude Code MCP** | Claude Code CLI users — query SAP docs directly from the terminal | See below |

---

## Claude Code MCP Version

### Prerequisites

All three tools must be installed before you begin.

**Step 1 — Check what you already have**

Run these commands in your terminal. If a version number appears, that tool is already installed.

| Tool | Verification command | Requirement |
|------|----------------------|-------------|
| Git | `git --version` | Any version |
| Node.js | `node --version` | v18 or higher |
| Python | `python3 --version` (Mac) / `python --version` (Windows) | 3.8 or higher |

**Step 2 — Install anything missing**

**macOS:**

| Tool | Install command |
|------|----------------|
| Git | `xcode-select --install` |
| Node.js | `brew install node@20` |
| Python | `brew install python` |

> If you don't have Homebrew, install it first:
> ```bash
> /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
> ```

**Windows** — open Command Prompt and run:

| Tool | Install command |
|------|----------------|
| Git | `winget install Git.Git` |
| Node.js | `winget install OpenJS.NodeJS.LTS` |
| Python | `winget install Python.Python.3` |

After installing any tool, close and reopen your terminal before continuing.

---

### Installation

**Step 1 — Clone the repository**

```
git clone https://github.tools.sap/I560320/BusinessNetwork-Help-MCP.git
cd BusinessNetwork-Help-MCP
```

**Step 2 — Install Node.js dependencies**

```
npm install
```

**Step 3 — Install Python dependencies**

macOS:
```bash
pip3 install chromadb sentence-transformers
```

Windows:
```
pip install chromadb sentence-transformers
```

**Step 4 — Build the semantic search index**

macOS:
```bash
python3 build_index.py
```

Windows:
```
python build_index.py
```

This downloads the AI model (~90 MB) and builds a local search index from the documentation cache. It runs entirely offline after the first download and takes about 10–15 minutes on first run.

**Step 5 — Find your folder path**

You need the full path to the cloned folder for the next step.

macOS: run `pwd`
Windows: run `cd`

Copy the output. For example:
- macOS: `/Users/yourname/BusinessNetwork-Help-MCP`
- Windows: `C:\Users\yourname\BusinessNetwork-Help-MCP`

**Step 6 — Register the MCP server with Claude Code**

macOS:
```bash
claude mcp add sap-help node /Users/yourname/BusinessNetwork-Help-MCP/index.js
```

Windows:
```
claude mcp add sap-help node C:\Users\yourname\BusinessNetwork-Help-MCP\index.js
```

Replace the path with the actual output from Step 5.

---

### Usage

Start Claude Code:
```bash
claude
```

The following tools are available automatically:

- **`search_sap_docs`** — semantic + keyword search across all cached SAP documents
- **`get_sap_page`** — read the full content of a specific SAP Help page
- **`list_sap_sources`** — list all cached pages and their status

---

### Keeping Up to Date

There are no automatic notifications. It is recommended to update once a month or once a quarter.

From inside the `BusinessNetwork-Help-MCP` folder:

macOS:
```bash
git pull && python3 build_index.py
```

Windows:
```
git pull
python build_index.py
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
