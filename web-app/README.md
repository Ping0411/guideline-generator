# SAP Help Assistant — Web Interface

A chat interface for querying SAP Business Network (SBN) and BNL Freight Collaboration documentation.

## Prerequisites

- **Python 3.9 or later**

  Check your version by running the following command in your terminal:

  Mac / Linux:
  ```
  python3 --version
  ```
  Windows:
  ```
  python --version
  ```

  If Python is not installed or the version is below 3.9, download it from [python.org](https://www.python.org/downloads/).

- **Hyperspace AI API Key and Base URL** — available from [Hyperspace AI](https://ai-docs.portal.hyperspace.tools.sap/)

## Setup

**1. Clone the repository** (if you haven't already)

```
git clone https://github.tools.sap/I560320/BusinessNetwork-Help-MCP.git
cd BusinessNetwork-Help-MCP
```

**2. Install dependencies**

Mac / Linux:
```
cd web-app && pip3 install -r requirements.txt
```

Windows (Command Prompt or PowerShell):
```
cd web-app
pip install -r requirements.txt
```

**3. Build the search index** (first time only, or after updating documents)

Go back to the project root, then run:

Mac / Linux:
```
cd .. && python3 build_index.py
```

Windows:
```
cd ..
python build_index.py
```

This downloads a ~250 MB language model (one-time) and builds a local vector index from the documentation. Takes 3–10 minutes depending on your machine. You only need to run this once — unless you pull new document updates from the repository.

**4. Launch the app**

**Mac users:** Double-click `Launch SAP Help Assistant.app` in the project folder — the browser opens automatically. No terminal needed.

**Windows users:** Double-click `Launch SAP Help Assistant.vbs` in the project folder — the browser opens automatically. No terminal needed.

If you prefer to start manually from the terminal:

Mac / Linux:
```
python3 web-app/app.py
```

Windows:
```
python web-app\app.py
```

Then open `http://localhost:5001` in your browser.

## Usage

1. Enter your **API Key** and **Base URL** in the fields at the top
2. Your credentials are saved automatically in your browser (you only need to enter them once)
3. Type your question and press **Enter** or click **Send**
4. Use the **Classic / Semantic** toggle to switch search modes:
   - **Classic**: keyword matching — fast, works well for exact terms
   - **Semantic**: AI-powered meaning matching — better for natural language questions and non-English queries (Chinese, Japanese)
5. Use **Clear** to start a new conversation

## Notes

- The app runs locally on your machine — your API key is never shared with anyone
- Documentation content is served from `cache.json` in the project root
- The vector index (`chroma_db/`) is generated locally and not included in the repository
- Supports questions in English, Chinese, and Japanese
