# SAP Help Assistant

A local AI assistant for querying SAP Business Network documentation. Two versions are available — choose the one that fits your workflow:

| Version | Best for | Setup guide |
|---------|----------|-------------|
| **Web Interface** | General users — chat in a browser, no coding required | [web-app/README.md](web-app/README.md) |
| **Claude Code MCP** | Claude Code CLI users — query SAP docs directly from the terminal | See below |

---

## Claude Code MCP Version

### Prerequisites

Only **Git** needs to be installed manually before you begin.

| | Verification command | Install if missing |
|-|----------------------|--------------------|
| **Git** (required) | `git --version` | **macOS:** `brew install git` (or `xcode-select --install`) |
| | | **Windows:** `winget install Git.Git` |

Node.js and Python are installed automatically by `npm install` and the index build step — no manual install needed.

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
