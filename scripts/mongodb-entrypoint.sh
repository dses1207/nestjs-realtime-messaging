#!/bin/bash

# MongoDB Replica Set Entrypoint 腳本
# 用於在容器啟動時自動修正 keyFile 權限問題

set -e

echo "🔐 MongoDB Replica Set Entrypoint"
echo "=================================="

# KeyFile 來源路徑（掛載 keys/ 目錄進來；直接掛單一檔案時，檔案不存在 Docker 會建出一個同名目錄）
KEYFILE_SOURCE="/etc/mongodb-keys/mongodb-keyfile"
# KeyFile 目標路徑（容器內部，會設定正確權限）
KEYFILE_TARGET="/etc/mongodb-keyfile"

# 有提供 keyFile（keys/mongodb-keyfile）就用它；沒有就在容器內自動產生一份。
# 單節點 replica set 的 keyFile 只給自己用，每次啟動重新產生也沒關係；
# 多節點時所有成員必須共用同一份，請用 scripts/generate-mongodb-keyfile.sh 產生後掛進來。
if [ -f "${KEYFILE_SOURCE}" ]; then
    cp "${KEYFILE_SOURCE}" "${KEYFILE_TARGET}"
    echo "✅ 使用掛載的 keyFile: ${KEYFILE_SOURCE}"
else
    head -c 756 /dev/urandom | base64 | tr -d '\n' > "${KEYFILE_TARGET}"
    echo "✅ 未提供 keyFile，已自動產生: ${KEYFILE_TARGET}"
fi

# 設定正確的權限 (400 = 只有所有者可讀)
chmod 400 "${KEYFILE_TARGET}"
echo "✅ 已設定權限: 400"

# 設定正確的擁有者
chown mongodb:mongodb "${KEYFILE_TARGET}"
echo "✅ 已設定擁有者: mongodb:mongodb"

# 驗證權限
ACTUAL_PERMS=$(stat -c '%a' "${KEYFILE_TARGET}")
echo "📋 最終權限: ${ACTUAL_PERMS}"

echo "=================================="
echo "🚀 啟動 MongoDB 官方 Entrypoint"
echo ""

# 調用官方 entrypoint（會建立 root 用戶）
# 傳遞 replSet 和 keyFile 參數
exec /usr/local/bin/docker-entrypoint.sh mongod --replSet rs0 --keyFile "${KEYFILE_TARGET}" --bind_ip_all
