"""Rewrite a downloaded archive without its single top-level folder, if it has one.

The jury command expects README.md etc. at the root of the ZIP. When the
download wraps everything in one folder, the audit records that and continues
with the same files at the root.

    python flatten_archive.py ARCHIVE.zip
"""

import os
import shutil
import sys
import zipfile


def main(path):
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if not n.endswith("/")]
        roots = {n.split("/", 1)[0] for n in names}
        if "README.md" in names or len(roots) != 1 or all("/" not in n for n in names):
            print("archive layout left as is")
            return
        root = roots.pop() + "/"
        flat = path + ".flat"
        with zipfile.ZipFile(flat, "w", allowZip64=True) as out:
            for info in archive.infolist():
                if info.filename.endswith("/"):
                    continue
                entry = zipfile.ZipInfo(info.filename[len(root):], info.date_time)
                with archive.open(info) as src, out.open(entry, "w", force_zip64=True) as dst:
                    shutil.copyfileobj(src, dst, 1 << 20)
    os.replace(flat, path)
    print(f"removed the top folder {root!r}")


if __name__ == "__main__":
    main(sys.argv[1])
