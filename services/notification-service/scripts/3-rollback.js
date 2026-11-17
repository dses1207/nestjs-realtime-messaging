/**
 * 回滾腳本：恢復舊的索引結構
 *
 * 目的：如果遷移後發現問題，可以回滾到舊的索引結構
 *
 * 警告：此腳本不會恢復已刪除的重複資料！
 *
 * 執行方式：
 * docker exec -i im_services-mongodb-1 mongosh messageapp < 3-rollback.js
 *
 * 或在容器內執行：
 * docker exec -it im_services-mongodb-1 mongosh messageapp
 * load('/scripts/3-rollback.js')
 */

print('\n========================================');
print('回滾 Device Token 索引結構');
print('⚠️  警告：無法恢復已刪除的重複資料');
print('========================================\n');

// 切換到正確的資料庫
use('messageapp');

// ========================================
// 步驟 1: 刪除新的唯一索引
// ========================================
print('[1/3] 刪除新的唯一索引 (unique_device_id)...');
try {
  db.device_tokens.dropIndex('unique_device_id');
  print('✅ 已刪除索引: unique_device_id\n');
} catch (error) {
  if (error.message.includes('index not found')) {
    print('ℹ️  索引不存在，跳過刪除\n');
  } else {
    print(`❌ 刪除索引失敗: ${error.message}\n`);
    throw error;
  }
}

// ========================================
// 步驟 2: 恢復舊的複合唯一索引
// ========================================
print('[2/3] 恢復舊的複合唯一索引 (userId + deviceId + platform)...');
try {
  db.device_tokens.createIndex(
    { userId: 1, deviceId: 1, platform: 1 },
    { unique: true, name: 'unique_user_device_platform' }
  );
  print('✅ 已建立索引: unique_user_device_platform\n');
} catch (error) {
  if (error.message.includes('already exists')) {
    print('ℹ️  索引已存在，跳過建立\n');
  } else if (error.message.includes('duplicate key')) {
    print('❌ 建立索引失敗: 存在違反唯一性約束的資料');
    print('可能原因: 有相同的 (userId + deviceId + platform) 組合\n');

    // 列出重複的記錄
    const duplicates = db.device_tokens.aggregate([
      {
        $group: {
          _id: {
            userId: '$userId',
            deviceId: '$deviceId',
            platform: '$platform'
          },
          count: { $sum: 1 },
          docs: { $push: '$$ROOT' }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]).toArray();

    if (duplicates.length > 0) {
      print('重複的記錄:');
      duplicates.forEach(dup => {
        print(`  - userId: ${dup._id.userId}, deviceId: ${dup._id.deviceId}, platform: ${dup._id.platform}`);
        print(`    重複次數: ${dup.count}`);
      });
      print('\n請手動清理這些重複記錄後再執行回滾\n');
    }
    throw error;
  } else {
    print(`❌ 建立索引失敗: ${error.message}\n`);
    throw error;
  }
}

// ========================================
// 步驟 3: 驗證索引結構
// ========================================
print('[3/3] 驗證索引結構...');

const indexes = db.device_tokens.getIndexes();
const hasOldIndex = indexes.some(idx => idx.name === 'unique_user_device_platform');
const hasNewIndex = indexes.some(idx => idx.name === 'unique_device_id');

print('索引列表:');
indexes.forEach(idx => {
  const uniqueFlag = idx.unique ? ' (UNIQUE)' : '';
  print(`  - ${idx.name}: ${JSON.stringify(idx.key)}${uniqueFlag}`);
});
print('');

if (hasOldIndex && !hasNewIndex) {
  print('✅ 回滾成功！已恢復到舊的索引結構\n');
} else if (hasOldIndex && hasNewIndex) {
  print('⚠️  兩個索引都存在，請手動刪除 unique_device_id\n');
} else if (!hasOldIndex && !hasNewIndex) {
  print('❌ 兩個索引都不存在！請檢查資料庫狀態\n');
} else {
  print('❌ 回滾失敗！索引狀態異常\n');
}

print('========================================');
print('回滾完成');
print('========================================\n');
print('⚠️  重要提醒：');
print('1. 在遷移過程中刪除的重複資料無法恢復');
print('2. 如果需要恢復資料，請從備份中還原');
print('3. 建議檢查應用程式日誌，確認沒有錯誤\n');
