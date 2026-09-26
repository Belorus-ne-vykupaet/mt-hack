"""Turn the downloaded public folder into the dataset ZIP the jury command expects.

The public link is a folder «Предиктор задержек транспорта» holding one file,
dataset.zip; the Yandex Disk API returns that folder zipped. The audit records
the failure of the documented command and continues with the inner archive.

    python flatten_archive.py ARCHIVE.zip
"""

import os
import shutil
import sys
import zipfile


def main(path):
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if not n.endswith("/")]
        if "README.md" in names:
            print("archive already has the dataset layout")
            return
        if len(names) == 1 and names[0].endswith(".zip"):
            inner = path + ".inner"
            with archive.open(names[0]) as src, open(inner, "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 20)
            print(f"extracted the nested {names[0]!r}")
        else:
            roots = {n.split("/", 1)[0] for n in names}
            if len(roots) != 1:
                raise SystemExit(f"unexpected archive layout: {names[:10]}")
            root = roots.pop() + "/"
            inner = path + ".inner"
            with zipfile.ZipFile(inner, "w", allowZip64=True) as out:
                for info in archive.infolist():
                    if info.filename.endswith("/"):
                        continue
                    entry = zipfile.ZipInfo(info.filename[len(root):], info.date_time)
                    with archive.open(info) as src, out.open(entry, "w", force_zip64=True) as dst:
                        shutil.copyfileobj(src, dst, 1 << 20)
            print(f"removed the top folder {root!r}")
    os.replace(inner, path)


if __name__ == "__main__":
    main(sys.argv[1])
