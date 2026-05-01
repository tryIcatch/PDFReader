# PDF 智能阅读器 V1 接口定义草案

## 1. 文档目标

本文档定义 V1 的主要接口边界，供以下开发工作统一参考：

- Electron 主进程与 Renderer 之间的 IPC 设计
- 前端 service 层类型定义
- AI Provider 与 Mathpix Provider 封装
- 笔记、导出、历史记录等业务接口实现

V1 不使用远程自建后端，核心接口主要是：

- Renderer 内部服务接口
- Renderer <-> Main IPC 接口
- Main -> 第三方服务接口

---

## 2. 总体分层

```text
Renderer UI
│
├── page/components
├── store
└── services
    ├── pdfService
    ├── translateService
    ├── formulaService
    ├── noteService
    ├── historyService
    └── exportService
         │
         ▼
     Electron IPC
         │
         ▼
Main Process
│
├── db repositories
├── ai provider (OpenAI-compatible)
├── mathpix provider
├── file/export manager
└── secure settings manager
```

---

## 3. 通用约定

### 3.1 返回结构

建议所有 IPC 接口统一返回：

```ts
type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };
```

### 3.2 错误结构

```ts
type AppError = {
  code:
    | "INVALID_PARAMS"
    | "NOT_FOUND"
    | "PDF_LOAD_FAILED"
    | "PDF_TEXT_UNAVAILABLE"
    | "AI_REQUEST_FAILED"
    | "MATHPIX_REQUEST_FAILED"
    | "DB_ERROR"
    | "EXPORT_FAILED"
    | "UNAUTHORIZED"
    | "UNKNOWN_ERROR";
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};
```

### 3.3 坐标结构

```ts
type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  coordSpace: "page_normalized";
  origin: "top_left";
};
```

### 3.4 笔记类型

```ts
type NoteType = "highlight" | "comment" | "formula_favorite";
```

---

## 4. 设置与配置接口

### 4.1 AI 设置

用于保存 OpenAI 兼容协议配置。

```ts
type SaveAiSettingsParams = {
  baseURL: string;
  apiKey: string;
  model: string;
};

type AiSettingsView = {
  baseURL: string;
  model: string;
  configured: boolean;
};
```

#### Renderer service

```ts
saveAiSettings(params: SaveAiSettingsParams): Promise<void>;
getAiSettings(): Promise<AiSettingsView | null>;
```

#### IPC 建议

- `settings:save-ai`
- `settings:get-ai`

### 4.2 Mathpix 设置

```ts
type SaveMathpixSettingsParams = {
  appId: string;
  appKey: string;
};

type MathpixSettingsView = {
  appId: string;
  configured: boolean;
};
```

#### Renderer service

```ts
saveMathpixSettings(params: SaveMathpixSettingsParams): Promise<void>;
getMathpixSettings(): Promise<MathpixSettingsView | null>;
```

#### IPC 建议

- `settings:save-mathpix`
- `settings:get-mathpix`

### 4.3 通用偏好设置

```ts
type ReaderPreferences = {
  defaultZoom?: number;
  sidebarVisible?: boolean;
  aiPanelVisible?: boolean;
};

type ExportPreferences = {
  includeOriginal: boolean;
  includeTranslation: boolean;
  includeLatex: boolean;
  includeExplanation: boolean;
};
```

---

## 5. PDF 文档接口

### 5.1 打开文档

```ts
type OpenDocumentParams = {
  filePath: string;
};

type OpenDocumentResult = {
  documentId: string;
  fileName: string;
  filePath: string;
  pageCount: number;
  lastPage?: number;
  lastZoom?: number;
};
```

#### Renderer service

```ts
openDocument(params: OpenDocumentParams): Promise<OpenDocumentResult>;
```

#### Main 侧职责

- 校验文件是否存在
- 计算文档 hash
- 写入或更新 `documents`
- 写入 `recent_documents`

#### IPC 建议

- `document:open`

### 5.2 最近打开列表

```ts
type RecentDocumentItem = {
  documentId: string;
  fileName: string;
  filePath: string;
  pageCount: number;
  lastOpenTime: string;
  lastPage: number;
  lastZoom: number;
};
```

```ts
listRecentDocuments(): Promise<RecentDocumentItem[]>;
```

#### IPC 建议

- `document:list-recent`

### 5.3 更新阅读进度

```ts
type UpdateReadingProgressParams = {
  documentId: string;
  lastPage: number;
  lastZoom: number;
  scrollTopRatio?: number;
};
```

```ts
updateReadingProgress(params: UpdateReadingProgressParams): Promise<void>;
```

#### IPC 建议

- `document:update-progress`

---

## 6. 翻译接口

### 6.1 翻译参数

```ts
type TranslateTextParams = {
  documentId: string;
  pageNumber: number;
  text: string;
  targetLang: string;
  context?: string;
};

type TranslateTextResult = {
  translatedText: string;
  cached: boolean;
  model: string;
};
```

