#!/usr/bin/env python3
"""
Build store-ready zips of HexBlock Shield for Chrome, Edge and Firefox.

    python3 scripts/package.py            # writes to dist/

Per-browser differences:
  - Chrome / Edge: browser_specific_settings removed (Gecko-only key).
  - Firefox: background.service_worker replaced with background.scripts
    (Firefox MV3 has no service worker support), minimum version 115
    (declarativeNetRequest and storage.session).

All builds strip the redundant "priority": 1 from filters.json. 1 is the
declarativeNetRequest default, so rule behaviour is unchanged, and it keeps
the file under the 5 MB limit enforced by the Firefox Add-ons linter.
"""

import json
import os
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

FILES = ["manifest.json", "popup.html", "options.html", "README.md", "LICENSE"]
DIRS = ["src", "icons", "lists"]

FIREFOX_MIN = "115.0"


def write_json(path, data, compact=False):
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(data, f, separators=(",", ":"))
        else:
            json.dump(data, f, indent=2)
            f.write("\n")


def stage(name, manifest):
    out = os.path.join(DIST, name)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    for f in FILES:
        shutil.copy2(os.path.join(ROOT, f), out)
    for d in DIRS:
        shutil.copytree(os.path.join(ROOT, d), os.path.join(out, d))

    write_json(os.path.join(out, "manifest.json"), manifest)

    filters_path = os.path.join(out, "lists", "filters.json")
    with open(filters_path, encoding="utf-8") as f:
        rules = json.load(f)
    for rule in rules:
        if rule.get("priority") == 1:
            del rule["priority"]
        rts = rule.get("condition", {}).get("resourceTypes", [])
        if rule["action"]["type"] == "block" and ("main_frame" in rts or "sub_frame" in rts):
            sys.exit(f"rule {rule['id']}: block rules must not include main_frame or sub_frame")
    write_json(filters_path, rules, compact=True)

    zip_path = os.path.join(DIST, f"hexblock-shield-{manifest['version']}-{name}.zip")
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _, filenames in os.walk(out):
            for fn in sorted(filenames):
                full = os.path.join(dirpath, fn)
                zf.write(full, os.path.relpath(full, out))
    print(zip_path)


def main():
    with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
        base = json.load(f)

    chromium = json.loads(json.dumps(base))
    chromium.pop("browser_specific_settings", None)
    stage("chrome", chromium)
    stage("edge", chromium)

    firefox = json.loads(json.dumps(base))
    firefox["background"] = {"scripts": [base["background"]["service_worker"]], "type": "module"}
    bss = firefox.setdefault("browser_specific_settings", {})
    for key in ("gecko", "gecko_android"):
        if key in bss:
            bss[key]["strict_min_version"] = FIREFOX_MIN
    stage("firefox", firefox)


if __name__ == "__main__":
    main()
