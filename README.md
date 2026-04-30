# SAP Help MCP Server

A local MCP server for querying SAP Help Portal documentation. Uses a local cache built with Puppeteer for fast responses (under 1 second).

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Claude Code CLI](https://claude.ai/code)

## Installation

```bash
# 1. Clone the repository
git clone <repo-url>
cd sap-help

# 2. Install dependencies
npm install

# 3. Build the local cache (fetches all configured SAP Help pages)
node refresh-cache.js

# 4. Register the MCP server with Claude Code
claude mcp add sap-help node /absolute/path/to/sap-help/index.js
```

For step 4, replace `/absolute/path/to/sap-help` with the actual path on your machine. For example:

```bash
claude mcp add sap-help node /Users/yourname/sap-help/index.js
```

## Usage

Once registered, the following tools are available in Claude Code:

- **`search_sap_docs`** — Search across all cached SAP pages by keyword
- **`get_sap_page`** — Retrieve full content of a specific SAP Help page by URL
- **`list_sap_sources`** — List all cached pages and their status

## Refreshing the Cache

When SAP documentation is updated, refresh your local cache by running:

```bash
cd /path/to/sap-help
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
