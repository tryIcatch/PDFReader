import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, join } from "node:path";

type Pix2TexRuntimeConfig = {
  pythonPath: string;
  scriptPath: string;
};

type Pix2TexRunnerResult = {
  latex?: string;
  error?: string;
  detail?: string;
  status?: string;
  python?: string;
  pix2texVersion?: string;
  pillowVersion?: string;
  message?: string;
};

export class Pix2TexProvider {
  async recognizeFormula(
    config: Pix2TexRuntimeConfig,
    params: { imagePath: string },
  ): Promise<{ latex: string; confidence?: number; raw?: unknown }> {
    await access(config.scriptPath, fsConstants.R_OK).catch(() => {
      throw new Error(`pix2tex runner 不存在：${config.scriptPath}`);
    });

    const resolvedPythonPath = await this.resolvePythonCommand(config.pythonPath);
    const runnerOutput = await this.runPython(
      {
        ...config,
        pythonPath: resolvedPythonPath,
      },
      [params.imagePath],
    );

    if (runnerOutput.error) {
      throw new Error(
        runnerOutput.detail
          ? `${runnerOutput.error}: ${runnerOutput.detail}`
          : runnerOutput.error,
      );
    }

    const latex = runnerOutput.latex?.trim();

    if (!latex) {
      throw new Error("pix2tex 没有返回 LaTeX 内容");
    }

    return {
      latex,
      raw: runnerOutput,
    };
  }

  async testEnvironment(
    config: Pix2TexRuntimeConfig,
  ): Promise<{ success: true; message: string; details?: Record<string, unknown> }> {
    await access(config.scriptPath, fsConstants.R_OK).catch(() => {
      throw new Error(`pix2tex runner 不存在：${config.scriptPath}`);
    });

    const resolvedPythonPath = await this.resolvePythonCommand(config.pythonPath);
    const runnerOutput = await this.runPython(
      {
        ...config,
        pythonPath: resolvedPythonPath,
      },
      ["--healthcheck"],
    );

    if (runnerOutput.error) {
      throw new Error(
        runnerOutput.detail
          ? `${runnerOutput.error}: ${runnerOutput.detail}`
          : runnerOutput.error,
      );
    }

    return {
      success: true,
      message:
        runnerOutput.message ?? "pix2tex 环境检查通过，已成功导入 pix2tex 和 Pillow。",
      details: {
        python: runnerOutput.python,
        pix2texVersion: runnerOutput.pix2texVersion,
        pillowVersion: runnerOutput.pillowVersion,
      },
    };
  }

  private async resolvePythonCommand(inputPath: string): Promise<string> {
    const trimmedPath = inputPath.trim();

    if (!trimmedPath) {
      throw new Error("pix2tex Python 路径不能为空");
    }

    if (!looksLikePath(trimmedPath)) {
      return trimmedPath;
    }

    const directStat = await safeStat(trimmedPath);

    if (directStat?.isFile()) {
      return trimmedPath;
    }

    if (directStat?.isDirectory()) {
      const candidates =
        process.platform === "win32"
          ? [
              join(trimmedPath, "python.exe"),
              join(trimmedPath, "Scripts", "python.exe"),
              join(trimmedPath, "python"),
            ]
          : [join(trimmedPath, "bin", "python"), join(trimmedPath, "python")];

      for (const candidate of candidates) {
        const candidateStat = await safeStat(candidate);

        if (candidateStat?.isFile()) {
          return candidate;
        }
      }

      throw new Error(
        `pix2tex Python 路径看起来是一个环境目录，但没有找到可执行文件。请填写 python.exe，或直接填写包含 python.exe 的环境目录：${trimmedPath}`,
      );
    }

    if (
      process.platform === "win32" &&
      !basename(trimmedPath).toLowerCase().endsWith(".exe")
    ) {
      const exeCandidate = `${trimmedPath}.exe`;
      const exeStat = await safeStat(exeCandidate);

      if (exeStat?.isFile()) {
        return exeCandidate;
      }
    }

    throw new Error(
      `pix2tex Python 不存在：${trimmedPath}。请填写 python.exe 路径，或直接填写 conda/venv 环境目录。`,
    );
  }

  private async runPython(
    config: Pix2TexRuntimeConfig,
    runnerArgs: string[],
  ): Promise<Pix2TexRunnerResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(config.pythonPath, [config.scriptPath, ...runnerArgs], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
        },
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        reject(
          new Error(
            `启动 pix2tex Python 失败：${config.pythonPath}。${error.message}`,
          ),
        );
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `pix2tex 进程退出码异常：${code ?? "unknown"}`));
          return;
        }

        try {
          resolve(JSON.parse(stdout) as Pix2TexRunnerResult);
        } catch {
          reject(new Error(stdout.trim() || stderr.trim() || "pix2tex 输出无法解析"));
        }
      });
    });
  }
}

function looksLikePath(value: string): boolean {
  return value.includes("\\") || value.includes("/") || /^[a-zA-Z]:/.test(value);
}

async function safeStat(targetPath: string) {
  try {
    return await stat(targetPath);
  } catch {
    return null;
  }
}
