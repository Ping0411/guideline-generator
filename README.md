# SAP Help Assistant

A local AI assistant for querying SAP Business Network documentation. Two versions are available — choose the one that fits your workflow:

| Version | Best for | Setup guide |
|---------|----------|-------------|
| **Web Interface** | General users — chat in a browser, no coding required | [web-app/README.md](web-app/README.md) |
| **Claude Code MCP** | Claude Code CLI users — query SAP docs directly from the terminal | See below |

---

## Claude Code MCP Version

### Prerequisites

Only one tool needs to be installed manually before you begin: **Git**.

| | Verification command | Install if missing |
|-|----------------------|--------------------|
| **Git** (required) | `git --version` | **macOS:** `xcode-select --install` |
| | | **Windows:** `winget install Git.Git` |

> **macOS:** If you don't have Homebrew, the setup script installs it automatically.

Node.js and Python are installed automatically by the setup script — you do not need to install them manually.

After installing Git, close and reopen your terminal before continuing.

---

### Installation

**Step 1 — Clone the repository**

```
git clone https://github.tools.sap/I560320/BusinessNetwork-Help-MCP.git
cd BusinessNetwork-Help-MCP
```

**Step 2 — Run the setup script**

macOS:
```bash
bash setup-mcp.sh
```

Windows — open Command Prompt (not PowerShell), then run:
```
setup-mcp.bat
```

The script installs all dependencies, builds the local search index (~15 minutes on first run), and displays the command you need to run next.

**Step 3 — Register the MCP server with Claude Code**

At the end of the setup script, you will see a command like this:

```
claude mcp add sap-help node "/path/to/BusinessNetwork-Help-MCP/index.js"
```

Copy and paste that exact command into your terminal and run it.

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

From inside the `BusinessNetwork-Help-MCP` folder, run the update script:

macOS:
```bash
bash update.sh
```

Windows:
```
update.bat
```

The script pulls the latest changes and rebuilds the search index only if new documents were added. If it was an index or code update only, it finishes in seconds.

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
