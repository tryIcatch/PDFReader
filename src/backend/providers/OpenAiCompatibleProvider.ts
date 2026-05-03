import type {
  ExplainFormulaResult,
  FormulaVariable,
  TranslateTextParams,
} from "@shared/types";

type OpenAiCompatibleRuntimeConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export class OpenAiCompatibleProvider {
  async translateText(
    config: OpenAiCompatibleRuntimeConfig,
    params: Pick<TranslateTextParams, "text" | "targetLang" | "context"> & {
      formulaProtected?: boolean;
    },
  ): Promise<string> {
    const systemContent = params.formulaProtected
      ? [
          "你是学术论文阅读助手。请只输出译文，保持术语准确、简洁。",
          "重要：文本中的 ⟦FORMULA_n⟧ 是数学公式占位符。",
          "1. 不要翻译、修改、删除任何占位符。",
          "2. 占位符必须原样保留在译文中。",
          "3. 只翻译周围的自然语言文本。",
          "4. 不要增加解释性前缀。",
        ].join("\n")
      : "你是学术论文阅读助手。请只输出译文，保持术语准确、简洁，不要增加解释性前缀。";

    const content = await this.requestChatCompletion(config, [
      {
        role: "system",
        content: systemContent,
      },
      {
        role: "user",
        content: [
          `目标语言：${params.targetLang}`,
          params.context ? `上下文：${params.context}` : undefined,
          "待翻译文本：",
          params.text,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ]);

    return content.trim();
  }

  async explainFormula(
    config: OpenAiCompatibleRuntimeConfig,
    params: { latex: string; context?: string },
  ): Promise<ExplainFormulaResult> {
    const content = await this.requestChatCompletion(config, [
      {
        role: "system",
        content:
          "你是论文公式讲解助手。请直接用 Markdown 格式输出公式的中文解释，不要包含 JSON、不要使用代码块、不要输出 explanation/variables/meaning 等字段名。数学公式使用 LaTeX 语法：行内公式用 \\(...\\)，块级公式用 \\[...\\]。",
      },
      {
        role: "user",
        content: [
          "请用中文解释下面的公式，直接输出可展示的 Markdown 正文。",
          `LaTeX: ${params.latex}`,
          params.context ? `上下文：${params.context}` : undefined,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ]);

    return {
      explanation: content.trim(),
      variables: [],
    };
  }

  private async requestChatCompletion(
    config: OpenAiCompatibleRuntimeConfig,
    messages: ChatMessage[],
  ): Promise<string> {
    const baseURL = config.baseURL.replace(/\/+$/, "");
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`AI request failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("AI response content is empty");
    }

    return content;
  }

  private parseJsonPayload(content: string): unknown {
    const normalized = content
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "");

    try {
      return JSON.parse(normalized);
    } catch {
      return undefined;
    }
  }
}
