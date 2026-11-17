/**
 * 資料遷移：確保 deviceId 全局唯一性
 *
 * 目的：
 * 1. 刪除舊的複合唯一索引 (userId + deviceId + platform)
 * 2. 建立新的唯一索引 (deviceId)
 * 3. 清理重複的 deviceId 記錄，只保留最新的一筆
 *
 * 執行方式：
 * docker exec -i im_services-mongodb-1 mongosh messageapp < 1-migrate-device-id-unique.js
 *
 * 或在容器內執行：
 * docker exec -it im_services-mongodb-1 mongosh messageapp
 * load('/scripts/1-migrate-device-id-unique.js')
 */

print('\n========================================');
print('Device Token 資料遷移');
print('目標：確保 deviceId 全局唯一性');
print('========================================\n');

// 切換到正確的資料庫
use('messageapp');

// ========================================
// 步驟 1: 檢查現有索引
// ========================================
print('[1/6] 檢查現有索引...');
const existingIndexes = db.device_tokens.getIndexes();
print('現有索引列表:');
existingIndexes.forEach(idx => {
  print(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
});
print('');

// ========================================
// 步驟 2: 檢查重複的 deviceId
// ========================================
print('[2/6] 檢查重複的 deviceId...');
const duplicates = db.device_tokens.aggregate([
  {
    $group: {
      _id: '$deviceId',
      count: { $sum: 1 },
      docs: { $push: '$$ROOT' }
    }
  },
  {
    $match: { count: { $gt: 1 } }
  },
  {
    $sort: { count: -1 }
  }
]).toArray();

if (duplicates.length === 0) {
  print('✅ 沒有重複的 deviceId，可以安全建立唯一索引\n');
} else {
  print(`⚠️  發現 ${duplicates.length} 個重複的 deviceId:`);
  duplicates.forEach(dup => {
    print(`  - deviceId: ${dup._id}, 重複次數: ${dup.count}`);
    dup.docs.forEach(doc => {
      print(`    * userId: ${doc.userId}, platform: ${doc.platform}, updatedAt: ${doc.updatedAt}`);
    });
  });
  print('');
}

// ========================================
// 步驟 3: 清理重複資料（保留最新的）
// ========================================
if (duplicates.length > 0) {
  print('[3/6] 清理重複的 deviceId 記錄（保留最新的）...');
  let deletedCount = 0;

  duplicates.forEach(dup => {
    const deviceId = dup._id;
    const docs = dup.docs;

    // 按照 updatedAt 降序排序，保留第一筆（最新的）
    docs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    const keepDoc = docs[0];
    const deleteIds = docs.slice(1).map(d => d._id);

    print(`  處理 deviceId: ${deviceId}`);
    print(`    保留: userId=${keepDoc.userId}, platform=${keepDoc.platform}, updatedAt=${keepDoc.updatedAt}`);
    print(`    刪除 ${deleteIds.length} 筆舊記錄`);

    // 刪除舊記錄
    const result = db.device_tokens.deleteMany({
      _id: { $in: deleteIds }
    });

    deletedCount += result.deletedCount;
  });

  print(`✅ 已刪除 ${deletedCount} 筆重複記錄\n`);
} else {
  print('[3/6] 跳過清理步驟（無重複資料）\n');
}

// ========================================
// 步驟 4: 刪除舊的複合唯一索引
// ========================================
print('[4/6] 刪除舊的複合唯一索引...');
try {
  db.device_tokens.dropIndex('unique_user_device_platform');
  print('✅ 已刪除索引: unique_user_device_platform\n');
} catch (error) {
  if (error.message.includes('index not found')) {
    print('ℹ️  索引不存在，跳過刪除\n');
  } else {
    print(`❌ 刪除索引失敗: ${error.message}\n`);
  }
}

// ========================================
// 步驟 5: 建立新的唯一索引
// ========================================
print('[5/6] 建立新的唯一索引 (deviceId)...');
try {
  db.device_tokens.createIndex(
    { deviceId: 1 },
    { unique: true, name: 'unique_device_id' }
  );
  print('✅ 已建立索引: unique_device_id\n');
} catch (error) {
  if (error.message.includes('already exists')) {
    print('ℹ️  索引已存在，跳過建立\n');
  } else {
    print(`❌ 建立索引失敗: ${error.message}\n`);
    print('可能原因: 仍有重複的 deviceId 資料\n');
    throw error;
  }
}

// ========================================
// 步驟 6: 驗證結果
// ========================================
print('[6/6] 驗證結果...');

// 檢查是否還有重複
const remainingDuplicates = db.device_tokens.aggregate([
  {
    $group: {
      _id: '$deviceId',
      count: { $sum: 1 }
    }
  },
  {
    $match: { count: { $gt: 1 } }
  }
]).toArray();

if (remainingDuplicates.length > 0) {
  print(`❌ 仍有 ${remainingDuplicates.length} 個重複的 deviceId！`);
  remainingDuplicates.forEach(dup => {
    print(`  - deviceId: ${dup._id}, 重複次數: ${dup.count}`);
  });
  print('');
} else {
  print('✅ 所有 deviceId 都是唯一的\n');
}

// 顯示最終索引列表
print('最終索引列表:');
db.device_tokens.getIndexes().forEach(idx => {
  print(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
});

// 顯示統計資訊
print('\n統計資訊:');
const totalCount = db.device_tokens.countDocuments();
print(`  總記錄數: ${totalCount}`);

const platformDistribution = db.device_tokens.aggregate([
  {
    $group: {
      _id: '$platform',
      count: { $sum: 1 }
    }
  },
  { $sort: { _id: 1 } }
]).toArray();

print('  平台分佈:');
platformDistribution.forEach(item => {
  print(`    - ${item._id}: ${item.count} 筆`);
});

print('\n========================================');
print('✅ 資料遷移完成！');
print('========================================\n');
print('⚠️  重要提醒：');
print('1. 一個 deviceId 現在只能對應一個用戶');
print('2. 如果不同用戶使用同一 deviceId 註冊，會覆蓋舊記錄');
print('3. 請確認這符合您的業務需求\n');
print('下一步: 執行驗證腳本');
print('docker exec -i im_services-mongodb-1 mongosh messageapp < 2-verify-migration.js\n');
