# SAP Help MCP 章节映射生成说明

## 一、章节映射的用途

章节映射记录在 CLAUDE.md 中，供 AI 在回答问题时快速定位"答案在哪个切片"。
格式示例：
```
- Part3: Invoice issue date / digital signature rules (point of invoice issue, country-specific timestamp rules, post-issue restrictions)
```

AI 看到用户问题后，先查章节映射，直接跳到对应切片读取，避免逐个切片盲目搜索。
**章节映射的准确性直接决定能否找到正确切片。**

## 二、【强制要求】必须基于切片实际内容生成

- **基于切片实际内容，不推测** — 不得从文件名、文档标题、或其他切片内容推断
- **基于切片完整内容，不只读个别一段** — 必须读完该切片的全部文字，切片后半部分同样重要
- **描述该切片具体涵盖哪些话题** — 不写"介绍了XX"、"说明了XX"等泛泛描述，必须点出具体的字段名、功能名、规则名
- **格式与 CLAUDE.md 现有条目风格一致** — 参照示例：`Part3: Company profile settings (Contact My Company, Trading Partner Search visibility)`

## 三、格式规范

### 标准格式
```
Part{N}: {主题} ({具体内容1}, {具体内容2}, {具体内容3})
```

### 规则
1. **主题**：该切片最核心的话题，2-6个词，首字母大写
2. **括号内**：列出切片实际覆盖的具体内容点，用逗号分隔，3-5个为宜
3. **内容点要具体**：写字段名、功能名、规则名，不写"概述"、"说明"、"介绍"等泛词
4. **长度适中**：整行不超过120个字符

### 示例对比

| 坏的（泛泛） | 好的（具体） |
|---|---|
| Part3: Invoice settings (various invoice options) | Part3: Invoice issue date / digital signature rules (point of invoice issue, country-specific timestamp rules, post-issue restrictions) |
| Part7: User management (user related functions) | Part7: Permissions reference (Product Sourcing Event permission, Promote Subscribers permissions) |
| Part2: Overview of the system | Part2: Purchase order types (standard PO, subcontracting PO with Latest GR date; service PO with lean services) |

## 四、特殊情况处理

- **TOC切片**（内容主要是目录）：`Part1: TOC / disclaimer` 或 `Part1: TOC (chapter index, covers X sections)`
- **纯修订历史切片**：`PartN: Revision history (change log by month/year)`
- **多话题切片**：用 ` + ` 连接主题，括号内分别列出各主题的要点
  - 示例：`Part13: Service Rules (continued) + Allowances/Charges Rules (negative tax on allowances, return item invoicing rules)`
- **EDI/X12/EDIFACT 切片**：描述具体 segment（如 `BIG segment`, `N1 loop`），不写"segment descriptions"这种泛词

## 五、写入 CLAUDE.md 的位置

新文档的章节映射追加到 CLAUDE.md 中对应文档 URL pattern 说明块之后，格式与现有条目保持一致：

```markdown
- **文档名称** `file://SBN/split/文档名_Part{N}.pdf` (N = 1–X)
  - Part1: TOC / disclaimer
  - Part2: ...
  - Part3: ...
```
