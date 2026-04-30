# SAP Help MCP Server

A local MCP server for querying SAP Help Portal documentation. Uses a local cache built with Puppeteer for fast responses (under 1 second).

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Claude Code CLI](https://pages.github.tools.sap/D061192/aiwarmups/ClaudeCodeInAction/) — follow this guide to install and configure Claude Code

### Check Node.js version

Run the following command in your terminal:

```bash
node --version
```

If the output is `v18.x.x` or higher, you're good to go. If Node.js is not installed or the version is too low, download and install the latest LTS version from [nodejs.org](https://nodejs.org).

## Installation

**Step 1: Clone the repository**

```bash
git clone https://github.tools.sap/I560320/BusinessNetwork-Help-MCP.git
cd BusinessNetwork-Help-MCP
```

**Step 2: Install dependencies**

```bash
npm install
```

**Step 3: Build the local cache**

```bash
node refresh-cache.js
```

This fetches all configured SAP Help pages and saves them locally. It may take a few minutes.

**Step 4: Find your absolute path**

You need the full path to the cloned folder for the next step.

- macOS / Linux — run:
  ```bash
  pwd
  ```
- Windows — run:
  ```bash
  cd
  ```

Copy the output. For example:
- macOS: `/Users/yourname/BusinessNetwork-Help-MCP`
- Windows: `C:\Users\yourname\BusinessNetwork-Help-MCP`

**Step 5: Register the MCP server with Claude Code**

- macOS / Linux:
  ```bash
  claude mcp add sap-help node /Users/yourname/BusinessNetwork-Help-MCP/index.js
  ```
- Windows:
  ```bash
  claude mcp add sap-help node C:\Users\yourname\BusinessNetwork-Help-MCP\index.js
  ```

Replace the path with the actual output from Step 4.

## Usage

Once registered, start Claude Code in your terminal by running:

```bash
claude
```

The following tools will be available automatically:

- **`search_sap_docs`** — Search across all cached SAP pages by keyword
- **`get_sap_page`** — Retrieve full content of a specific SAP Help page by URL
- **`list_sap_sources`** — List all cached pages and their status

## Refreshing the Cache

The cache is not updated automatically. It is recommended to refresh it manually once a month, or whenever you notice the content may be outdated.

To get the latest updates, pull the latest changes and refresh your local cache:

```bash
cd /path/to/BusinessNetwork-Help-MCP
git pull
node refresh-cache.js
```

## Covered Documentation

The cache includes the following SAP Help areas:

- SAP Business Network for Logistics
- SAP Business Network Global Track and Trace
- SAP Business Network Logistics Provider (Carrier integration)
- SAP Business Network Invoicing
- SAP Business Network Buyer Administration (Transaction Rules)
- cXML Solutions Guide
- Guided Integration for Trading Partners
- SAP Ariba Cloud Integration Gateway (CIG)
- SAP Business Network for Trading Partners
- LBN Freight Collaboration API
- LBN Global Track and Trace API
