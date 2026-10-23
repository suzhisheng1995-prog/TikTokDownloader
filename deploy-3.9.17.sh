#!/usr/bin/env bash
set -euo pipefail

PACKAGE="/home/ubuntu/ruiying-online-update-server-3.9.17.tar.gz"
TARGET="/opt/ruiying"

sudo tar -xzf "$PACKAGE" -C "$TARGET"
sudo chmod 644 "$TARGET/server.js" "$TARGET/admin.html" "$TARGET/update.json"
sudo chmod 644 "$TARGET/downloads/ruiying-ai-setup.exe"
sudo systemctl restart ruiying
sudo systemctl status ruiying --no-pager

curl -fsS https://gateway.daifa68.cn/api/app-update
