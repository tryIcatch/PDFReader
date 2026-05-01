import katex from "katex";

type FormulaRenderProps = {
  latex?: string;
};

export function FormulaRender(props: FormulaRenderProps) {
  if (!props.latex) {
    return (
      <div className="formula-render formula-render--empty">
        识别出 LaTeX 后，这里会显示排版后的公式。
      </div>
    );
  }

  try {
    const html = katex.renderToString(props.latex, {
      displayMode: true,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });

    return <div className="formula-render" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch (error) {
    return (
      <div className="formula-render formula-render--error">
        {error instanceof Error ? error.message : "公式渲染失败"}
      </div>
    );
  }
}
