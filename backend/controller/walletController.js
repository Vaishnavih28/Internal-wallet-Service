import pool from '../config/db.js';
import { getSystemAccountId } from '../config/accountCache.js';


async function getAccountBalance(conn, accountId) {
  const [rows] = await conn.execute(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM ledger_entries WHERE account_id = ?`,
    [accountId]
  );
  return parseFloat(rows[0].balance);
}

async function getUserAccountId(conn, userId) {
  const [rows] = await conn.execute(
    `SELECT id FROM accounts
     WHERE user_id = ? AND account_type = 'user'`,
    [userId]
  );
  if (!rows.length) throw new Error(`No account found for user ${userId}`);
  return rows[0].id;
}

async function lockAccountsInOrder(conn, accountIds) {
  const sorted = [...new Set(accountIds)].sort((a, b) => a - b);
  for (const id of sorted) {
    await conn.execute(
      `SELECT id FROM accounts WHERE id = ? FOR UPDATE`,
      [id]
    );
  }
}

async function postDoubleEntry(conn, {
  idempotencyKey, type, description,
  debitAccountId, creditAccountId, amount,
}) {
  await conn.execute(
    `INSERT INTO transactions (idempotency_key, type, description, status)
     VALUES (?, ?, ?, 'completed')`,
    [idempotencyKey, type, description]
  );
  const [result] = await conn.execute(`SELECT LAST_INSERT_ID() AS id`);
  const transactionId = result[0].id;

  await conn.execute(
    `INSERT INTO ledger_entries (transaction_id, account_id, amount)
     VALUES (?, ?, ?)`,
    [transactionId, debitAccountId, -amount]
  );
  await conn.execute(
    `INSERT INTO ledger_entries (transaction_id, account_id, amount)
     VALUES (?, ?, ?)`,
    [transactionId, creditAccountId, amount]
  );
  return transactionId;
}

async function checkIdempotency(conn, idempotencyKey) {
  const [rows] = await conn.execute(
    `SELECT id, status FROM transactions WHERE idempotency_key = ?`,
    [idempotencyKey]
  );
  return rows.length > 0 ? rows[0] : null;
}


export const topUp = async (req, res) => {
  const { userId, amount, idempotencyKey } = req.body;

  if (!userId || !amount || !idempotencyKey) {
    return res.status(400).json({ error: 'userId, amount, idempotencyKey are required' });
  }
  if (amount <= 0) {
    return res.status(400).json({ error: 'Amount must be positive' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const existing = await checkIdempotency(conn, idempotencyKey);
    if (existing) {
      await conn.rollback();
      return res.status(200).json({
        message: 'Already processed', idempotent: true, transactionId: existing.id,
      });
    }

    const treasuryId = getSystemAccountId('treasury');
    const userAccountId = await getUserAccountId(conn, userId);

    await lockAccountsInOrder(conn, [treasuryId, userAccountId]);

    const txId = await postDoubleEntry(conn, {
      idempotencyKey,
      type: 'topup',
      description: `Top-up ${amount} Gold Coins for user ${userId}`,
      debitAccountId: treasuryId,
      creditAccountId: userAccountId,
      amount,
    });

    const newBalance = await getAccountBalance(conn, userAccountId);

    await conn.commit();
    return res.status(201).json({ message: 'Top-up successful', transactionId: txId, newBalance });

  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(200).json({ message: 'Already processed', idempotent: true });
    }
    console.error('TopUp error:', err);
    return res.status(500).json({ error: 'Transaction failed' });
  } finally {
    conn.release();
  }
};


export const issueBonus = async (req, res) => {
  const { userId, amount, idempotencyKey, description } = req.body;

  if (!userId || !amount || !idempotencyKey) {
    return res.status(400).json({ error: 'userId, amount, idempotencyKey are required' });
  }
  if (amount <= 0) {
    return res.status(400).json({ error: 'Amount must be positive' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const existing = await checkIdempotency(conn, idempotencyKey);
    if (existing) {
      await conn.rollback();
      return res.status(200).json({
        message: 'Already processed', idempotent: true, transactionId: existing.id,
      });
    }

    const bonusPoolId = getSystemAccountId('bonus_pool');
    const userAccountId = await getUserAccountId(conn, userId);

    await lockAccountsInOrder(conn, [bonusPoolId, userAccountId]);

    const txId = await postDoubleEntry(conn, {
      idempotencyKey,
      type: 'bonus',
      description: description || `Bonus of ${amount} Gold Coins for user ${userId}`,
      debitAccountId: bonusPoolId,
      creditAccountId: userAccountId,
      amount,
    });

    const newBalance = await getAccountBalance(conn, userAccountId);

    await conn.commit();
    return res.status(201).json({ message: 'Bonus issued successfully', transactionId: txId, newBalance });

  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(200).json({ message: 'Already processed', idempotent: true });
    }
    console.error('Bonus error:', err);
    return res.status(500).json({ error: 'Transaction failed' });
  } finally {
    conn.release();
  }
};


export const spend = async (req, res) => {
  const { userId, amount, idempotencyKey, description } = req.body;

  if (!userId || !amount || !idempotencyKey) {
    return res.status(400).json({ error: 'userId, amount, idempotencyKey are required' });
  }
  if (amount <= 0) {
    return res.status(400).json({ error: 'Amount must be positive' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const existing = await checkIdempotency(conn, idempotencyKey);
    if (existing) {
      await conn.rollback();
      return res.status(200).json({
        message: 'Already processed', idempotent: true, transactionId: existing.id,
      });
    }

    const userAccountId = await getUserAccountId(conn, userId);
    const revenueId = getSystemAccountId('revenue');

    await lockAccountsInOrder(conn, [userAccountId, revenueId]);

    const currentBalance = await getAccountBalance(conn, userAccountId);
    if (currentBalance < amount) {
      await conn.rollback();
      return res.status(422).json({
        error: 'Insufficient balance', currentBalance, requested: amount,
      });
    }

    const txId = await postDoubleEntry(conn, {
      idempotencyKey,
      type: 'spend',
      description: description || `Spend ${amount} Gold Coins by user ${userId}`,
      debitAccountId: userAccountId,
      creditAccountId: revenueId,
      amount,
    });

    const newBalance = await getAccountBalance(conn, userAccountId);

    await conn.commit();
    return res.status(201).json({ message: 'Spend successful', transactionId: txId, newBalance });

  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(200).json({ message: 'Already processed', idempotent: true });
    }
    console.error('Spend error:', err);
    return res.status(500).json({ error: 'Transaction failed' });
  } finally {
    conn.release();
  }
};


export const getBalance = async (req, res) => {
  const { userId } = req.params;

  const conn = await pool.getConnection();
  try {
    const userAccountId = await getUserAccountId(conn, userId);
    const balance = await getAccountBalance(conn, userAccountId);

    return res.status(200).json({
      userId: parseInt(userId),
      balance,
      currency: 'Gold Coins',
    });
  } catch (err) {
    console.error('Balance error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

export const getHistory = async (req, res) => {
  const { userId } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;

  const safeLimit =
    Number.isInteger(limit) && limit > 0 && limit <= 100
      ? limit
      : 20;

  const safeOffset =
    Number.isInteger(offset) && offset >= 0
      ? offset
      : 0;

  const conn = await pool.getConnection();
  try {
    const userAccountId = await getUserAccountId(conn, userId);


    const [rows] = await conn.execute(
      `SELECT t.id AS transactionId,t.type,t.description,t.status,t.created_at,le.amount
       FROM ledger_entries le
       JOIN transactions t 
       ON le.transaction_id = t.id
       WHERE le.account_id = ?
       ORDER BY t.created_at DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [userAccountId]
    );

    return res.status(200).json({ history: rows });
  } catch (err) {
    console.error('History error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};