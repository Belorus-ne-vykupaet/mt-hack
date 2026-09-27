"""Export FastAPI schemas and browsable Swagger pages for the submission."""

import json
from pathlib import Path

from fastapi.openapi.docs import get_swagger_ui_html
from transit_ml.backend import app as backend
from transit_ml.inference import app as ml


ROOT = Path(__file__).resolve().parents[1]


def main():
    output = ROOT / "public" / "docs" / "api"
    output.mkdir(parents=True, exist_ok=True)
    gateway = json.loads((ROOT / "contracts" / "integration-openapi.json").read_text(encoding="utf-8"))
    for name, schema in (("backend", backend.openapi()), ("ml", ml.openapi()), ("gateway", gateway)):
        (output / f"{name}-openapi.json").write_text(
            json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        page = get_swagger_ui_html(
            openapi_url=f"./{name}-openapi.json",
            title=f"Transit Hub · {name} API",
            swagger_ui_parameters={"supportedSubmitMethods": [], "deepLinking": True},
        )
        html = "\n".join(line.rstrip() for line in page.body.decode().strip().splitlines()) + "\n"
        (output / f"{name}.html").write_text(html, encoding="utf-8")
        print(f"{name}: {len(schema['paths'])} documented paths")


if __name__ == "__main__":
    main()
