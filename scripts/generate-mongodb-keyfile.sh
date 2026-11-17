#!/bin/bash

# MongoDB Replica Set KeyFile 生成腳本
# 用於生成 MongoDB replica set 內部認證密鑰

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYS_DIR="${PROJECT_ROOT}/keys"
KEYFILE_PATH="${KEYS_DIR}/mongodb-keyfile"

echo "🔐 生成 MongoDB Replica Set KeyFile"
echo "=================================="
echo "目標路徑: ${KEYFILE_PATH}"
echo ""

# 確保 keys 目錄存在
mkdir -p "${KEYS_DIR}"
echo "✅ Keys 目錄已就緒: ${KEYS_DIR}"
echo ""

# 檢查是否已存在 keyFile
if [ -f "${KEYFILE_PATH}" ]; then
    read -p "⚠️  KeyFile 已存在，是否覆蓋? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ 取消操作"
        exit 1
    fi
    rm -f "${KEYFILE_PATH}"
fi

# 生成 keyFile (756 bytes base64 編碼)
if openssl rand -base64 756 > "${KEYFILE_PATH}"; then
    echo "✅ KeyFile 生成成功"
else
    echo "❌ KeyFile 生成失敗"
    exit 1
fi

# 設置正確的權限 (400 = 只有所有者可讀)
chmod 400 "${KEYFILE_PATH}"
echo "✅ 權限設置完成 (400)"

echo ""
echo "=================================="
echo "📋 KeyFile 資訊:"
echo "  路徑: ${KEYFILE_PATH}"
echo "  權限: $(stat -c '%a' "${KEYFILE_PATH}" 2>/dev/null || stat -f '%A' "${KEYFILE_PATH}" 2>/dev/null)"
echo "  大小: $(wc -c < "${KEYFILE_PATH}") bytes"
echo ""
echo "⚠️  重要提醒:"
echo "  - 測試環境可以將此文件提交到 Git"
echo "  - 生產環境應該妥善保管並加入 .gitignore"
echo "  - 所有 replica set 成員必須使用相同的 keyFile"
echo ""
echo "🚀 下一步:"
echo "  1. 使用 docker-compose 啟動服務"
echo "  2. keyFile 會自動掛載到 MongoDB 容器"
echo ""
