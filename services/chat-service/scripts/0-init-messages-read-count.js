/**
 * 初始化 messages.read_count 欄位（完整激進策略）
 *
 * 策略：將每則訊息的 read_count 設為「該對話參與者數量 - 1」
 * 邏輯：視為所有參與者（除發送者外）都已讀該訊息
 *
 * 執行方式：
 * docker exec -i {容器名稱} mongosh messageapp < 0-init-messages-read-count.js
 */

print('\n========================================');
print('初始化 messages.read_count 欄位');
print('策略：完整激進策略 (read_count = 參與者數 - 1)');
print('========================================\n');

use('messageapp');

// 1. 查詢所有對話
print('[1/4] 查詢所有對話...');
const conversations = db.conversations.find({}, { _id: 1, participants: 1 }).toArray();
print(`找到 ${conversations.length} 個對話\n`);

if (conversations.length === 0) {
  print('⚠️  沒有對話資料，初始化結束');
  quit();
}

// 2. 統計訊息數量
print('[2/4] 統計訊息數量...');
const totalMessages = db.messages.countDocuments();
print(`總訊息數: ${totalMessages}\n`);

if (totalMessages === 0) {
  print('⚠️  沒有訊息資料，初始化結束');
  quit();
}

// 3. 批次更新 messages.read_count
print('[3/4] 批次更新 messages.read_count...');
print('（依對話分組，設定 read_count = 參與者數 - 1）\n');

let totalProcessed = 0;
let totalUpdated = 0;

conversations.forEach((conv, index) => {
  const conversationId = conv._id;
  const participantCount = (conv.participants || []).length;
  const expectedReadCount = Math.max(participantCount - 1, 0); // 至少為 0

  // 更新該對話所有訊息的 read_count
  try {
    const updateResult = db.messages.updateMany(
      { conversationId: conversationId },
      { $set: { read_count: expectedReadCount } }
    );

    totalProcessed += updateResult.matchedCount || 0;
    totalUpdated += updateResult.modifiedCount || 0;

    // 每處理 10 個對話顯示一次進度
    if ((index + 1) % 10 === 0 || (index + 1) === conversations.length) {
      print(`  進度: ${index + 1}/${conversations.length} 對話 | 已更新 ${totalUpdated} 則訊息`);
    }
  } catch (error) {
    print(`❌ 更新對話 ${conversationId} 的訊息失敗: ${error.message}`);
  }
});

print(`\n✅ 批次更新完成`);
print(`   處理訊息數: ${totalProcessed}`);
print(`   實際更新數: ${totalUpdated}\n`);

// 4. 驗證結果
print('[4/4] 驗證結果...');

// 4.1 檢查是否有訊息的 read_count 仍為 null/undefined
const nullReadCount = db.messages.countDocuments({ read_count: null });
const undefinedReadCount = db.messages.countDocuments({ read_count: { $exists: false } });

if (nullReadCount > 0) {
  print(`⚠️  發現 ${nullReadCount} 則訊息的 read_count 為 null`);
} else {
  print('✅ 沒有訊息的 read_count 為 null');
}

if (undefinedReadCount > 0) {
  print(`⚠️  發現 ${undefinedReadCount} 則訊息缺少 read_count 欄位`);
} else {
  print('✅ 所有訊息都有 read_count 欄位');
}

// 4.2 抽樣檢查
print('\n抽樣檢查（顯示前 5 則訊息）:');
const samples = db.messages.aggregate([
  {
    $lookup: {
      from: 'conversations',
      localField: 'conversationId',
      foreignField: '_id',
      as: 'conversation'
    }
  },
  { $limit: 5 }
]).toArray();

samples.forEach((msg, index) => {
  const conv = msg.conversation[0];
  const participantCount = conv ? (conv.participants || []).length : 0;
  const expectedReadCount = Math.max(participantCount - 1, 0);
  const isCorrect = msg.read_count === expectedReadCount;
  const status = isCorrect ? '✅' : '❌';

  print(`\n${status} 樣本 ${index + 1}:`);
  print(`  訊息 ID: ${msg._id}`);
  print(`  對話參與者數: ${participantCount}`);
  print(`  預期 read_count: ${expectedReadCount}`);
  print(`  實際 read_count: ${msg.read_count}`);
});

// 4.3 統計 read_count 分佈
print('\n\nread_count 分佈統計:');
const readCountDistribution = db.messages.aggregate([
  {
    $group: {
      _id: '$read_count',
      count: { $sum: 1 }
    }
  },
  { $sort: { _id: 1 } },
  { $limit: 20 }
]).toArray();

readCountDistribution.forEach(item => {
  print(`  read_count = ${item._id}: ${item.count} 則訊息`);
});

print('\n========================================');
print('✅ messages.read_count 初始化完成！');
print('========================================\n');
print('下一步: 執行 conversation_states 初始化');
print('docker exec -i {容器名稱} mongosh messageapp < 1-init-conversation-states.js\n');
