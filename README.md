# SAP Help Assistant

A local AI assistant for querying SAP Business Network documentation. Two versions are available — choose the one that fits your workflow:

| Version | Best for | Setup guide |
|---------|----------|-------------|
| **Web Interface** | General users — chat in a browser, no coding required | [web-app/README.md](web-app/README.md) |
| **Claude Code MCP** | Claude Code CLI users — query SAP docs directly from the terminal | See below |

---

## Claude Code MCP Version

### Prerequisites

Two tools need to be installed manually before you begin: **Git** and **Claude Code**.

| | Verification command | Install if missing |
|-|----------------------|--------------------|
| **Git** (required) | `git --version` | **macOS:** `xcode-select --install` |
| | | **Windows:** `winget install Git.Git` |
| **Claude Code** (required) | `claude --version` | Follow [this guide](https://pages.github.tools.sap/D061192/aiwarmups/ClaudeCodeInAction/) to install |

> **macOS:** If you don't have Homebrew, the setup script installs it automatically.

Node.js and Python are installed automatically by the setup script — you do not need to install them manually.

After installing Git and Claude Code, close and reopen your terminal before continuing.

---

### Installation

**Step 1 — Clone the repository**

```
git clone https://github.tools.sap/I560320/BusinessNetwork-Help-MCP.git
cd BusinessNetwork-Help-MCP
```

The folder is created in your current terminal directory — typically `/Users/yourname/BusinessNetwork-Help-MCP` on macOS or `C:\Users\yourname\BusinessNetwork-Help-MCP` on Windows. Run `pwd` (macOS) or `cd` (Windows) to confirm the exact path.

> The folder can be moved anywhere on your machine at any time. If you move it, re-run `claude mcp add sap-help node "<new path>/index.js"` once to update the registration.

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

Once registered, open Claude Code with `claude` and ask questions about SBN or BNL directly.

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
