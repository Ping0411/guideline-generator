# SAP Help MCP 标签系统说明

## 一、背景：为什么需要标签？

这个 MCP 服务器把多份 SAP 文档（PDF）分割成更多切片并缓存在本地。当用户提问时，系统会在这些切片中进行关键词搜索，以找出最相关的内容。

标签的作用：给某个切片打上标签后，当用户搜索包含该标签词汇的问题时，该切片会获得额外的"相关度加分"，从而更容易排在搜索结果前列。

## 二、原则一：标签必须反映文档的真实内容

标签必须基于完整阅读每个切片的全文后提炼，不能随意写。

**重要教训：必须读完每个切片的完整内容，不能只读开头几百字。** 文档后半部分往往包含关键规则和字段说明，只读开头会导致这些内容永远无法被搜索命中。

反例（坏标签）：
- 给每份 BNL 文档统一打上 "carrier"、"api"、"integration"
  这些词在文档中普遍存在，无法区分不同文档。

正例（好标签）：
- 对 IN810 Invoice EDI 文档切片打标签：
  - "BIG07 invoice date field"
  - "N1 loop remit-to address"
  这些标签具有高度针对性，可以精准命中内容。

## 三、原则二：同一文档的不同切片标签必须不同

长文档会被拆分成多个切片，每个切片对应不同内容，应分别打标签。

示例：
- Part1：目录和概述 → "table of contents"、"overview"
- Part5：税务字段 → "tax category field"、"exempt detail"、"vat"
- Part12：服务单据规则 → "require start and end dates service invoices"

## 四、原则三：标签应使用 2-4 个词的短语

单个词过于宽泛，不具备区分度，应使用短语。

| 坏标签 | 好标签 |
|---|---|
| carrier | freight booking confirmation bnl |
| invoice | require start and end dates service invoices |
| error | ssl certificate chain error |
| cig | cig product renaming history |

## 五、原则四：标签数量与文档长度成比例

- 一页文档：约 4-5 个标签
- 10 页文档：约 8-12 个标签
- 避免所有文档标签数量一致

## 六、原则五：使用 excludeTags 排除噪音词

系统会自动提取关键词，其中部分词没有区分意义，应排除。

常见噪音词：
- `iata`
- `fc`（Freight Collaboration）
- `erp`

处理方式：在标签配置中使用 `excludeTags: ["iata", "fc", "erp"]`

## 七、实际操作流程

1. 找到要处理的文档切片
2. 阅读完整内容（每个切片全文，不是摘要）
3. 识别主要话题
4. 提炼每个话题的标签（短语）
5. 在 `generate-tags.js` 中添加配置
6. 运行命令重新生成 `tags.json`
