# PDF 智能阅读器 V1 数据库表结构草案

## 1. 文档目标

本文档用于冻结 V1 的本地数据结构，供以下开发工作直接参考：

- SQLite 建表
- Electron 主进程数据访问层实现
- Renderer 侧状态模型设计
- 笔记、高亮、公式、历史记录的持久化

V1 约束：

- 平台仅支持 Windows
- 本地数据库使用 SQLite
- 仅支持原生文本 PDF
- 扫描件 OCR 放到 P1
- AI 接口使用 OpenAI 兼容协议
- 公式 OCR 固定接入 Mathpix

---

## 2. 设计原则

- 文档主信息、最近打开记录、操作历史分表存储
- 文本笔记与公式收藏共用 `notes` 表，通过 `note_type` 区分
- 高亮/批注位置既保存文本锚点，也保存绘制矩形
- 页面区域坐标统一使用“页内归一化坐标”
- 敏感配置不建议明文保存在业务表中

---

## 3. 坐标与锚点约定

### 3.1 页内归一化坐标

所有页面区域坐标统一采用以下约定：

- 原点：页面左上角
- 坐标空间：`page_normalized`
- 范围：`x/y/width/height` 都为 `0 ~ 1`

示例：

```json
{
  "x": 0.214,
  "y": 0.338,
  "width": 0.431,
  "height": 0.092,
  "coordSpace": "page_normalized",
  "origin": "top_left"
}
```

### 3.2 文本锚点

`anchor_json` 用于尽量稳定地重新定位文本，建议至少包含：

```json
{
  "pageNumber": 12,
  "selectedText": "Let x be the hidden representation.",
  "prefix": "In the encoder, ",
  "suffix": " used by the decoder.",
  "startOffset": 128,
  "endOffset": 166
}
```

### 3.3 高亮矩形

`rects_json` 为数组，保存一个选区对应的一个或多个矩形：

```json
[
  {
    "x": 0.103,
    "y": 0.441,
    "width": 0.552,
    "height": 0.019,
    "coordSpace": "page_normalized",
    "origin": "top_left"
  }
]
```

---

## 4. 表结构概览

V1 建议包含以下业务表：

1. `documents`
2. `recent_documents`
3. `notes`
4. `formulas`
5. `translation_cache`
6. `activity_history`
7. `settings`

---

## 5. documents

用于保存文档基础信息。

### 字段定义

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT` | 主键，建议 UUID |
| `file_path` | `TEXT` | PDF 绝对路径 |
| `file_name` | `TEXT` | 文件名 |
| `file_hash` | `TEXT` | 文件 hash，用于去重和缓存关联 |
| `file_size` | `INTEGER` | 文件大小，单位字节 |
| `page_count` | `INTEGER` | 页数 |
| `created_at` | `TEXT` | 首次记录时间，ISO 8601 |
| `updated_at` | `TEXT` | 最近更新时间，ISO 8601 |

### 约束与索引

- 主键：`id`
- 唯一索引：`file_hash`
- 普通索引：`file_name`

### 建表示例

```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_file_name
ON documents(file_name);
```

---

## 6. recent_documents

用于保存最近打开记录，与操作历史分离。

### 字段定义

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT` | 主键 |
| `document_id` | `TEXT` | 关联文档 ID |
| `last_open_time` | `TEXT` | 最近打开时间 |
| `last_page` | `INTEGER` | 最近阅读页码 |
| `last_zoom` | `REAL` | 最近缩放比例 |
| `scroll_top_ratio` | `REAL` | 当前页滚动位置，可选 |

### 约束与索引

- 外键：`document_id -> documents.id`
- 唯一索引：`document_id`
- 排序索引：`last_open_time DESC`

### 建表示例

```sql
CREATE TABLE IF NOT EXISTS recent_documents (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  last_open_time TEXT NOT NULL,
  last_page INTEGER NOT NULL DEFAULT 1,
  last_zoom REAL NOT NULL DEFAULT 1,
  scroll_top_ratio REAL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recent_documents_document_id
ON recent_documents(document_id);

CREATE INDEX IF NOT EXISTS idx_recent_documents_last_open_time
ON recent_documents(last_open_time DESC);
```

---

## 7. notes

用于保存三类笔记：

- `highlight`
- `comment`
- `formula_favorite`

### 字段定义

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT` | 主键 |
| `document_id` | `TEXT` | 关联文档 ID |
| `page_number` | `INTEGER` | 页码，从 1 开始 |
| `note_type` | `TEXT` | `highlight/comment/formula_favorite` |
| `selected_text` | `TEXT` | 原文选中文本 |
| `translated_text` | `TEXT` | 翻译结果 |
| `comment` | `TEXT` | 用户批注 |
| `color` | `TEXT` | 高亮或标签颜色，如 `#FFE58F` |
| `anchor_json` | `TEXT` | 文本锚点 JSON |
| `rects_json` | `TEXT` | 选区矩形数组 JSON |
| `formula_id` | `TEXT` | 若为公式收藏，可关联公式 ID |
| `created_at` | `TEXT` | 创建时间 |
| `updated_at` | `TEXT` | 更新时间 |

### 说明

- `highlight`：至少需要 `selected_text`、`anchor_json`、`rects_json`
- `comment`：在高亮基础上增加 `comment`
- `formula_favorite`：通常关联 `formula_id`

### 建表示例

