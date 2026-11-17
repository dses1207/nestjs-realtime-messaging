/**
 * 初始化 system_message_permissions collection
 *
 * 功能：建立 system_message_permissions collection 和索引
 *
 * 執行方式（推薦 - 使用 Shell 腳本）：
 * bash services/chat-service/scripts/INIT-SYSTEM-MESSAGE.sh
 *
 * 執行方式（直接執行 - 適用於不同環境）：
 * docker exec -i {容器名稱} mongosh messageapp \
 *   --username admin --password admin_password --authenticationDatabase admin \
 *   < services/chat-service/scripts/init-permissions-collection.js
 */

// 連接到資料庫
db = db.getSiblingDB('messageapp');

print('\n========================================');
print('初始化 system_message_permissions collection');
print('========================================\n');

// 建立 collection（如果不存在）
if (!db.getCollectionNames().includes('system_message_permissions')) {
  db.createCollection('system_message_permissions');
  print('✅ Collection created: system_message_permissions');
} else {
  print('ℹ️  Collection already exists: system_message_permissions');
}

// 建立索引
db.system_message_permissions.createIndex({ userId: 1 }, { unique: true });
db.system_message_permissions.createIndex({ username: 1 });
print('✅ Indexes created');

print('\n========================================');
print('✅ 初始化完成');
print('========================================');
