# Integration Guideline Generator

A tool that generates Integration Guideline Excel files for SAP Business Network trading partner onboarding projects. Launched directly from the SAP Help Assistant web interface — no separate startup required.

---

## Prerequisites

The Generator is part of the SAP Help Assistant web app. Before using the Generator, make sure you have completed the SAP Help Assistant setup described in [`web-app/README.md`](../README.md).

In addition, **Node.js** is required to run the Generator. It is installed automatically by the SAP Help Assistant setup script — you do not need to install it manually.

---

## One-time setup

After cloning the SAP Help Assistant repository, run the following command **once** to install the Generator's dependencies.

Open a terminal — **macOS:** Terminal, **Windows:** Command Prompt (not PowerShell).

First, navigate to the project folder. If you are not sure where it is, run:

- **macOS:** `find ~ -maxdepth 3 -name "BusinessNetwork-Help-MCP" -type d 2>/dev/null`
- **Windows:** `dir /s /b "%USERPROFILE%\BusinessNetwork-Help-MCP" 2>nul`

Then run:

**macOS:**
```
cd /path/to/BusinessNetwork-Help-MCP/web-app/guideline-generator
npm install
```

**Windows:**
```
cd C:\path\to\BusinessNetwork-Help-MCP\web-app\guideline-generator
npm install
```

Replace `/path/to/` or `C:\path\to\` with the actual path from the command above.

The install completes in under a minute. You only need to do this once.

---

## Launch

1. Start the SAP Help Assistant web app (double-click the launch file in the project root)
2. Open `http://localhost:5001` in your browser
3. Click **Guideline Generator** in the top navigation

The Generator opens in a new browser tab at `http://localhost:5002`. It starts automatically — no separate terminal command needed.

---

## What it generates

Based on your inputs, the Generator produces an Integration Guideline Excel file containing:

- **Project Requirements** — transaction rules summary in your chosen language
- **Document sheets** (OC, ASN, Invoice, PO) — cXML structure with field-level annotations
- **Extrinsic fields sheet** — custom field reference
- **Country/Region invoice rules sheet** — included when applicable
- **Invoice with MIME attachment sheet** — included when applicable (Chinese language + Invoice in scope)

---

## Supported languages

- English
- Chinese (中文)
- Japanese (日本語)

---

## Keeping up to date

The Generator's source code is updated automatically when you update the SAP Help Assistant (via the update script in the project root). 

If the Generator fails to start after an update, re-run `npm install` in the `web-app/guideline-generator` folder — dependencies may have changed.

**macOS:**
```
cd /path/to/BusinessNetwork-Help-MCP/web-app/guideline-generator
npm install
```

**Windows:**
```
cd C:\path\to\BusinessNetwork-Help-MCP\web-app\guideline-generator
npm install
```

---

## Notes

- The Generator runs entirely on your machine — no data is sent to any external service (except when EDI conversion uses the local SAP Help cache)
- No API key is required
- The Generator requires the SAP Help Assistant web app to be running on `http://localhost:5001`