```sql
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  note_type TEXT NOT NULL CHECK(note_type IN ('highlight', 'comment', 'formula_favorite')),
  selected_text TEXT,
  translated_text TEXT,
  comment TEXT,
  color TEXT,
  anchor_json TEXT,
  rects_json TEXT,
  formula_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(formula_id) REFERENCES formulas(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_document_page
ON notes(document_id, page_number);

CREATE INDEX IF NOT EXISTS idx_notes_type
ON notes(note_type);
```

---

## 8. formulas

用于保存公式截图、OCR 结果和解释结果。

### 字段定义

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT` | 主键 |
| `document_id` | `TEXT` | 关联文档 ID |
| `page_number` | `INTEGER` | 页码 |
| `bbox_json` | `TEXT` | 公式区域归一化坐标 JSON |
| `image_path` | `TEXT` | 裁剪图片路径 |
| `latex` | `TEXT` | 识别出的 LaTeX |
| `explanation` | `TEXT` | 公式解释 |
| `variables_json` | `TEXT` | 变量解释数组 JSON |
| `confidence` | `REAL` | OCR 置信度 |
| `ocr_provider` | `TEXT` | V1 固定为 `mathpix` |
| `source_context` | `TEXT` | 公式附近原文上下文 |
| `created_at` | `TEXT` | 创建时间 |
| `updated_at` | `TEXT` | 更新时间 |

### `variables_json` 示例

```json
[
  {
    "symbol": "x",
    "meaning": "输入向量"
  },
  {
    "symbol": "W",
    "meaning": "线性变换矩阵"
  }
]
```

### 建表示例

```sql
CREATE TABLE IF NOT EXISTS formulas (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  bbox_json TEXT NOT NULL,
  image_path TEXT NOT NULL,
  latex TEXT,
  explanation TEXT,
  variables_json TEXT,
  confidence REAL,
  ocr_provider TEXT NOT NULL DEFAULT 'mathpix',
  source_context TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_formulas_document_page
ON formulas(document_id, page_number);
```

---

## 9. translation_cache

用于减少重复翻译与成本消耗。

### 字段定义

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT` | 主键 |
| `cache_key` | `TEXT` | 唯一键，建议由文本+模型+目标语言 hash 生成 |
| `source_text` | `TEXT` | 原文 |
| `target_lang` | `TEXT` | 目标语言，V1 可默认 `zh-CN` |
| `translated_text` | `TEXT` | 译文 |
| `model_name` | `TEXT` | 模型名 |
| `created_at` | `TEXT` | 创建时间 |

### 建表示例

```sql
CREATE TABLE IF NOT EXISTS translation_cache (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  source_text TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  model_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

---

## 10. activity_history

用于记录用户关键操作历史，不等同于最近打开记录。

### action_type 建议枚举

- `translate_text`
- `recognize_formula`
- `explain_formula`
- `save_note`
- `export_markdown`

### 字段定义

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `TEXT` | 主键 |
| `document_id` | `TEXT` | 关联文档 ID，可为空 |
| `action_type` | `TEXT` | 行为类型 |
| `payload_json` | `TEXT` | 行为快照 JSON |
| `created_at` | `TEXT` | 创建时间 |

### `payload_json` 示例

```json
{
  "pageNumber": 8,
  "formulaId": "f_001",
  "latex": "\\alpha = \\sum_i w_i x_i"
}
```

### 建表示例

```sql
CREATE TABLE IF NOT EXISTS activity_history (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  action_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_history_action_time
ON activity_history(action_type, created_at DESC);
```

---

## 11. settings

用于保存非敏感设置项。敏感信息建议通过系统安全存储管理，仅在本表中保存必要的元数据。

### 字段定义

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `TEXT` | 主键 |
| `value_json` | `TEXT` | 设置值 JSON |
| `updated_at` | `TEXT` | 更新时间 |

### 建表示例

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 建议保存的设置项

- `app.ui`
- `reader.preferences`
- `export.preferences`
- `ai.provider.meta`
- `mathpix.meta`

### 不建议明文保存的内容

- `apiKey`
- `mathpixAppKey`

建议方案：

- `settings` 中仅保存 `baseURL`、`model`、是否已配置等元信息
- 密钥使用 Electron 主进程配合系统安全存储

---

## 12. 表关系说明

```text
documents
├── recent_documents
├── notes
├── formulas
└── activity_history

formulas
└── notes (formula_favorite)
```

---

## 13. 推荐初始化顺序

1. `documents`
2. `formulas`
3. `notes`
4. `recent_documents`
5. `translation_cache`
6. `activity_history`
7. `settings`

---

## 14. V1 必要索引

- `documents(file_hash)`
- `recent_documents(last_open_time DESC)`
- `notes(document_id, page_number)`
- `notes(note_type)`
- `formulas(document_id, page_number)`
- `translation_cache(cache_key)`
- `activity_history(action_type, created_at DESC)`

---

## 15. 后续演进预留

以下能力不进入 V1，但当前表结构已为升级留出空间：

- 扫描件 OCR：后续可在 `documents` 增加 `is_scanned`、`ocr_status`
- 自动公式检测：后续可在 `formulas` 增加 `detection_source`
- 多模型切换：后续可在 `translation_cache` 与 `activity_history` 增加 provider 字段
- 云同步：后续可为所有表增加 `remote_id`、`sync_status`

---

## 16. 实施建议

- 建表 SQL 建议集中在 `backend/db/migrations`
- JSON 字段在 TypeScript 层定义严格类型，不要散落使用匿名对象
- 业务查询优先按 `document_id + page_number` 组织
- 对 `notes` 和 `formulas` 的写入建议统一经过 repository/service 层，避免 UI 直接拼 SQL

