/**
 * 緊急回滾腳本 - 刪除所有 conversation_states 記錄
 *
 * ⚠️  警告：此腳本會刪除所有 conversation_states 資料！
 * 僅在初始化失敗或需要重新初始化時使用。
 *
 * 執行方式：
 * docker exec -i {容器名稱} mongosh messageapp < 3-rollback.js
 */

print('\n========================================');
print('⚠️  緊急回滾腳本');
print('========================================\n');

use('messageapp');

// 顯示當前狀態
print('[1/3] 當前狀態...');
const currentCount = db.conversation_states.countDocuments();
print(`當前 conversation_states 記錄數: ${currentCount}\n`);

if (currentCount === 0) {
  print('✅ collection 已經是空的，無需回滾');
  print('========================================\n');
  quit();
}

// 確認訊息
print('⚠️  警告：此操作將刪除所有 conversation_states 記錄！');
print('如果在容器內互動執行，請確認是否繼續...\n');

// 備份建議
print('[2/3] 備份建議...');
print('建議先備份資料：');
print('docker exec im_services-mongodb-1 mongodump --db im_service --collection conversation_states --out /backup\n');

// 執行刪除
print('[3/3] 執行刪除...');
try {
  const deleteResult = db.conversation_states.deleteMany({});
  print(`✅ 已刪除 ${deleteResult.deletedCount} 筆記錄\n`);

  // 驗證刪除結果
  const remainingCount = db.conversation_states.countDocuments();
  if (remainingCount === 0) {
    print('✅ collection 已清空');
  } else {
    print(`⚠️  仍有 ${remainingCount} 筆記錄殘留`);
  }
} catch (error) {
  print(`❌ 刪除失敗: ${error.message}`);
}

// 索引狀態
print('\n索引狀態 (索引會保留):');
const indexes = db.conversation_states.getIndexes();
indexes.forEach(idx => {
  print(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
});

print('\n========================================');
print('回滾完成！');
print('========================================\n');
print('如需重新初始化，請執行:');
print('docker exec -i {容器名稱} mongosh messageapp < 1-init-conversation-states.js\n');
