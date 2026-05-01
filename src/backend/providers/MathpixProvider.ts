import { readFile } from "node:fs/promises";
import { extname } from "node:path";

type MathpixRuntimeConfig = {
  appId: string;
  appKey: string;
};

type MathpixResponse = {
  latex_styled?: string;
  text?: string;
  confidence?: number;
  error?: string;
};

export class MathpixProvider {
  async testConnection(
    config: MathpixRuntimeConfig,
  ): Promise<{ success: true; message: string; details?: Record<string, unknown> }> {
    const response = await fetch("https://api.mathpix.com/v3/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        app_id: config.appId,
        app_key: config.appKey,
      },
      body: JSON.stringify({
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0r8AAAAASUVORK5CYII=",
        formats: ["text"],
      }),
    });

    const responseText = await response.text();

    if (response.ok) {
      return {
        success: true,
        message: "Mathpix 连接正常，鉴权已通过。",
        details: {
          status: response.status,
        },
      };
    }

    if (response.status === 400 || response.status === 422) {
      return {
        success: true,
        message: "Mathpix 连接正常，测试请求已到达服务端。",
        details: {
          status: response.status,
          body: responseText.slice(0, 300),
        },
      };
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Mathpix 鉴权失败：${response.status} ${responseText}`);
    }

    if (response.status === 429) {
      throw new Error(`Mathpix 请求被限流：${response.status} ${responseText}`);
    }

    throw new Error(`Mathpix request failed: ${response.status} ${responseText}`);
  }

  async recognizeFormula(
    config: MathpixRuntimeConfig,
    params: { imagePath: string },
  ): Promise<{ latex: string; confidence?: number; raw?: unknown }> {
    const buffer = await readFile(params.imagePath);
    const extension = extname(params.imagePath).toLowerCase();
    const mimeType =
      extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".webp"
          ? "image/webp"
          : "image/png";

    const response = await fetch("https://api.mathpix.com/v3/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        app_id: config.appId,
        app_key: config.appKey,
      },
      body: JSON.stringify({
        src: `data:${mimeType};base64,${buffer.toString("base64")}`,
        formats: ["latex_styled", "text"],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Mathpix request failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as MathpixResponse;
    const latex = data.latex_styled?.trim() || data.text?.trim();

    if (!latex) {
      throw new Error("Mathpix did not return LaTeX content");
    }

    return {
      latex,
      confidence: data.confidence,
      raw: data,
    };
  }
}
