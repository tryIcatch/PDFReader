import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { settingsService } from "../services/settingsService";

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
  onStatusChange: (status: string) => void;
  onThemeChange?: (accentColor: string) => void;
  focusColumnMode: "single" | "double";
  onFocusColumnModeChange: (mode: "single" | "double") => void;
};

const themeSwatches = ["#7f4f24", "#2563eb", "#0f766e", "#b45309", "#be123c", "#6d28d9"];

export function SettingsModal(props: SettingsModalProps) {
  const [loading, setLoading] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [savingFormulaOcr, setSavingFormulaOcr] = useState(false);
  const [savingMathpix, setSavingMathpix] = useState(false);
  const [testingMathpix, setTestingMathpix] = useState(false);
  const [savingPix2Tex, setSavingPix2Tex] = useState(false);
  const [testingPix2Tex, setTestingPix2Tex] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [feedback, setFeedback] = useState("");

  const [aiBaseURL, setAiBaseURL] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiConfigured, setAiConfigured] = useState(false);

  const [mathpixAppId, setMathpixAppId] = useState("");
  const [mathpixAppKey, setMathpixAppKey] = useState("");
  const [mathpixConfigured, setMathpixConfigured] = useState(false);
  const [mathpixTestFeedback, setMathpixTestFeedback] = useState("");
  const [formulaOcrProvider, setFormulaOcrProvider] = useState<"mathpix" | "pix2tex">("mathpix");
  const [pix2texPythonPath, setPix2texPythonPath] = useState("");
  const [pix2texConfigured, setPix2texConfigured] = useState(false);
  const [pix2texTestFeedback, setPix2texTestFeedback] = useState("");
  const [hoverTranslateEnabled, setHoverTranslateEnabled] = useState(false);
  const [savingHoverTranslate, setSavingHoverTranslate] = useState(false);
  const [themeColor, setThemeColor] = useState("#7f4f24");

  useEffect(() => {
    if (!props.open) {
      return;
    }

    let canceled = false;

    async function loadSettings() {
      setLoading(true);
      setFeedback("");

      try {
        const [aiSettings, mathpixSettings, pix2texSettings, formulaOcrSettings, themeSettings, hoverTranslateSettings] = await Promise.all([
          settingsService.getAiSettings(),
          settingsService.getMathpixSettings(),
          settingsService.getPix2TexSettings(),
          settingsService.getFormulaOcrSettings(),
          settingsService.getThemeSettings(),
          settingsService.getHoverTranslateSettings(),
        ]);

        if (canceled) {
          return;
        }

        setAiBaseURL(aiSettings?.baseURL ?? "");
        setAiModel(aiSettings?.model ?? "");
        setAiApiKey("");
        setAiConfigured(Boolean(aiSettings?.configured));

        setMathpixAppId(mathpixSettings?.appId ?? "");
        setMathpixAppKey("");
        setMathpixConfigured(Boolean(mathpixSettings?.configured));
        setMathpixTestFeedback("");
        setPix2texPythonPath(pix2texSettings?.pythonPath ?? "");
        setPix2texConfigured(Boolean(pix2texSettings?.configured));
        setPix2texTestFeedback("");
        setFormulaOcrProvider(formulaOcrSettings?.provider ?? "mathpix");
        setHoverTranslateEnabled(hoverTranslateSettings.enabled);
        setThemeColor(themeSettings.accentColor);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "读取设置失败";
        setFeedback(message);
        props.onStatusChange(message);
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      canceled = true;
    };
  }, [props.open, props.onStatusChange]);

  async function handleSaveAiSettings() {
    setSavingAi(true);
    setFeedback("");

    try {
      await settingsService.saveAiSettings({
        baseURL: aiBaseURL.trim(),
        model: aiModel.trim(),
        apiKey: aiApiKey.trim() || undefined,
      });

      setAiConfigured(true);
      setAiApiKey("");
      setFeedback("AI 配置已保存");
      props.onStatusChange("AI 配置已保存");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存 AI 配置失败";
      setFeedback(message);
      props.onStatusChange(message);
    } finally {
      setSavingAi(false);
    }
  }

  async function handleSaveFormulaOcrSettings() {
    setSavingFormulaOcr(true);
    setFeedback("");

    try {
      await settingsService.saveFormulaOcrSettings({
        provider: formulaOcrProvider,
      });

      const providerLabel = formulaOcrProvider === "mathpix" ? "Mathpix" : "pix2tex";
      setFeedback(`公式 OCR provider 已切换到 ${providerLabel}`);
      props.onStatusChange(`公式 OCR provider 已切换到 ${providerLabel}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存公式 OCR 配置失败";
      setFeedback(message);
      props.onStatusChange(message);
    } finally {
      setSavingFormulaOcr(false);
    }
  }

  async function handleSaveMathpixSettings() {
    setSavingMathpix(true);
    setFeedback("");

    try {
      await settingsService.saveMathpixSettings({
        appId: mathpixAppId.trim(),
        appKey: mathpixAppKey.trim() || undefined,
      });

      setMathpixConfigured(true);
      setMathpixAppKey("");
      setFeedback("Mathpix 配置已保存");
      props.onStatusChange("Mathpix 配置已保存");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存 Mathpix 配置失败";
      setFeedback(message);
      props.onStatusChange(message);
    } finally {
      setSavingMathpix(false);
    }
  }

  async function handleTestMathpixSettings() {
    setTestingMathpix(true);
    setFeedback("");
    setMathpixTestFeedback("");

    try {
      const result = await settingsService.testMathpixSettings({
        appId: mathpixAppId.trim(),
        appKey: mathpixAppKey.trim() || undefined,
      });

      setMathpixTestFeedback(result.message);
      props.onStatusChange(result.message);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "测试 Mathpix 配置失败";
      setMathpixTestFeedback(message);
      props.onStatusChange(message);
    } finally {
      setTestingMathpix(false);
    }
  }

  async function handleSavePix2TexSettings() {
    setSavingPix2Tex(true);
    setFeedback("");

    try {
      await settingsService.savePix2TexSettings({
        pythonPath: pix2texPythonPath.trim(),
      });

      setPix2texConfigured(true);
      setFeedback("pix2tex 配置已保存");
      props.onStatusChange("pix2tex 配置已保存");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存 pix2tex 配置失败";
      setFeedback(message);
      props.onStatusChange(message);
    } finally {
      setSavingPix2Tex(false);
    }
  }

  async function handleTestPix2TexSettings() {
    setTestingPix2Tex(true);
    setFeedback("");
    setPix2texTestFeedback("");

    try {
      const result = await settingsService.testPix2TexSettings({
        pythonPath: pix2texPythonPath.trim(),
      });

      const detailParts = [
        result.details?.python ? `Python: ${String(result.details.python)}` : undefined,
        result.details?.pix2texVersion
          ? `pix2tex: ${String(result.details.pix2texVersion)}`
          : undefined,
        result.details?.pillowVersion ? `Pillow: ${String(result.details.pillowVersion)}` : undefined,
      ].filter(Boolean);

      const detailText = detailParts.length > 0 ? `\n${detailParts.join(" · ")}` : "";
      const message = `${result.message}${detailText}`;
      setPix2texTestFeedback(message);
      props.onStatusChange(result.message);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "测试 pix2tex 配置失败";
      setPix2texTestFeedback(message);
      props.onStatusChange(message);
    } finally {
      setTestingPix2Tex(false);
    }
  }

  async function handleSaveHoverTranslateSettings(enabled: boolean) {
    setSavingHoverTranslate(true);
    setFeedback("");

    try {
      await settingsService.saveHoverTranslateSettings({ enabled });
      setHoverTranslateEnabled(enabled);
      setFeedback(enabled ? "悬停翻译已开启" : "悬停翻译已关闭");
      props.onStatusChange(enabled ? "悬停翻译已开启" : "悬停翻译已关闭");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存悬停翻译设置失败";
      setFeedback(message);
      props.onStatusChange(message);
    } finally {
      setSavingHoverTranslate(false);
    }
  }

  async function handleSaveThemeSettings(nextColor = themeColor) {
    const normalizedColor = normalizeHexColor(nextColor);

    if (!normalizedColor) {
      setFeedback("主题色需要使用 #RRGGBB 格式");
      return;
    }

    setSavingTheme(true);
    setFeedback("");

    try {
      await settingsService.saveThemeSettings({
        accentColor: normalizedColor,
      });

      setThemeColor(normalizedColor);
      props.onThemeChange?.(normalizedColor);
      setFeedback("主题色已保存");
      props.onStatusChange("主题色已保存");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存主题色失败";
      setFeedback(message);
      props.onStatusChange(message);
    } finally {
      setSavingTheme(false);
    }
  }

  if (!props.open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>服务配置</h2>
          </div>
          <button className="icon-button settings-close-button" onClick={props.onClose} aria-label="关闭设置">
            <X size={18} strokeWidth={2.2} />
            关闭
          </button>
        </div>

        {loading ? <p className="muted">正在读取现有配置…</p> : null}
        <div className={feedback ? "settings-feedback" : "settings-feedback settings-feedback--hidden"}>{feedback || " "}</div>

        <div className="settings-grid">
          <section className="settings-card">
            <div className="settings-card-header">
              <h3>Theme Color</h3>
              <span className="settings-badge" style={{ background: themeColor, color: "#fff" }}>
                {themeColor}
              </span>
            </div>

            <div className="theme-picker-preview" style={{ background: themeColor }}>
              <span>Accent</span>
            </div>

            <div className="theme-swatch-grid" aria-label="theme presets">
              {themeSwatches.map((color) => (
                <button
                  key={color}
                  className={
                    color.toLowerCase() === themeColor.toLowerCase()
                      ? "theme-swatch theme-swatch--active"
                      : "theme-swatch"
                  }
                  style={{ background: color }}
                  title={color}
                  onClick={() => {
                    setThemeColor(color);
                    props.onThemeChange?.(color);
                  }}
                  type="button"
                />
              ))}
            </div>

            <label className="settings-field">
              <span>Color Picker</span>
              <div className="theme-color-row">
                <input
                  className="theme-color-input"
                  type="color"
                  value={themeColor}
                  onChange={(event) => {
                    setThemeColor(event.target.value);
                    props.onThemeChange?.(event.target.value);
                  }}
                />
                <input
                  value={themeColor}
                  onChange={(event) => setThemeColor(event.target.value)}
                  onBlur={(event) => {
                    const normalizedColor = normalizeHexColor(event.target.value);

                    if (normalizedColor) {
                      setThemeColor(normalizedColor);
                      props.onThemeChange?.(normalizedColor);
                    }
                  }}
                  placeholder="#7f4f24"
                />
              </div>
            </label>

            <div className="panel-actions">
              <button disabled={savingTheme} onClick={() => void handleSaveThemeSettings()}>
                {savingTheme ? "Saving..." : "Save Theme"}
              </button>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-header">
              <h3>悬停翻译</h3>
              <span className={hoverTranslateEnabled ? "settings-badge settings-badge--ok" : "settings-badge"}>
                {hoverTranslateEnabled ? "已开启" : "已关闭"}
              </span>
            </div>

            <p className="muted">
              开启后，划选 PDF 文本时会自动翻译。AI 面板展开时译文出现在面板内，面板收起时译文以浮窗展示在选中位置附近，几秒后自动消失。
            </p>

            <div className="panel-actions">
              <button
                disabled={savingHoverTranslate}
                onClick={() => void handleSaveHoverTranslateSettings(!hoverTranslateEnabled)}
              >
                {savingHoverTranslate
                  ? "保存中…"
                  : hoverTranslateEnabled
                    ? "关闭悬停翻译"
                    : "开启悬停翻译"}
              </button>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-header">
              <h3>专注模式</h3>
              <span className="settings-badge">
                {props.focusColumnMode === "single" ? "单栏" : "双栏"}
              </span>
            </div>

            <p className="muted">
              设置 PDF 的排版方式。单栏模式下，鼠标所在整行清晰；双栏模式下，仅鼠标所在栏清晰，另一栏模糊。
            </p>

            <div className="settings-provider-group">
              <label className="settings-provider-option">
                <input
                  type="radio"
                  name="focus-column-mode"
                  checked={props.focusColumnMode === "single"}
                  onChange={() => props.onFocusColumnModeChange("single")}
                />
                <div>
                  <strong>单栏</strong>
                  <p className="muted">适合单栏排版论文。鼠标所在行全宽清晰。</p>
                </div>
              </label>

              <label className="settings-provider-option">
                <input
                  type="radio"
                  name="focus-column-mode"
                  checked={props.focusColumnMode === "double"}
                  onChange={() => props.onFocusColumnModeChange("double")}
                />
                <div>
                  <strong>双栏</strong>
                  <p className="muted">适合双栏排版论文。鼠标所在栏清晰，另一栏模糊。</p>
                </div>
              </label>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-header">
              <h3>公式 OCR Provider</h3>
              <span className="settings-badge">{formulaOcrProvider === "mathpix" ? "Mathpix" : "pix2tex"}</span>
            </div>

            <div className="settings-provider-group">
              <label className="settings-provider-option">
                <input
                  type="radio"
                  name="formula-ocr-provider"
                  checked={formulaOcrProvider === "mathpix"}
                  onChange={() => setFormulaOcrProvider("mathpix")}
                />
                <div>
                  <strong>Mathpix 云端</strong>
                  <p className="muted">识别效果稳，依赖网络和 App ID / App Key。</p>
                </div>
              </label>

              <label className="settings-provider-option">
                <input
                  type="radio"
                  name="formula-ocr-provider"
                  checked={formulaOcrProvider === "pix2tex"}
                  onChange={() => setFormulaOcrProvider("pix2tex")}
                />
                <div>
                  <strong>pix2tex 本地</strong>
                  <p className="muted">走本地 Python 环境，首次运行可能下载模型权重。</p>
                </div>
              </label>
            </div>

            <div className="panel-actions">
              <button disabled={savingFormulaOcr} onClick={() => void handleSaveFormulaOcrSettings()}>
                {savingFormulaOcr ? "保存中…" : "保存 OCR Provider"}
              </button>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-header">
              <h3>OpenAI 兼容接口</h3>
              <span className={aiConfigured ? "settings-badge settings-badge--ok" : "settings-badge"}>
                {aiConfigured ? "已配置" : "未配置"}
              </span>
            </div>

            <label className="settings-field">
              <span>Base URL</span>
              <input
                value={aiBaseURL}
                onChange={(event) => setAiBaseURL(event.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </label>

            <label className="settings-field">
              <span>Model</span>
              <input
                value={aiModel}
                onChange={(event) => setAiModel(event.target.value)}
                placeholder="gpt-4.1-mini / deepseek-chat / 其他兼容模型"
              />
            </label>

            <label className="settings-field">
              <span>API Key</span>
              <input
                type="password"
                value={aiApiKey}
                onChange={(event) => setAiApiKey(event.target.value)}
                placeholder={aiConfigured ? "留空则保留当前密钥" : "首次保存时必填"}
              />
            </label>

            <p className="muted">
              仅保存兼容 OpenAI Chat Completions 协议的配置。已有密钥时，可只改 Base URL 或 Model。
            </p>

            <div className="panel-actions">
              <button disabled={savingAi} onClick={() => void handleSaveAiSettings()}>
                {savingAi ? "保存中…" : "保存 AI 配置"}
              </button>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-header">
              <h3>Mathpix OCR</h3>
              <span
                className={
                  mathpixConfigured ? "settings-badge settings-badge--ok" : "settings-badge"
                }
              >
                {mathpixConfigured ? "已配置" : "未配置"}
              </span>
            </div>

            <label className="settings-field">
              <span>App ID</span>
              <input
                value={mathpixAppId}
                onChange={(event) => setMathpixAppId(event.target.value)}
                placeholder="Mathpix App ID"
              />
            </label>

            <label className="settings-field">
              <span>App Key</span>
              <input
                type="password"
                value={mathpixAppKey}
                onChange={(event) => setMathpixAppKey(event.target.value)}
                placeholder={mathpixConfigured ? "留空则保留当前密钥" : "首次保存时必填"}
              />
            </label>

            <p className="muted">
              保留云端 OCR 能力。已有密钥时，可只修改 App ID，不需要重复输入 App Key。
            </p>

            <div className="panel-actions">
              <button disabled={savingMathpix} onClick={() => void handleSaveMathpixSettings()}>
                {savingMathpix ? "保存中…" : "保存 Mathpix 配置"}
              </button>
              <button
                className="secondary"
                disabled={testingMathpix}
                onClick={() => void handleTestMathpixSettings()}
              >
                {testingMathpix ? "测试中…" : "测试 Mathpix 配置"}
              </button>
            </div>
            {mathpixTestFeedback ? (
              <p className="settings-card-feedback">{mathpixTestFeedback}</p>
            ) : null}
          </section>

          <section className="settings-card">
            <div className="settings-card-header">
              <h3>pix2tex 本地 OCR</h3>
              <span
                className={
                  pix2texConfigured ? "settings-badge settings-badge--ok" : "settings-badge"
                }
              >
                {pix2texConfigured ? "已配置" : "未配置"}
              </span>
            </div>

            <label className="settings-field">
              <span>Python Path</span>
              <input
                value={pix2texPythonPath}
                onChange={(event) => setPix2texPythonPath(event.target.value)}
                placeholder="例如：C:\\Users\\you\\miniconda3\\envs\\pix2tex 或 C:\\Users\\you\\miniconda3\\envs\\pix2tex\\python.exe"
              />
            </label>

            <p className="muted">
              这里可以填写已经安装好 `pix2tex` 的 `python.exe` 路径，也可以直接填写 conda / venv 环境目录。本地模式下，公式截图会交给这个 Python 环境完成 LaTeX 识别。
            </p>

            <div className="panel-actions">
              <button disabled={savingPix2Tex} onClick={() => void handleSavePix2TexSettings()}>
                {savingPix2Tex ? "保存中…" : "保存 pix2tex 配置"}
              </button>
              <button
                className="secondary"
                disabled={testingPix2Tex}
                onClick={() => void handleTestPix2TexSettings()}
              >
                {testingPix2Tex ? "测试中…" : "测试 pix2tex 配置"}
              </button>
            </div>
            {pix2texTestFeedback ? (
              <p className="settings-card-feedback settings-card-feedback--multiline">
                {pix2texTestFeedback}
              </p>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  );
}

function normalizeHexColor(value: string): string | null {
  const trimmedValue = value.trim();
  const expandedValue = /^#[0-9a-fA-F]{3}$/.test(trimmedValue)
    ? `#${trimmedValue[1]}${trimmedValue[1]}${trimmedValue[2]}${trimmedValue[2]}${trimmedValue[3]}${trimmedValue[3]}`
    : trimmedValue;

  return /^#[0-9a-fA-F]{6}$/.test(expandedValue) ? expandedValue.toLowerCase() : null;
}
