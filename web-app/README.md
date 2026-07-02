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

**3. Start the server**

Mac / Linux:
```
python3 app.py
```

Windows:
```
python app.py
```

**4. Open in browser**

```
http://localhost:5001
```

## Usage

1. Enter your **API Key** and **Base URL** in the fields at the top
2. Your credentials are saved automatically in your browser (you only need to enter them once)
3. Type your question and press **Enter** or click **Send**
4. Use **Clear** to start a new conversation

## Notes

- The app runs locally on your machine — your API key is never shared with anyone
- Documentation content is served from `cache.json` in the project root
- Supports questions in both English and Chinese
