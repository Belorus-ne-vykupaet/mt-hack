"""Build browsable PyDoc pages for the Python services shipped to the jury."""

import os
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "docs" / "python"
MODULES = (
    "transit_ml.backend",
    "transit_ml.features",
    "transit_ml.inference",
    "transit_ml.ndtp",
    "transit_ml.segments",
    "transit_ml.warnings",
    "transit_ml.outcomes",
    "mt_hack.features",
)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment["PYTHONPATH"] = os.pathsep.join((str(ROOT / "ml"), str(ROOT / "src")))
    # `pydoc -w` reports missing imports on stdout but still exits with code 0.
    # Validate the interpreter first so stale HTML cannot masquerade as a fresh build.
    subprocess.run(
        (sys.executable, "-c", "import importlib, sys; [importlib.import_module(name) for name in sys.argv[1:]]", *MODULES),
        cwd=ROOT,
        env=environment,
        check=True,
    )
    subprocess.run(
        (sys.executable, "-m", "pydoc", "-w", *MODULES),
        cwd=OUTPUT,
        env=environment,
        check=True,
    )
    for module in MODULES:
        page = OUTPUT / f"{module}.html"
        source = ("ml" if module.startswith("transit_ml.") else "src") + "/" + module.replace(".", "/") + ".py"
        github = f"https://github.com/Belorus-ne-vykupaet/mt-hack/blob/main/{source}"
        html = page.read_text(encoding="utf-8")
        html = re.sub(r'<a href="file:[^"]+">[^<]+</a>', f'<a href="{github}">Исходный код</a>', html)
        html = "\n".join(line.rstrip() for line in html.splitlines()) + "\n"
        page.write_text(html, encoding="utf-8")
    links = "\n".join(
        f'<li><a href="{module}.html">{module}</a></li>' for module in MODULES
    )
    (OUTPUT / "index.html").write_text(
        '<!doctype html><html lang="ru"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>Transit Hub — Python API</title>'
        '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:800px;'
        'margin:5vh auto;padding:0 24px;color:#17303a}a{color:#006c91}'
        'li{margin:12px 0}</style>'
        '<h1>Python API · Transit Hub</h1>'
        '<p>Сгенерированная документация PyDoc для Backend, ML и NDTP-приёмника.</p>'
        f'<ul>{links}</ul>'
        '<p><a href="/">Вернуться к дашборду</a></p></html>\n',
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
