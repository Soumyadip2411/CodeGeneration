#!/bin/bash
set -e
cd /home/site/wwwroot
echo "[startup] node: $(node --version)"
echo "[startup] PORT=${PORT:-8080}"
echo "[startup] starting static server on 0.0.0.0:${PORT:-8080}..."
exec node server.js
