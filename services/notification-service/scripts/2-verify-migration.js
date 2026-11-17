/**
 * 驗證資料遷移結果
 *
 * 目的：確認 deviceId 唯一性遷移是否成功
 *
 * 執行方式：
 * docker exec -i im_services-mongodb-1 mongosh messageapp < 2-verify-migration.js
 *
 * 或在容器內執行：
 * docker exec -it im_services-mongodb-1 mongosh messageapp
 * load('/scripts/2-verify-migration.js')
 */

print('\n========================================');
print('驗證 Device Token 資料遷移結果');
print('========================================\n');

// 切換到正確的資料庫
use('messageapp');

let allChecksPassed = true;

// ========================================
// 檢查 1: 索引驗證
// ========================================
print('[檢查 1/5] 索引驗證...');

const indexes = db.device_tokens.getIndexes();
const hasUniqueDeviceIdIndex = indexes.some(idx => idx.name === 'unique_device_id');
const hasOldIndex = indexes.some(idx => idx.name === 'unique_user_device_platform');

if (hasUniqueDeviceIdIndex) {
  print('  ✅ unique_device_id 索引存在');
} else {
  print('  ❌ unique_device_id 索引不存在');
  allChecksPassed = false;
}

if (!hasOldIndex) {
  print('  ✅ 舊索引 unique_user_device_platform 已移除');
} else {
  print('  ⚠️  舊索引 unique_user_device_platform 仍然存在（建議手動刪除）');
}

print('  現有索引列表:');
indexes.forEach(idx => {
  const uniqueFlag = idx.unique ? ' (UNIQUE)' : '';
  print(`    - ${idx.name}: ${JSON.stringify(idx.key)}${uniqueFlag}`);
});
print('');

// ========================================
// 檢查 2: deviceId 唯一性驗證
// ========================================
print('[檢查 2/5] deviceId 唯一性驗證...');

const duplicates = db.device_tokens.aggregate([
  {
    $group: {
      _id: '$deviceId',
      count: { $sum: 1 },
      docs: { $push: { userId: '$userId', platform: '$platform', updatedAt: '$updatedAt' } }
    }
  },
  {
    $match: { count: { $gt: 1 } }
  }
]).toArray();

if (duplicates.length === 0) {
  print('  ✅ 所有 deviceId 都是唯一的');
} else {
  print(`  ❌ 發現 ${duplicates.length} 個重複的 deviceId:`);
  duplicates.forEach(dup => {
    print(`    - deviceId: ${dup._id}, 重複次數: ${dup.count}`);
    dup.docs.forEach(doc => {
      print(`      * userId: ${doc.userId}, platform: ${doc.platform}, updatedAt: ${doc.updatedAt}`);
    });
  });
  allChecksPassed = false;
}
print('');

// ========================================
// 檢查 3: 資料完整性驗證
// ========================================
print('[檢查 3/5] 資料完整性驗證...');

const totalRecords = db.device_tokens.countDocuments();
print(`  總記錄數: ${totalRecords}`);

// 檢查必要欄位是否存在
const missingFields = db.device_tokens.find({
  $or: [
    { deviceId: { $exists: false } },
    { deviceId: null },
    { deviceId: '' },
    { userId: { $exists: false } },
    { userId: null },
    { token: { $exists: false } },
    { token: null },
    { token: '' },
    { platform: { $exists: false } },
    { platform: null }
  ]
}).toArray();

if (missingFields.length === 0) {
  print('  ✅ 所有記錄的必要欄位都完整');
} else {
  print(`  ❌ 發現 ${missingFields.length} 筆記錄缺少必要欄位:`);
  missingFields.forEach(doc => {
    print(`    - _id: ${doc._id}, deviceId: ${doc.deviceId}, userId: ${doc.userId}, platform: ${doc.platform}`);
  });
  allChecksPassed = false;
}
print('');

// ========================================
// 檢查 4: 平台分佈統計
// ========================================
print('[檢查 4/5] 平台分佈統計...');

