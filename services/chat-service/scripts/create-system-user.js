/**
 * 建立 System 使用者
 *
 * 功能：在 users collection 中建立 username 為 "system" 的使用者
 *
 * 執行方式（推薦 - 使用 Shell 腳本）：
 * bash services/chat-service/scripts/INIT-SYSTEM-MESSAGE.sh
 *
 * 執行方式（直接執行 - 適用於不同環境）：
 * docker exec -i {容器名稱} mongosh messageapp \
 *   --username admin --password admin_password --authenticationDatabase admin \
 *   < services/chat-service/scripts/create-system-user.js
 */

// 連接到資料庫
db = db.getSiblingDB('messageapp');

print('\n========================================');
print('建立 System 使用者');
print('========================================\n');

// 檢查是否已存在 username 為 "system" 的使用者
const existing = db.users.findOne({ username: 'system' });

if (existing) {
  print('ℹ️  System 使用者已存在');
  print('');
  print('System User ID: ' + existing._id.toString());
  print('Username: ' + existing.username);
  print('Email: ' + existing.email);
  print('');
} else {
  // 建立 System 使用者
  const result = db.users.insertOne({
    email: 'system@example.com',
    name: '系統通知',
    username: 'system',
    profilePicture: '',
    status: 'online',
    department: 'System',
    displayName: '系統通知',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  print('✅ System 使用者建立成功！');
  print('');
  print('System User ID: ' + result.insertedId.toString());
  print('Username: system');
  print('Email: system@example.com');
  print('');
}

print('========================================');
print('✅ 完成');
print('========================================');
