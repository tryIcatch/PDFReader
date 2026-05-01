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
    params: Pick<TranslateTextParams, "text" | "targetLang" | "context">,
  ): Promise<string> {
    const content = await this.requestChatCompletion(config, [
      {
        role: "system",
        content:
          "你是学术论文阅读助手。请只输出译文，保持术语准确、简洁，不要增加解释性前缀。",
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
          "你是论文公式讲解助手。请仅返回 JSON，不要使用 Markdown 代码块。JSON 结构必须是 {\"explanation\":\"...\",\"variables\":[{\"symbol\":\"...\",\"meaning\":\"...\"}]}。",
      },
      {
        role: "user",
        content: [
          "请用中文解释下面的公式，并提取变量含义。",
          `LaTeX: ${params.latex}`,
          params.context ? `上下文：${params.context}` : undefined,
          "要求 explanation 中包含：公式含义、使用场景和简化说明。",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ]);

    const parsed = this.parseJsonPayload(content) as
      | { explanation?: string; variables?: FormulaVariable[] }
      | undefined;

    return {
      explanation: parsed?.explanation?.trim() || content.trim(),
      variables: Array.isArray(parsed?.variables) ? parsed!.variables : [],
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
