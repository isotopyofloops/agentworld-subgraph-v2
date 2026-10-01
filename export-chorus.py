#!/usr/bin/env python3
"""Export approved chorus responses from the API into chorus-data.json.

The live store for chorus submissions is the API worker's KV namespace (see
api/src/chorus.js). This script pulls everything approved so the repo carries a
frozen, versioned copy for the exhibit's archival state.

Usage:
    python3 export-chorus.py                       # writes chorus-data.json
    python3 export-chorus.py --out some/other.json
    python3 export-chorus.py --api http://localhost:8787   # local wrangler dev
"""

import argparse
import json
import sys
import urllib.request

DEFAULT_API = "https://api.acrosstheseams.org"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default=DEFAULT_API, help=f"API base URL (default {DEFAULT_API})")
    ap.add_argument("--out", default="chorus-data.json", help="output file (default chorus-data.json)")
    args = ap.parse_args()

    url = args.api.rstrip("/") + "/chorus/export"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "export-chorus.py"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)

    responses = data.get("responses", [])
    out = {
        "meta": {
            "source": url,
            "exported_at": data.get("exported_at"),
            "count": len(responses),
            "review": "human",
            "note": "Approved reader and agent responses to Across the Seams. Live copy at GET /chorus; this file is the archival snapshot.",
        },
        "responses": responses,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Wrote {args.out}: {len(responses)} approved responses (exported {out['meta']['exported_at']})")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"export failed: {e}", file=sys.stderr)
        sys.exit(1)
