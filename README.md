# SAP Help Assistant

A local AI assistant for querying SAP Business Network documentation. Two versions are available — choose the one that fits your workflow:

| Version | Best for | Setup guide |
|---------|----------|-------------|
| **Web Interface** | General users — chat in a browser, no coding required | [web-app/README.md](web-app/README.md) |
| **Claude Code MCP** | Claude Code CLI users — query SAP docs directly from the terminal | See below |

---

## Claude Code MCP Version

### Prerequisites

**Step 1 — Check what you already have**

Run each verification command in your terminal. If the output shows a version number, that tool is already installed.

| Tool | Verification command | Requirement |
|------|----------------------|-------------|
| Git | `git --version` | Any version |
| Node.js | `node --version` | v18 or higher |
| Python | `python3 --version` (Mac) / `python --version` (Windows) | 3.8 or higher |

**Step 2 — Install anything missing**

**macOS** — Homebrew is recommended. It installs all three tools with simple commands and handles updates automatically.

Check if you have Homebrew:
```bash
brew --version
```

If not installed, install Homebrew first:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install any missing tools:

| Tool | Install command |
|------|----------------|
| Git | `brew install git` |
| Node.js | `brew install node@20` |
| Python | `brew install python` |

**Windows** — use `winget`, which is built into Windows 10 and 11. Open Command Prompt and run:

| Tool | Install command |
|------|----------------|
| Git | `winget install Git.Git` |
| Node.js | `winget install OpenJS.NodeJS.LTS` |
| Python | `winget install Python.Python.3` |

After installing, close and reopen your terminal, then re-run the verification commands to confirm.

---

### Installation

```
git clone https://github.tools.sap/I560320/BusinessNetwork-Help-MCP.git
cd BusinessNetwork-Help-MCP
npm install
```

Then install Python dependencies for semantic search:

```
python3 build_index.py   # macOS
python build_index.py    # Windows
```

**Find your folder path** (needed for the next step):
- macOS: run `pwd`
- Windows: run `cd`

**Register the MCP server with Claude Code:**

```
claude mcp add sap-help node /your/path/to/BusinessNetwork-Help-MCP/index.js
```

Replace the path with the output from above.

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

```
git pull && python3 build_index.py   # macOS
git pull && python build_index.py    # Windows
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
