#!/bin/bash
# ================================
# 系統訊息功能初始化腳本
# ================================
# 此腳本用於初始化系統訊息功能所需的資料庫結構和 System 使用者
#
# 功能：
#   1. 建立 system_message_permissions collection 和索引
#   2. 建立 System 使用者（username: system）
#   3. 輸出 System User ID 供環境變數設定

# 防止 Git Bash 自動轉換路徑 (Windows 環境)
export MSYS_NO_PATHCONV=1

set -e  # 遇到錯誤立即停止

echo "================================"
echo "系統訊息功能初始化"
echo "================================"
echo ""

# ================================
# 步驟 0: 讀取環境配置
# ================================
echo "[步驟 0/4] 讀取環境配置..."
echo ""

# 自動偵測環境文件
if [ -f ".env.prod" ]; then
  ENV_FILE=".env.prod"
  echo "✅ 使用生產環境配置: .env.prod"
elif [ -f ".env.test" ]; then
  ENV_FILE=".env.test"
  echo "✅ 使用測試環境配置: .env.test"
else
  echo "❌ 找不到環境配置文件（.env.prod 或 .env.test）！"
  echo ""
  echo "請確保在專案根目錄執行此腳本，或環境文件已存在。"
  exit 1
fi

# 提取 MongoDB 密碼
MONGODB_PASSWORD=$(grep "^MONGODB_PASSWORD=" "$ENV_FILE" | cut -d '=' -f2)

if [ -z "$MONGODB_PASSWORD" ]; then
    echo "❌ 無法從 $ENV_FILE 讀取 MONGODB_PASSWORD！"
    exit 1
fi

echo "✅ MongoDB 密碼已讀取"
echo ""

# ================================
# 步驟 1: 確認容器名稱
# ================================
echo "[步驟 1/4] 確認 MongoDB 容器名稱..."
echo ""
echo "正在查詢 MongoDB 容器..."

# 支援多種鏡像來源的容器名稱偵測
CONTAINER_NAME=$(docker ps --format "{{.Names}}" | grep -E "(mongodb|mongo)" | head -n 1)

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
  --password "$MONGODB_PASSWORD" \
  --authenticationDatabase admin \
  --quiet --eval "db.version()" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ 資料庫連線成功"
else
    echo "❌ 資料庫連線失敗！請檢查密碼是否正確。"
    exit 1
fi
echo ""

# ================================
# 步驟 0: 取得腳本目錄
# ================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ================================
# 步驟 2: 初始化權限 Collection
# ================================
echo "[步驟 2/4] 初始化 system_message_permissions collection..."
echo "----------------------------------------"
docker exec -i "$CONTAINER_NAME" mongosh messageapp \
  --username admin \
  --password "$MONGODB_PASSWORD" \
  --authenticationDatabase admin \
  < "$SCRIPT_DIR/init-permissions-collection.js"

if [ $? -eq 0 ]; then
    echo "----------------------------------------"
    echo "✅ system_message_permissions collection 初始化成功"
else
    echo "❌ Collection 初始化失敗！"
    exit 1
fi
echo ""

# ================================
# 步驟 3: 建立 System 使用者
# ================================
echo "[步驟 3/4] 建立 System 使用者..."
echo "----------------------------------------"
SYSTEM_USER_OUTPUT=$(docker exec -i "$CONTAINER_NAME" mongosh messageapp \
  --username admin \
  --password "$MONGODB_PASSWORD" \
  --authenticationDatabase admin \
  < "$SCRIPT_DIR/create-system-user.js" 2>&1)

echo "$SYSTEM_USER_OUTPUT"
echo "----------------------------------------"

if [ $? -eq 0 ]; then
    echo "✅ System 使用者處理完成"
else
    echo "❌ System 使用者建立失敗！"
    exit 1
fi
echo ""

# 提取 System User ID
SYSTEM_USER_ID=$(echo "$SYSTEM_USER_OUTPUT" | grep -oP 'System User ID:\s*\K[a-f0-9]+' | head -n 1)

if [ -z "$SYSTEM_USER_ID" ]; then
    # 嘗試另一種格式
    SYSTEM_USER_ID=$(echo "$SYSTEM_USER_OUTPUT" | grep "User ID:" | awk '{print $3}' | head -n 1)
fi

# ================================
# 步驟 4: 輸出後續設定步驟
# ================================
echo "[步驟 4/4] 後續設定步驟"
echo "================================"
echo ""

if [ -n "$SYSTEM_USER_ID" ]; then
    echo "📝 請完成以下設定："
    echo ""
    echo "1️⃣  設定環境變數"
    echo "   在專案根目錄的 $ENV_FILE 檔案中加入："
    echo ""
    echo "   SYSTEM_USER_ID=$SYSTEM_USER_ID"
    echo ""
    echo "2️⃣  新增第一個管理員"
    echo "   執行以下指令連接到 MongoDB："
    echo ""
    echo "   docker exec -it $CONTAINER_NAME mongosh messageapp \\"
    echo "     --username admin --password <您的密碼> --authenticationDatabase admin"
    echo ""
    echo "   然後執行："
    echo ""
    echo "   db.system_message_permissions.insertOne({"
    echo "     userId: ObjectId(\"你的管理員user_id\"),"
    echo "     username: \"admin\","
    echo "     isActive: true,"
    echo "     grantedBy: \"system\","
    echo "     grantedAt: new Date(),"
    echo "     createdAt: new Date(),"
    echo "     updatedAt: new Date()"
    echo "   })"
    echo ""
    echo "   💡 如何取得管理員的 user_id："
    echo "      db.users.findOne({ username: \"admin\" })"
    echo ""
else
    echo "⚠️  無法自動提取 System User ID"
    echo "   請從上方輸出中手動複製 User ID"
    echo ""
fi

echo "3️⃣  重啟服務"
echo "   設定環境變數後，請重啟 API Gateway："
echo ""
echo "   docker-compose restart api-gateway"
echo ""

# ================================
# 完成
# ================================
echo "================================"
echo "✅ 系統訊息功能初始化完成！"
echo "================================"
echo ""
echo "容器名稱: $CONTAINER_NAME"
echo "資料庫: messageapp"
echo ""
echo "詳細使用說明請參考："
echo "services/chat-service/scripts/SYSTEM-MESSAGE-GUIDE.md"
echo ""
