# 公式 OCR 双 Provider 设计

## 1. 目标

当前项目保留两条公式 OCR 通道：

- `Mathpix`：云端识别，效果稳定，依赖网络和密钥
- `pix2tex`：本地 Python 识别，依赖本机环境和模型

桌面端通过设置页选择当前激活的 provider，公式框选后统一走：

```text
截图保存
↓
读取公式 OCR provider 设置
↓
Mathpix 或 pix2tex
↓
返回 LaTeX
↓
保存 formulas 记录
↓
可继续调用 AI 做公式解释
```

## 2. 当前代码落点

### 设置与配置

- OCR provider 设置保存在 `settings` 表
- `Mathpix` 仍使用 `appId + appKey`
- `pix2tex` 目前只保存一个字段：`pythonPath`

相关文件：

- [index.ts](</G:/PythonProjects/PDFReader/src/shared/types/index.ts>)
- [channels.ts](</G:/PythonProjects/PDFReader/src/shared/ipc/channels.ts>)
- [preload.ts](</G:/PythonProjects/PDFReader/src/app/preload.ts>)
- [settingsService.ts](</G:/PythonProjects/PDFReader/src/renderer/src/services/settingsService.ts>)
- [SettingsModal.tsx](</G:/PythonProjects/PDFReader/src/renderer/src/components/SettingsModal.tsx>)

### 后端识别分流

- `registerIpcHandlers.ts` 会读取 `formula.ocr.meta`
- 当 provider 为 `mathpix` 时，走 `MathpixProvider`
- 当 provider 为 `pix2tex` 时，走 `Pix2TexProvider`

相关文件：

- [registerIpcHandlers.ts](</G:/PythonProjects/PDFReader/src/app/ipc/registerIpcHandlers.ts>)
- [MathpixProvider.ts](</G:/PythonProjects/PDFReader/src/backend/providers/MathpixProvider.ts>)
- [Pix2TexProvider.ts](</G:/PythonProjects/PDFReader/src/backend/providers/Pix2TexProvider.ts>)
- [pix2tex_runner.py](</G:/PythonProjects/PDFReader/src/backend/ocr/pix2tex_runner.py>)

### 数据库存储

- `formulas.ocr_provider` 已扩展为支持：
  - `mathpix`
  - `pix2tex`
- 新增 migration：
  - [002_formula_ocr_provider_pix2tex.sql](</G:/PythonProjects/PDFReader/src/backend/db/migrations/002_formula_ocr_provider_pix2tex.sql>)

相关文件：

- [001_init.sql](</G:/PythonProjects/PDFReader/src/backend/db/migrations/001_init.sql>)
- [002_formula_ocr_provider_pix2tex.sql](</G:/PythonProjects/PDFReader/src/backend/db/migrations/002_formula_ocr_provider_pix2tex.sql>)
- [FormulaRepository.ts](</G:/PythonProjects/PDFReader/src/backend/db/repositories/FormulaRepository.ts>)

## 3. pix2tex 本地接入方式

本项目当前采用“Electron 主进程调用本地 Python 脚本”的方式：

1. Renderer 截出公式图片
2. Main 保存图片到本地
3. `Pix2TexProvider` 使用配置里的 `pythonPath` 启动：
   [pix2tex_runner.py](</G:/PythonProjects/PDFReader/src/backend/ocr/pix2tex_runner.py>)
4. Python 脚本内部调用：
   `from pix2tex.cli import LatexOCR`
5. 返回识别出的 LaTeX JSON

这条链路的优点：

- 不需要在前端直接跑 Python
- 不暴露系统命令执行能力给 Renderer
- 后续更容易扩展成其他本地 OCR provider

## 4. 本地环境准备

建议给 `pix2tex` 单独准备一个 Python 环境，然后把这个环境里的 `python.exe` 填到设置页。

参考流程：

```powershell
python -m venv .venv-pix2tex
.venv-pix2tex\Scripts\activate
python -m pip install --upgrade pip
pip install pix2tex pillow
```

安装完成后，可以先做一个最小验证：

```powershell
.venv-pix2tex\Scripts\python.exe -c "from pix2tex.cli import LatexOCR; print('pix2tex ok')"
```

然后在应用设置页中：

1. 打开“服务配置”
2. 在“公式 OCR Provider”里选择 `pix2tex`
3. 在“pix2tex 本地 OCR”里填写这个 Python 路径
4. 保存配置

## 5. 当前限制

- `pix2tex` 首次运行可能下载模型权重，第一次识别会慢一些
- 当前实现是“每次识别启动一次 Python 进程”，方便集成，但性能不是最终形态
- 当前只支持通过 `pythonPath` 指向一个已经装好 `pix2tex` 的环境
- 还没有做“本地 OCR 健康检查”按钮
- 打包发布时需要额外确认 `.py` runner 文件被一起带上

## 6. 后续建议

下一步建议按这个顺序继续：

1. 增加“测试 pix2tex 配置”按钮
2. 在设置页显示当前 OCR provider 的生效状态
3. 给 `pix2tex` 增加首次下载/超时提示
4. 后续如需性能优化，再把 `pix2tex` 改成常驻后台服务

## 7. 官方参考

- [pix2tex 文档](https://pix2tex.readthedocs.io/en/latest/)
- [pix2tex PyPI](https://pypi.org/project/pix2tex/)
- [LaTeX-OCR GitHub 仓库](https://github.com/lukas-blecher/LaTeX-OCR)
