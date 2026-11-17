/**
 * 驗證 conversation_states 初始化結果
 *
 * 執行方式：
 * docker exec -i {容器名稱} mongosh messageapp < 2-verify-init.js
 */

print('\n========================================');
print('驗證已讀系統初始化結果');
print('========================================\n');

use('messageapp');

// 1. 基本統計
print('[1/8] 基本統計...');
const totalConversations = db.conversations.countDocuments();
const totalMessages = db.messages.countDocuments();
const totalStates = db.conversation_states.countDocuments();
print(`對話數量: ${totalConversations}`);
print(`訊息數量: ${totalMessages}`);
print(`conversation_states 記錄數: ${totalStates}\n`);

// 2. 檢查 messages.read_count 初始化
print('[2/8] 檢查 messages.read_count 初始化...');

// 2.1 檢查是否有訊息缺少 read_count
const messagesWithoutReadCount = db.messages.countDocuments({ read_count: { $exists: false } });
const messagesWithNullReadCount = db.messages.countDocuments({ read_count: null });

if (messagesWithoutReadCount === 0) {
  print('✅ 所有訊息都有 read_count 欄位');
} else {
  print(`❌ 發現 ${messagesWithoutReadCount} 則訊息缺少 read_count 欄位`);
}

if (messagesWithNullReadCount === 0) {
  print('✅ 沒有訊息的 read_count 為 null');
} else {
  print(`⚠️  發現 ${messagesWithNullReadCount} 則訊息的 read_count 為 null`);
}

