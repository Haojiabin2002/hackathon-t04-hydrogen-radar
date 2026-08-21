#!/bin/sh
set -eu

DATA_ROOT="${RADAR_DATA_ROOT:-/data}"
APP_ROOT="${RADAR_APP_ROOT:-/app/radar}"

mkdir -p "$DATA_ROOT" "$DATA_ROOT/home" "$DATA_ROOT/skills"
export HOME="$DATA_ROOT/home"

persist_file() {
  name="$1"
  source_path="$APP_ROOT/$name"
  data_path="$DATA_ROOT/$name"

  if [ ! -e "$data_path" ]; then
    cp "$source_path" "$data_path"
  fi
  rm -f "$source_path"
  ln -s "$data_path" "$source_path"
}

persist_file "sources.yaml"
persist_file "knowledge.md"

if [ ! -e "$DATA_ROOT/.skills-initialized" ]; then
  cp -R "$APP_ROOT/skills/." "$DATA_ROOT/skills/"
  touch "$DATA_ROOT/.skills-initialized"
fi
rm -rf "$APP_ROOT/skills"
ln -s "$DATA_ROOT/skills" "$APP_ROOT/skills"

# db.py 的路径是项目数据契约，不改它；运行时用符号链接把 SQLite 放进持久卷。
rm -f "$APP_ROOT/radar.db"
ln -s "$DATA_ROOT/radar.db" "$APP_ROOT/radar.db"
"${PYTHON_BIN:-python3}" "$APP_ROOT/db.py"

cd "$APP_ROOT"
exec uvicorn api:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips="*"
