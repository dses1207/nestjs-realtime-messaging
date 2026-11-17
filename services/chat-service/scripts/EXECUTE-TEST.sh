#!/bin/bash
# ================================
# 測試環境資料庫初始化執行腳本
# ================================
# 此腳本用於在測試環境初始化已讀系統相關 collections
# 使用激進策略：
#   - messages.read_count = 參與者數 - 1
#   - conversation_states.unread_count = 0

# 防止 Git Bash 自動轉換路徑 (Windows 環境)
export MSYS_NO_PATHCONV=1

set -e  # 遇到錯誤立即停止

echo "================================"
echo "測試環境資料庫初始化"
echo "================================"
echo ""

# ================================
# 步驟 0: 確認容器名稱
# ================================
echo "[步驟 0/5] 確認 MongoDB 容器名稱..."
echo ""
echo "正在查詢 MongoDB 容器..."
CONTAINER_NAME=$(docker ps --filter "ancestor=mongo:8.0" --format "{{.Names}}" | grep mongodb | head -n 1)

if [ -z "$CONTAINER_NAME" ]; then
    echo "❌ 找不到 MongoDB 容器！"
    echo ""
    echo "請檢查容器是否運行中："
    docker ps | grep mongo
    exit 1
fi

echo "✅ 找到容器: $CONTAINER_NAME"
echo ""

# 確認資料庫連線
echo "測試資料庫連線..."
docker exec "$CONTAINER_NAME" mongosh messageapp \
  --username admin \
  --password admin_password \
  --authenticationDatabase admin \
  --quiet --eval "db.version()" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ 資料庫連線成功"
else
    echo "❌ 資料庫連線失敗！"
    exit 1
fi
echo ""

# ================================
# 步驟 0: 取得腳本目錄
# ================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ================================
# 步驟 1: 初始化 messages.read_count
# ================================
echo "[步驟 1/6] 初始化 messages.read_count..."
echo "策略: read_count = 參與者數 - 1"
echo ""

docker cp "$(cygpath -w "$SCRIPT_DIR/0-init-messages-read-count.js" 2>/dev/null || echo "$SCRIPT_DIR/0-init-messages-read-count.js")" "$CONTAINER_NAME:/tmp/"
docker exec -i "$CONTAINER_NAME" mongosh messageapp \
  --username admin \
  --password admin_password \
  --authenticationDatabase admin \
  < "$SCRIPT_DIR/0-init-messages-read-count.js"

if [ $? -eq 0 ]; then
    echo "✅ messages.read_count 初始化成功"
else
    echo "❌ messages.read_count 初始化失敗！"
    exit 1
fi
echo ""

# ================================
# 步驟 2: 備份資料庫
# ================================
echo "[步驟 2/6] 備份資料庫..."
BACKUP_DIR="/backup/$(date +%Y%m%d_%H%M%S)"
echo "備份位置: $BACKUP_DIR"

docker exec "$CONTAINER_NAME" mongodump \
  --username="admin" \
  --password="admin_password" \
  --authenticationDatabase="admin" \
  --db="messageapp" \
  --out="$BACKUP_DIR" 2>&1
if [ $? -eq 0 ]; then
    echo "✅ 資料庫備份成功"
else
    echo "⚠️  備份失敗，但繼續執行（容器內可能沒有 /backup 目錄）"
fi
echo ""

# ================================
# 步驟 3: 上傳腳本到容器
# ================================
echo "[步驟 3/6] 上傳初始化腳本到容器..."

# 使用絕對路徑，並轉換為 Windows 格式（適用於 Git Bash）
docker cp "$(cygpath -w "$SCRIPT_DIR/1-init-conversation-states.js" 2>/dev/null || echo "$SCRIPT_DIR/1-init-conversation-states.js")" "$CONTAINER_NAME:/tmp/"
docker cp "$(cygpath -w "$SCRIPT_DIR/2-verify-init.js" 2>/dev/null || echo "$SCRIPT_DIR/2-verify-init.js")" "$CONTAINER_NAME:/tmp/"
docker cp "$(cygpath -w "$SCRIPT_DIR/3-rollback.js" 2>/dev/null || echo "$SCRIPT_DIR/3-rollback.js")" "$CONTAINER_NAME:/tmp/"

if [ $? -eq 0 ]; then
    echo "✅ 腳本上傳成功"
    docker exec "$CONTAINER_NAME" sh -c 'ls -lh /tmp/*.js'
else
    echo "❌ 腳本上傳失敗！"
    exit 1
fi
echo ""

# ================================
# 步驟 4: 初始化 conversation_states
# ================================
echo "[步驟 4/6] 初始化 conversation_states..."
echo "策略: unread_count = 0"
echo "----------------------------------------"
docker exec -i "$CONTAINER_NAME" mongosh messageapp \
  --username admin \
  --password admin_password \
  --authenticationDatabase admin \
  < "$SCRIPT_DIR/1-init-conversation-states.js"
echo "----------------------------------------"
echo ""

# ================================
# 步驟 5: 驗證結果
# ================================
echo "[步驟 5/6] 驗證初始化結果..."
echo "----------------------------------------"
docker exec -i "$CONTAINER_NAME" mongosh messageapp \
  --username admin \
  --password admin_password \
  --authenticationDatabase admin \
  < "$SCRIPT_DIR/2-verify-init.js"
echo "----------------------------------------"
echo ""

# ================================
# 步驟 6: 清理臨時文件
# ================================
echo "[步驟 6/6] 清理臨時文件..."
docker exec "$CONTAINER_NAME" sh -c 'rm -f /tmp/0-init-messages-read-count.js /tmp/1-init-conversation-states.js /tmp/2-verify-init.js /tmp/3-rollback.js'

if [ $? -eq 0 ]; then
    echo "✅ 臨時文件已清理"
else
    echo "⚠️  臨時文件清理失敗（不影響初始化結果）"
fi
echo ""

# ================================
# 完成
# ================================
echo "================================"
echo "✅ 測試環境初始化完成！"
echo "================================"
echo ""
echo "容器名稱: $CONTAINER_NAME"
echo "資料庫: messageapp"
echo "策略: 激進策略 (unread_count = 0)"
echo ""
echo "如需回滾，請執行："
echo "docker exec -i $CONTAINER_NAME mongosh messageapp --username admin --password admin_password --authenticationDatabase admin < $SCRIPT_DIR/3-rollback.js"
echo ""
