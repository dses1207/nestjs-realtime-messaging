#!/bin/bash

###############################################################################
# 檢查重複的 deviceId
#
# 用途：在執行遷移前，檢查資料庫中是否有重複的 deviceId
# 使用方式：./check-duplicates.sh
###############################################################################

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
DB_NAME="messageapp"
COLLECTION="device_tokens"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}檢查 device_tokens 重複記錄${NC}"
echo -e "${BLUE}========================================${NC}\n"

# 自動檢測容器名稱
echo -e "${YELLOW}[1/4]${NC} 檢查 MongoDB 容器狀態..."

CONTAINER_NAME=$(docker ps --filter "ancestor=mongo:8.0" --format "{{.Names}}" 2>/dev/null | head -n 1)
if [ -z "$CONTAINER_NAME" ]; then
    CONTAINER_NAME=$(docker ps --filter "name=mongodb" --format "{{.Names}}" 2>/dev/null | head -n 1)
fi

if [ -z "$CONTAINER_NAME" ]; then
    echo -e "${RED}❌ MongoDB 容器未運行！${NC}"
    echo -e "請先啟動容器: ${YELLOW}docker-compose up -d mongodb${NC}"
    exit 1
fi

echo -e "${GREEN}✅ MongoDB 容器運行中${NC} (${CONTAINER_NAME})\n"

# 檢查資料庫連接
echo -e "${YELLOW}[2/4]${NC} 檢查資料庫連接..."
if ! docker exec "$CONTAINER_NAME" mongosh "$DB_NAME" --quiet --eval "db.runCommand({ ping: 1 })" > /dev/null 2>&1; then
    echo -e "${RED}❌ 無法連接到資料庫！${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 資料庫連接正常${NC}\n"

# 統計總記錄數
echo -e "${YELLOW}[3/4]${NC} 統計資料..."
TOTAL_COUNT=$(docker exec "$CONTAINER_NAME" mongosh "$DB_NAME" --quiet --eval "db.$COLLECTION.countDocuments()" 2>/dev/null | tail -1)
echo -e "  總記錄數: ${GREEN}$TOTAL_COUNT${NC}"

UNIQUE_DEVICES=$(docker exec "$CONTAINER_NAME" mongosh "$DB_NAME" --quiet --eval "db.$COLLECTION.distinct('deviceId').length" 2>/dev/null | tail -1)
echo -e "  唯一 deviceId 數: ${GREEN}$UNIQUE_DEVICES${NC}\n"

# 檢查重複的 deviceId
echo -e "${YELLOW}[4/4]${NC} 檢查重複的 deviceId...\n"

DUPLICATES=$(docker exec "$CONTAINER_NAME" mongosh "$DB_NAME" --quiet --eval "
  const duplicates = db.$COLLECTION.aggregate([
    {
      \$group: {
        _id: '\$deviceId',
        count: { \$sum: 1 },
        docs: {
          \$push: {
            userId: '\$userId',
            platform: '\$platform',
            updatedAt: '\$updatedAt',
            environment: '\$environment'
          }
        }
      }
    },
    {
      \$match: { count: { \$gt: 1 } }
    },
    {
      \$sort: { count: -1 }
    }
  ]).toArray();

  if (duplicates.length === 0) {
    print('NO_DUPLICATES');
  } else {
    print('FOUND_DUPLICATES:' + duplicates.length);
    duplicates.forEach(dup => {
      print('---');
      print('DeviceId: ' + dup._id);
      print('重複次數: ' + dup.count);
      dup.docs.forEach((doc, index) => {
        print('  [' + (index + 1) + '] userId: ' + doc.userId + ', platform: ' + doc.platform + ', env: ' + (doc.environment || 'N/A') + ', updatedAt: ' + doc.updatedAt);
      });
    });
  }
" 2>/dev/null)

if echo "$DUPLICATES" | grep -q "NO_DUPLICATES"; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✅ 沒有重複的 deviceId！${NC}"
    echo -e "${GREEN}========================================${NC}\n"
    echo -e "${BLUE}建議：${NC}"
    echo -e "  可以直接執行遷移腳本建立新索引"
    echo -e "  ${YELLOW}./migrate-database.sh${NC}\n"
    exit 0
else
    DUPLICATE_COUNT=$(echo "$DUPLICATES" | grep "FOUND_DUPLICATES" | cut -d: -f2)
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}⚠️  發現 $DUPLICATE_COUNT 個重複的 deviceId${NC}"
    echo -e "${RED}========================================${NC}\n"

    # 顯示重複記錄詳情
    echo -e "${YELLOW}重複記錄詳情：${NC}\n"
    echo "$DUPLICATES" | grep -v "FOUND_DUPLICATES" | while IFS= read -r line; do
        if [[ "$line" == "---" ]]; then
            echo ""
        elif [[ "$line" == DeviceId:* ]]; then
            echo -e "${BLUE}$line${NC}"
        elif [[ "$line" == 重複次數:* ]]; then
            echo -e "${YELLOW}$line${NC}"
        else
            echo "  $line"
        fi
    done

    echo -e "\n${RED}========================================${NC}"
    echo -e "${YELLOW}影響評估：${NC}"
    echo -e "  • 遷移時會保留每個 deviceId 最新的一筆記錄"
    echo -e "  • 其他 ${RED}$(($TOTAL_COUNT - $UNIQUE_DEVICES))${NC} 筆舊記錄將被刪除"
    echo -e "  • 被刪除記錄的用戶需要重新註冊 device token\n"

    echo -e "${BLUE}下一步：${NC}"
    echo -e "  1. 備份資料庫：${YELLOW}./backup-database.sh${NC}"
    echo -e "  2. 執行遷移：${YELLOW}./migrate-database.sh${NC}\n"

    exit 1
fi
