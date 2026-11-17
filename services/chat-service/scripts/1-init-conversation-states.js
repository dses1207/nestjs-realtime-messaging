/**
 * 初始化 conversation_states Collection (激進策略)
 *
 * 策略：所有現有訊息視為已讀 (unread_count = 0)
 *
 * 執行方式：
 * docker exec -i {容器名稱} mongosh messageapp < 1-init-conversation-states.js
 *
 * 或在容器內執行：
 * docker exec -it {容器名稱} mongosh messageapp
 * load('/scripts/1-init-conversation-states.js')
 */

print('\n========================================');
print('初始化 conversation_states Collection');
print('策略：激進策略 (unread_count = 0)');
print('========================================\n');

// 切換到正確的資料庫
use('messageapp');

// 1. 建立索引
print('[1/5] 建立索引...');
try {
  db.conversation_states.createIndex(
    { user_id: 1, conversation_id: 1 },
    { unique: true, name: 'idx_user_conversation_unique' }
  );
  db.conversation_states.createIndex(
    { conversation_id: 1 },
    { name: 'idx_conversation_id' }
  );
  db.conversation_states.createIndex(
    { user_id: 1, unread_count: -1 },
    { name: 'idx_user_unread' }
  );
  print('✅ 索引建立成功\n');
} catch (error) {
  print(`⚠️  索引建立失敗 (可能已存在): ${error.message}\n`);
}

// 2. 查詢所有對話和參與者
print('[2/5] 查詢所有對話和參與者...');
const conversations = db.conversations.find({}, { _id: 1, participants: 1 }).toArray();
print(`找到 ${conversations.length} 個對話\n`);

if (conversations.length === 0) {
  print('⚠️  沒有對話資料，初始化結束');
  quit();
}

// 3. 計算總參與者記錄數
let totalParticipants = 0;
conversations.forEach(conv => {
  totalParticipants += (conv.participants || []).length;
});
print(`預計建立 ${totalParticipants} 筆 conversation_state 記錄\n`);

// 4. 批次初始化 conversation_states (激進策略)
print('[3/5] 批次初始化 conversation_states (unread_count = 0)...');

const BATCH_SIZE = 1000;
let processedCount = 0;
let bulkOps = [];

conversations.forEach((conv, convIndex) => {
  const conversationId = conv._id;
  const participants = conv.participants || [];

  participants.forEach(userId => {
    // userId 本身就是 ObjectId，不需要 .user_id

    if (!userId || !conversationId) {
      print(`⚠️  跳過無效記錄: userId=${userId}, conversationId=${conversationId}`);
      return;
    }

    // Upsert 操作 (幂等性：可重複執行)
    bulkOps.push({
      updateOne: {
        filter: { user_id: userId, conversation_id: conversationId },
        update: {
          $setOnInsert: {
            user_id: userId,
            conversation_id: conversationId,
            unread_count: 0,  // 激進策略：視為已讀
            last_read_message_id: null,
            last_read_at: null,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        },
        upsert: true
      }
    });

    processedCount++;

    // 批次執行
    if (bulkOps.length >= BATCH_SIZE) {
      try {
        const result = db.conversation_states.bulkWrite(bulkOps, { ordered: false });
        print(`  進度: ${processedCount}/${totalParticipants} (插入: ${result.upsertedCount}, 已存在: ${result.matchedCount})`);
        bulkOps = [];
      } catch (error) {
        print(`❌ 批次執行失敗: ${error.message}`);
      }
    }
  });

  // 每處理 10 個對話顯示一次進度
  if ((convIndex + 1) % 10 === 0) {
    print(`  已處理 ${convIndex + 1}/${conversations.length} 個對話`);
  }
});

// 執行剩餘的操作
if (bulkOps.length > 0) {
  try {
    const result = db.conversation_states.bulkWrite(bulkOps, { ordered: false });
    print(`  最後批次: ${processedCount}/${totalParticipants} (插入: ${result.upsertedCount}, 已存在: ${result.matchedCount})`);
  } catch (error) {
    print(`❌ 最後批次執行失敗: ${error.message}`);
  }
}

print('✅ conversation_states 初始化完成\n');

// 5. 驗證結果
print('[4/5] 驗證結果...');
const totalStates = db.conversation_states.countDocuments();
print(`總記錄數: ${totalStates}`);
print(`預期記錄數: ${totalParticipants}`);

if (totalStates === totalParticipants) {
  print('✅ 記錄數量正確\n');
} else {
  print(`⚠️  記錄數量不符！差異: ${Math.abs(totalStates - totalParticipants)}\n`);
}

// 6. 顯示未讀數量分佈（應該全是 0）
print('[5/5] 未讀數量分佈 (激進策略：應全為 0)...');
const unreadDistribution = db.conversation_states.aggregate([
  {
    $group: {
      _id: '$unread_count',
      count: { $sum: 1 }
    }
  },
  { $sort: { _id: 1 } }
]).toArray();

unreadDistribution.forEach(item => {
  print(`  unread_count = ${item._id}: ${item.count} 筆記錄`);
});

// 7. 顯示索引資訊
print('\n索引列表:');
db.conversation_states.getIndexes().forEach(idx => {
  print(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
});

print('\n========================================');
print('✅ 初始化完成！');
print('========================================\n');
print('下一步: 執行驗證腳本');
print('docker exec -i {容器名稱} mongosh messageapp < 2-verify-init.js\n');
