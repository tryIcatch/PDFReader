import json
import sys
import traceback
from importlib import metadata


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "--healthcheck":
        try:
            import PIL  # noqa: F401
            import pix2tex  # noqa: F401
            from pix2tex.cli import LatexOCR  # noqa: F401
        except Exception as exc:  # pragma: no cover - runtime environment dependent
            emit(
                {
                    "error": "pix2tex 环境检查失败",
                    "detail": f"{exc.__class__.__name__}: {exc}",
                }
            )
            return 0

        emit(
            {
                "status": "ok",
                "python": sys.executable,
                "pix2texVersion": metadata.version("pix2tex"),
                "pillowVersion": metadata.version("pillow"),
                "message": "pix2tex 环境检查通过，已成功导入 pix2tex 和 Pillow。",
            }
        )
        return 0

    if len(sys.argv) < 2:
        emit({"error": "缺少 imagePath 参数"})
        return 1

    image_path = sys.argv[1]

    try:
        from PIL import Image
        from pix2tex.cli import LatexOCR
    except Exception as exc:  # pragma: no cover - runtime environment dependent
        emit(
            {
                "error": "pix2tex 依赖未安装",
                "detail": f"{exc.__class__.__name__}: {exc}",
            }
        )
        return 0

    try:
        image = Image.open(image_path).convert("RGB")
        model = LatexOCR()
        latex = model(image)
        emit({"latex": latex})
        return 0
    except Exception as exc:  # pragma: no cover - runtime environment dependent
        emit(
            {
                "error": "pix2tex 识别失败",
                "detail": "".join(traceback.format_exception_only(type(exc), exc)).strip(),
            }
        )
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