### 6.2 Renderer service

```ts
translateText(params: TranslateTextParams): Promise<TranslateTextResult>;
```

### 6.3 Main 侧职责

- 校验 AI 配置是否存在
- 先查 `translation_cache`
- 未命中时调用 OpenAI 兼容接口
- 保存缓存
- 写入 `activity_history`

### 6.4 IPC 建议

- `translate:text`

### 6.5 OpenAI 兼容 Provider 输入

```ts
type OpenAiCompatibleRequest = {
  baseURL: string;
  apiKey: string;
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
};
```

---

## 7. 公式 OCR 接口

### 7.1 识别公式

```ts
type RecognizeFormulaParams = {
  documentId: string;
  pageNumber: number;
  bbox: NormalizedRect;
  imagePath: string;
  sourceContext?: string;
};

type RecognizeFormulaResult = {
  formulaId: string;
  latex: string;
  confidence?: number;
  ocrProvider: "mathpix";
};
```

```ts
recognizeFormula(params: RecognizeFormulaParams): Promise<RecognizeFormulaResult>;
```

### 7.2 Main 侧职责

- 校验 Mathpix 配置
- 读取裁图文件
- 调用 Mathpix OCR
- 将结果写入 `formulas`
- 写入 `activity_history`

### 7.3 IPC 建议

- `formula:recognize`

### 7.4 Mathpix Provider 建议输入

```ts
type MathpixRequest = {
  imagePath: string;
  options?: {
    formats?: Array<"text" | "data" | "html" | "latex_styled">;
    includeLineData?: boolean;
  };
};
```

### 7.5 Mathpix Provider 建议输出

```ts
type MathpixResult = {
  latex: string;
  confidence?: number;
  raw?: unknown;
};
```

---

## 8. 公式解释接口

### 8.1 解释公式

```ts
type ExplainFormulaParams = {
  formulaId: string;
  latex: string;
  context?: string;
};

type ExplainFormulaResult = {
  explanation: string;
  variables: Array<{
    symbol: string;
    meaning: string;
  }>;
};
```

```ts
explainFormula(params: ExplainFormulaParams): Promise<ExplainFormulaResult>;
```

### 8.2 Main 侧职责

- 校验 AI 配置
- 组合公式和上下文 prompt
- 调用 OpenAI 兼容接口
- 更新 `formulas.explanation` 与 `variables_json`
- 写入 `activity_history`

### 8.3 IPC 建议

- `formula:explain`

---

## 9. 笔记接口

### 9.1 保存笔记

```ts
type TextAnchor = {
  pageNumber: number;
  selectedText: string;
  prefix?: string;
  suffix?: string;
  startOffset?: number;
  endOffset?: number;
};

type SaveNoteParams = {
  documentId: string;
  pageNumber: number;
  noteType: NoteType;
  selectedText?: string;
  translatedText?: string;
  comment?: string;
  color?: string;
  anchorJson?: TextAnchor;
  rectsJson?: NormalizedRect[];
  formulaId?: string;
};
```

```ts
saveNote(params: SaveNoteParams): Promise<{ noteId: string }>;
```

### 9.2 查询文档笔记

```ts
type NoteItem = {
  id: string;
  documentId: string;
  pageNumber: number;
  noteType: NoteType;
  selectedText?: string;
  translatedText?: string;
  comment?: string;
  color?: string;
  anchorJson?: TextAnchor;
  rectsJson?: NormalizedRect[];
  formulaId?: string;
  createdAt: string;
  updatedAt: string;
};
```

```ts
listNotesByDocument(documentId: string): Promise<NoteItem[]>;
deleteNote(noteId: string): Promise<void>;
```

### 9.3 IPC 建议

- `note:save`
- `note:list-by-document`
- `note:delete`

---

## 10. 公式收藏与查询接口

### 10.1 查询文档公式

```ts
type FormulaItem = {
  id: string;
  documentId: string;
  pageNumber: number;
  bbox: NormalizedRect;
  imagePath: string;
  latex?: string;
  explanation?: string;
  variables?: Array<{
    symbol: string;
    meaning: string;
  }>;
  confidence?: number;
  ocrProvider: "mathpix";
  sourceContext?: string;
  createdAt: string;
};
```

```ts
listFormulasByDocument(documentId: string): Promise<FormulaItem[]>;
getFormulaById(formulaId: string): Promise<FormulaItem | null>;
```

### 10.2 IPC 建议

- `formula:list-by-document`
- `formula:get-by-id`

---

## 11. 导出接口

### 11.1 Markdown 导出

```ts
type ExportMarkdownParams = {
  documentId: string;
  includeOriginal: boolean;
  includeTranslation: boolean;
  includeLatex: boolean;
  includeExplanation: boolean;
  outputPath?: string;
};

type ExportMarkdownResult = {
  outputPath: string;
  noteCount: number;
  formulaCount: number;
};
```