const platformStats = db.device_tokens.aggregate([
  {
    $group: {
      _id: '$platform',
      count: { $sum: 1 }
    }
  },
  { $sort: { _id: 1 } }
]).toArray();

print('  平台分佈:');
platformStats.forEach(stat => {
  const percentage = ((stat.count / totalRecords) * 100).toFixed(2);
  print(`    - ${stat._id}: ${stat.count} 筆 (${percentage}%)`);
});

// 檢查是否有無效的 platform 值
const invalidPlatforms = db.device_tokens.find({
  platform: { $nin: ['fcm', 'apns'] }
}).toArray();

if (invalidPlatforms.length === 0) {
  print('  ✅ 所有 platform 值都有效 (fcm 或 apns)');
} else {
  print(`  ❌ 發現 ${invalidPlatforms.length} 筆無效的 platform 值:`);
  invalidPlatforms.forEach(doc => {
    print(`    - _id: ${doc._id}, platform: ${doc.platform}`);
  });
  allChecksPassed = false;
}
print('');

// ========================================
// 檢查 5: 環境分佈統計
// ========================================
print('[檢查 5/5] 環境分佈統計...');

const envStats = db.device_tokens.aggregate([
  {
    $group: {
      _id: '$environment',
      count: { $sum: 1 }
    }
  },
  { $sort: { _id: 1 } }
]).toArray();

print('  環境分佈:');
envStats.forEach(stat => {
  const percentage = ((stat.count / totalRecords) * 100).toFixed(2);
  print(`    - ${stat._id || '(未設定)'}: ${stat.count} 筆 (${percentage}%)`);
});
print('');

// ========================================
// 額外統計資訊
// ========================================
print('額外統計資訊:');

// 用戶數量
const uniqueUsers = db.device_tokens.distinct('userId').length;
print(`  唯一用戶數: ${uniqueUsers}`);
print(`  平均每用戶設備數: ${(totalRecords / uniqueUsers).toFixed(2)}`);

// 最近更新時間
const recentlyUpdated = db.device_tokens.find().sort({ updatedAt: -1 }).limit(1).toArray();
if (recentlyUpdated.length > 0) {
  print(`  最近更新時間: ${recentlyUpdated[0].updatedAt}`);
}

// 最舊的記錄
const oldestRecord = db.device_tokens.find().sort({ createdAt: 1 }).limit(1).toArray();
if (oldestRecord.length > 0) {
  print(`  最舊記錄時間: ${oldestRecord[0].createdAt}`);
}

print('');

// ========================================
// 最終結果
// ========================================
print('========================================');
if (allChecksPassed) {
  print('✅ 所有檢查通過！');
  print('資料遷移成功完成。');
} else {
  print('❌ 部分檢查失敗！');
  print('請檢查上述錯誤訊息並手動修復問題。');
}
print('========================================\n');

// ========================================
// 測試唯一性約束
// ========================================
print('測試唯一性約束:');
print('嘗試插入重複的 deviceId...');

const testDeviceId = 'test-duplicate-device-id-' + Date.now();

try {
  // 第一次插入
  db.device_tokens.insertOne({
    userId: ObjectId(),
    deviceId: testDeviceId,
    token: 'test-token-1',
    platform: 'fcm',
    environment: 'development',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  print('  第一次插入成功');

  // 第二次插入（應該失敗）
  try {
    db.device_tokens.insertOne({
      userId: ObjectId(),
      deviceId: testDeviceId,
      token: 'test-token-2',
      platform: 'apns',
      environment: 'development',
      createdAt: new Date(),
      updatedAt: new Date()
    });
    print('  ❌ 第二次插入成功（唯一性約束失效！）');
  } catch (error) {
    if (error.message.includes('duplicate key')) {
      print('  ✅ 第二次插入失敗（唯一性約束正常運作）');
    } else {
      print(`  ⚠️  第二次插入失敗，但原因不明: ${error.message}`);
    }
  }

  // 清理測試資料
  db.device_tokens.deleteMany({ deviceId: testDeviceId });
  print('  測試資料已清理');
} catch (error) {
  print(`  測試失敗: ${error.message}`);
}

print('\n驗證完成！\n');
