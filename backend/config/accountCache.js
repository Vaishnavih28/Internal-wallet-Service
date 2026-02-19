import pool from './db.js'

const systemAccounts = {
  treasury:   null,
  bonus_pool: null,
  revenue:    null,
};

export async function loadSystemAccounts() {
  const conn = await pool.getConnection();
  try {
    
    const [rows] = await conn.execute(
      `SELECT id, account_type FROM accounts WHERE user_id = 1`
    );

    if (rows.length !== 3) {
      throw new Error('System accounts not properly seeded');
    }

    for (const row of rows) {
      systemAccounts[row.account_type] = row.id;
    }

    console.log('System accounts loaded:', systemAccounts);
  } finally {
    conn.release();
  }
}

export function getSystemAccountId(type) {
  const id = systemAccounts[type];
  if (!id) throw new Error(`System account '${type}' not found in cache`);
  return id;
}