// 2.2 抽樣驗證 read_count 正確性
const sampleMessages = db.messages.aggregate([
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

let readCountCorrect = 0;
let readCountIncorrect = 0;

sampleMessages.forEach(msg => {
  const conv = msg.conversation[0];
  if (conv) {
    const participantCount = (conv.participants || []).length;
    const expectedReadCount = Math.max(participantCount - 1, 0);
    if (msg.read_count === expectedReadCount) {
      readCountCorrect++;
    } else {
      readCountIncorrect++;
    }
  }
});

if (readCountIncorrect === 0) {
  print(`✅ 抽樣檢查 ${readCountCorrect} 則訊息，read_count 都正確\n`);
} else {
  print(`⚠️  抽樣檢查發現 ${readCountIncorrect} 則訊息的 read_count 不正確\n`);
}

// 3. 計算預期 conversation_states 記錄數
print('[3/8] 計算預期 conversation_states 記錄數...');
const expectedCount = db.conversations.aggregate([
  {
    $project: {
      participantCount: { $size: { $ifNull: ['$participants', []] } }
    }
  },
  {
    $group: {
      _id: null,
      total: { $sum: '$participantCount' }
    }
  }
]).toArray();

const expected = expectedCount.length > 0 ? expectedCount[0].total : 0;
print(`預期記錄數: ${expected}`);

if (totalStates === expected) {
  print('✅ 記錄數量正確\n');
} else {
  print(`❌ 記錄數量不符！差異: ${Math.abs(totalStates - expected)}`);
  print('   請檢查是否有資料遺失或重複\n');
}

// 4. 檢查索引
print('[4/8] 檢查索引...');
const indexes = db.conversation_states.getIndexes();
const requiredIndexes = [
  'idx_user_conversation_unique',
  'idx_conversation_id',
  'idx_user_unread'
];

let allIndexesExist = true;
requiredIndexes.forEach(idxName => {
  const exists = indexes.some(idx => idx.name === idxName);
  if (exists) {
    print(`✅ ${idxName}`);
  } else {
    print(`❌ 缺少索引: ${idxName}`);
    allIndexesExist = false;
  }
});

if (allIndexesExist) {
  print('✅ 所有索引都已建立\n');
} else {
  print('⚠️  部分索引缺失\n');
}

// 5. 檢查重複記錄 (unique index violation)
print('[5/8] 檢查重複記錄...');
const duplicates = db.conversation_states.aggregate([
  {
    $group: {
      _id: {
        user_id: '$user_id',
        conversation_id: '$conversation_id'
      },
      count: { $sum: 1 }
    }
  },
  { $match: { count: { $gt: 1 } } },
  { $limit: 10 }
]).toArray();

if (duplicates.length === 0) {
  print('✅ 沒有重複記錄\n');
} else {
  print(`❌ 發現 ${duplicates.length} 組重複記錄！`);
  duplicates.forEach(dup => {
    print(`   user_id: ${dup._id.user_id}, conversation_id: ${dup._id.conversation_id}, count: ${dup.count}`);
  });
  print('\n');
}

// 6. 檢查未讀數量分佈（激進策略：應全為 0）
print('[6/8] 未讀數量分佈 (激進策略：應全為 0)...');
const unreadDistribution = db.conversation_states.aggregate([
  {
    $group: {
      _id: '$unread_count',
      count: { $sum: 1 }
    }
  },
  { $sort: { _id: 1 } },
  { $limit: 20 }
]).toArray();

unreadDistribution.forEach(item => {
  const status = item._id === 0 ? '✅' : '⚠️';
  print(`  ${status} unread_count = ${item._id}: ${item.count} 筆記錄`);
});

const nonZeroUnread = db.conversation_states.countDocuments({ unread_count: { $ne: 0 } });
if (nonZeroUnread === 0) {
  print('✅ 所有記錄的 unread_count 都是 0 (符合激進策略)\n');
} else {
  print(`⚠️  有 ${nonZeroUnread} 筆記錄的 unread_count 不為 0\n`);
}

// 7. 檢查孤立記錄 (conversation 或 user 不存在)
print('[7/8] 檢查孤立記錄...');

// 檢查不存在的對話
const orphanedConversations = db.conversation_states.aggregate([
  {
    $lookup: {
      from: 'conversations',
      localField: 'conversation_id',
      foreignField: '_id',
      as: 'conv'
    }
  },
  { $match: { conv: { $size: 0 } } },
  { $count: 'count' }
]).toArray();

const orphanedConvCount = orphanedConversations.length > 0 ? orphanedConversations[0].count : 0;
if (orphanedConvCount === 0) {
  print('✅ 沒有孤立的 conversation_id');
} else {
  print(`⚠️  發現 ${orphanedConvCount} 筆孤立的 conversation_id`);
}

// 檢查不存在的用戶
const orphanedUsers = db.conversation_states.aggregate([
  {
    $lookup: {
      from: 'users',
      localField: 'user_id',
      foreignField: '_id',
      as: 'user'
    }
  },
  { $match: { user: { $size: 0 } } },
  { $count: 'count' }
]).toArray();

const orphanedUserCount = orphanedUsers.length > 0 ? orphanedUsers[0].count : 0;
if (orphanedUserCount === 0) {
  print('✅ 沒有孤立的 user_id\n');
} else {
  print(`⚠️  發現 ${orphanedUserCount} 筆孤立的 user_id\n`);
}

// 8. 抽樣檢查
print('[8/8] 抽樣檢查 (顯示前 5 筆記錄)...');
const samples = db.conversation_states.find({}).limit(5).toArray();
samples.forEach((state, index) => {
  print(`\n樣本 ${index + 1}:`);
  print(`  user_id: ${state.user_id}`);
  print(`  conversation_id: ${state.conversation_id}`);
  print(`  unread_count: ${state.unread_count}`);
  print(`  last_read_message_id: ${state.last_read_message_id || 'null'}`);
  print(`  last_read_at: ${state.last_read_at || 'null'}`);
  print(`  createdAt: ${state.createdAt}`);
});

// 9. 總結
print('\n========================================');
print('驗證總結');
print('========================================');

const issues = [];
if (messagesWithoutReadCount > 0) issues.push('部分訊息缺少 read_count 欄位');
if (messagesWithNullReadCount > 0) issues.push('部分訊息 read_count 為 null');
if (totalStates !== expected) issues.push('conversation_states 記錄數量不符');
if (!allIndexesExist) issues.push('索引缺失');
if (duplicates.length > 0) issues.push('存在重複記錄');
if (nonZeroUnread > 0) issues.push('部分記錄 unread_count 不為 0');
if (orphanedConvCount > 0) issues.push('存在孤立的 conversation_id');
if (orphanedUserCount > 0) issues.push('存在孤立的 user_id');

if (issues.length === 0) {
  print('✅ 所有檢查都通過！初始化成功！');
} else {
  print(`⚠️  發現 ${issues.length} 個問題:`);
  issues.forEach((issue, i) => {
    print(`  ${i + 1}. ${issue}`);
  });
  print('\n建議: 檢查初始化腳本或資料完整性');
}

print('========================================\n');
