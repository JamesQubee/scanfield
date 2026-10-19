"""Small helper for tuning scenarios from the command line.

    python scripts/edit-scenario.py <file> <opp|mate|you> <id> "<json path>"
    python scripts/edit-scenario.py --format-all

Writes JSON with each keyframe on one line so the files stay readable.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "scenarios"


def dump(d: dict) -> str:
    text = json.dumps(d, indent=2, ensure_ascii=False)
    # Collapse arrays of plain numbers ([t, x, y] keys, [x, y] points) onto one line.
    text = re.sub(r"\[\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]", r"[\1, \2, \3]", text)
    text = re.sub(r"\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]", r"[\1, \2]", text)
    # Then put each entity's path on one line.
    text = re.sub(r"\"path\": \[\s+((?:\[[^\]]*\],?\s*)+)\]", lambda m: '"path": [' + ", ".join(re.findall(r"\[[^\]]*\]", m.group(1))) + "]", text)
    text = re.sub(r"\{\s+\"id\": (\"[^\"]+\"),\s+\"number\": (\d+),\s+(\"path\": \[[^\n]*\])\s+\}", r'{ "id": \1, "number": \2, \3 }', text)
    return text + "\n"


def main() -> None:
    if sys.argv[1] == "--format-all":
        for p in sorted(ROOT.glob("*.json")):
            p.write_text(dump(json.loads(p.read_text(encoding="utf8"))), encoding="utf8", newline="\n")
        return
    file, kind, ident, path = sys.argv[1:5]
    p = ROOT / file
    d = json.loads(p.read_text(encoding="utf8"))
    keys = json.loads(path)
    if kind == "you":
        d["you"]["path"] = keys
    else:
        group = d["opponents" if kind == "opp" else "teammates"]
        for e in group:
            if e["id"] == ident:
                e["path"] = keys
                break
        else:
            group.append({"id": ident, "number": int(re.sub(r"\D", "", ident)), "path": keys})
    p.write_text(dump(d), encoding="utf8", newline="\n")


if __name__ == "__main__":
    main()
