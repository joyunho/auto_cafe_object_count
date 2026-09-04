#!/usr/bin/env bash
# 기획안 PDF용 한글 글꼴(Noto Sans KR) 내려받기 — 저장소에는 포함하지 않는다 (18MB)
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/docs/proposal/fonts"
mkdir -p "$dir"
curl -sS -o "$dir/NotoSansKR-400.ttf" "https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLQ.ttf"
curl -sS -o "$dir/NotoSansKR-500.ttf" "https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzztgyeLQ.ttf"
curl -sS -o "$dir/NotoSansKR-700.ttf" "https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzg01eLQ.ttf"
ls -la "$dir"