```ts
exportMarkdown(params: ExportMarkdownParams): Promise<ExportMarkdownResult>;
```

### 11.2 导出内容建议

- 文档标题
- 导出时间
- 分页整理的笔记列表
- 按选项包含原文、译文、LaTeX、解释

### 11.3 IPC 建议

- `export:markdown`

---

## 12. 历史记录接口

### 12.1 查询操作历史

```ts
type HistoryActionType =
  | "translate_text"
  | "recognize_formula"
  | "explain_formula"
  | "save_note"
  | "export_markdown";

type HistoryItem = {
  id: string;
  documentId?: string;
  actionType: HistoryActionType;
  payload: Record<string, unknown> | null;
  createdAt: string;
};
```

```ts
listHistory(params?: {
  documentId?: string;
  actionType?: HistoryActionType;
  limit?: number;
}): Promise<HistoryItem[]>;
```

### 12.2 IPC 建议

- `history:list`

---

## 13. 文件与截图接口

### 13.1 选择 PDF 文件

```ts
type PickPdfFileResult = {
  canceled: boolean;
  filePath?: string;
};
```

```ts
pickPdfFile(): Promise<PickPdfFileResult>;
```

### 13.2 保存裁剪图片

该能力建议放在 Main 侧，Renderer 提供裁图数据或临时文件路径。

```ts
type SaveFormulaImageParams = {
  documentId: string;
  pageNumber: number;
  imageDataUrl: string;
};

type SaveFormulaImageResult = {
  imagePath: string;
};
```

```ts
saveFormulaImage(params: SaveFormulaImageParams): Promise<SaveFormulaImageResult>;
```

### 13.3 IPC 建议

- `dialog:pick-pdf`
- `file:save-formula-image`

---

## 14. Renderer 服务拆分建议

### pdfService

负责：

- 打开文档
- 获取最近打开记录
- 更新阅读进度

### translateService

负责：

- 选中文本翻译
- 翻译缓存结果展示

### formulaService

负责：

- 保存公式裁图
- 识别公式
- 解释公式
- 查询公式详情

### noteService

负责：

- 保存高亮
- 保存批注
- 保存公式收藏
- 查询和删除笔记

### exportService

负责：

- 组装导出参数
- 调用 Markdown 导出

### historyService

负责：

- 查询历史记录

---

## 15. IPC 命名建议总表

| 模块 | Channel |
| --- | --- |
| 文档 | `document:open` |
| 文档 | `document:list-recent` |
| 文档 | `document:update-progress` |
| 翻译 | `translate:text` |
| 公式 | `formula:recognize` |
| 公式 | `formula:explain` |
| 公式 | `formula:list-by-document` |
| 公式 | `formula:get-by-id` |
| 笔记 | `note:save` |
| 笔记 | `note:list-by-document` |
| 笔记 | `note:delete` |
| 导出 | `export:markdown` |
| 历史 | `history:list` |
| 设置 | `settings:save-ai` |
| 设置 | `settings:get-ai` |
| 设置 | `settings:save-mathpix` |
| 设置 | `settings:get-mathpix` |
| 文件 | `dialog:pick-pdf` |
| 文件 | `file:save-formula-image` |

---

## 16. Prompt 侧建议

### 翻译 Prompt

要求：

- 输出自然、准确的中文
- 保留术语一致性
- 避免过度解释

### 公式解释 Prompt

要求：

- 输出四部分：公式含义、变量说明、使用场景、简化说明
- 变量说明尽量结构化，便于写入 `variables_json`

---

## 17. 缓存与性能建议

- 翻译按 `sourceText + targetLang + model` 做缓存
- 公式解释按 `latex + context + model` 可选做二级缓存
- OCR 图片保存后可复用，避免重复截图
- 历史记录查询默认分页或限制条数，避免面板卡顿

---

## 18. 安全建议

- OpenAI 兼容 API Key 和 Mathpix App Key 不从 Renderer 直接请求第三方
- 第三方调用统一从 Main 侧发出
- 密钥建议存系统安全存储，Renderer 只拿到是否已配置的状态
- 导出和文件选择统一走 Main 侧文件系统接口

---

## 19. V1 不纳入的接口

以下接口明确不进入 V1：

- 扫描件 OCR 接口
- 自动公式检测接口
- 整页翻译接口
- 全文翻译接口
- 云同步接口
- 多人协作接口

---

## 20. 开发落地建议

1. 先定义 `shared/types`，统一 `NoteType`、`NormalizedRect`、`IpcResult`
2. 再定义 `preload` 暴露的安全 API，禁止 Renderer 直接接触 Node 能力
3. 然后实现 Main 侧 repository/provider
4. 最后接到 Renderer services 与页面组件

