#!/bin/bash
set -e

cd /home/site/wwwroot

echo "[startup] python $(python --version)"
echo "[startup] installing requirements..."
python -m pip install --upgrade pip
python -m pip install --prefer-binary --no-cache-dir -r requirements.txt

python -m pip freeze > /home/site/wwwroot/installed-packages.txt 2>/dev/null || true

echo "[startup] starting uvicorn (codegen) on 0.0.0.0:8000..."
exec python -m uvicorn main:app --host 0.0.0.0 --port 8000
