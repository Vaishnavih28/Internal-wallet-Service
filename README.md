# Internal Wallet Service

A high-throughput, double-entry ledger wallet service built with **Node.js + MySQL**.
Handles Gold Coins as the single in-app virtual currency for a gaming/loyalty platform.

---

## Table of Contents

- [Quick Start with Docker](#quick-start-with-docker)
- [Manual Setup](#manual-setup)
- [API Endpoints](#api-endpoints)
- [Technology Choices](#technology-choices)
- [Concurrency Strategy](#concurrency-strategy)
- [Idempotency Strategy](#idempotency-strategy)
- [Architecture: Double-Entry Ledger](#architecture-double-entry-ledger)
- [Running Tests](#running-tests)

---

## Quick Start with Docker

This is the recommended way to spin up the app. Docker will automatically start MySQL, run the seed script, and start the application.

```bash
# 1. Clone the repository
git clone Internal-wallet-Service
cd backend

# 2. Start everything
docker-compose up --build
```

That's it. Docker handles everything in the correct order:

1. Starts MySQL container
2. Runs `seed.sql` automatically (creates tables + inserts seed data)
3. Waits for MySQL to be healthy
4. Starts the Node.js app on port 3000

The API is available at `http://localhost:3000` once you see:

### How the Seed Script Runs Automatically

In `docker-compose.yml`, the seed file is mounted into a MySQL directory:

```yaml
volumes:
  - ./sql/seed.sql:/docker-entrypoint-initdb.d/seed.sql
```

The official MySQL Docker image automatically executes any `.sql` file found in `/docker-entrypoint-initdb.d/` on first startup. No manual steps required.

### Resetting to a Fresh State

The seed script only runs when the database volume is empty. To reset everything:

```bash
# Stop containers and delete the database volume
docker-compose down -v

# Start fresh- seed script will run again
docker-compose up --build
```

---

## Manual Setup

If you prefer to run without Docker:

### Prerequisites

- Node.js 18+
- MySQL 8.0+

### Steps

```bash
# 1. Create the database and run the seed script
mysql -u root -p sql/seed.sql

# 2. Install dependencies
npm install

# 3. Configure environment variables
# Create a .env file in the project root:
DB_HOST=localhost
DB_PORT=3306
DB_USER=mysql_user
DB_PASSWORD=mysql_password
DB_NAME=wallet_db
PORT=3000

# 4. Start the application
npm start

# Or for development with auto-reload
npm run dev
```

### What the Seed Script Does

The `sql/seed.sql` file:

1. Creates the `wallet_db` database
2. Creates all tables: `users`, `accounts`, `transactions`, `ledger_entries`
3. Inserts a system user (id=1) to own treasury, bonus_pool, and revenue accounts
4. Inserts two real users: Alice and Sam
5. Creates wallet accounts for all users
6. Seeds opening balances via proper ledger transactions:
   - Alice: 500 Gold Coins
   - Sam: 300 Gold Coins

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/wallet/topup` | Purchase Gold Coins |
| POST | `/api/wallet/bonus` | Issue free bonus coins |
| POST | `/api/wallet/spend` | Spend Gold Coins |
| GET | `/api/wallet/balance/:userId` | Get current balance |
| GET | `/api/wallet/history/:userId` | Get ledger history |

### Request & Response Examples

**Top-up**- user purchases 100 Gold Coins with real money:
```json
POST /api/wallet/topup
{
  "userId": 2,
  "amount": 100,
  "idempotencyKey": "order-payment-abc-123"
}

Response 201:
{
  "message": "Top-up successful",
  "transactionId": 3,
  "newBalance": 600
}
```

**Bonus**- system issues 50 free coins (referral reward, Daily checkin reward):
```json
POST /api/wallet/bonus
{
  "userId": 2,
  "amount": 50,
  "idempotencyKey": "referral-bonus-user2-jan2025",
  "description": "Referral bonus"
}

Response 201:
{
  "message": "Bonus issued successfully",
  "transactionId": 4,
  "newBalance": 650
}
```

**Spend**- user buys an in-game item for 30 coins:
```json
POST /api/wallet/spend
{
  "userId": 2,
  "amount": 30,
  "idempotencyKey": "item-purchase-sword-456",
  "description": "Bought Excalibur sword"
}

Response 201:
{
  "message": "Spend successful",
  "transactionId": 5,
  "newBalance": 620
}
```

**Insufficient balance** returns HTTP 422:
```json
{
  "error": "Insufficient balance",
  "currentBalance": 620,
  "requested": 99999
}
```

**Duplicate request** (same idempotency key) returns HTTP 200:
```json
{
  "message": "Already processed",
  "idempotent": true,
  "transactionId": 3
}
```

---

## Technology Choices

### Node.js + Express

Node.js was chosen for its **non-blocking, event-driven I/O model**, which makes it well-suited for high-concurrency workloads like a wallet service under heavy traffic. Express is minimal and gives full control over request handling without unnecessary abstraction.

### MySQL 8.0

MySQL was chosen over other databases for several reasons specific to this use case:

- **ACID transactions**- Every top-up, bonus, and spend is wrapped in a transaction. Either all ledger entries commit together or none do. There is no partial state.
- **Row-level locking**- MySQL's InnoDB engine supports `SELECT ... FOR UPDATE`, which allows locking specific rows inside a transaction. This is the foundation of the concurrency strategy.
- **Tested**- MySQL has decades of production use in financial and e-commerce systems where data integrity is critical.

### mysql2/promise

Raw SQL was used instead of an ORM (like Prisma or Sequelize) deliberately. The core of this service relies on `SELECT ... FOR UPDATE` for row-level locking a feature that ORMs either don't support natively or require dropping down to raw query mode anyway. Using raw SQL keeps the locking logic explicit, readable, and easy to reason.

### Docker + docker-compose

Containerization ensures the app runs identically across all environments. The `docker-compose.yml` wires up MySQL and the app together, with the seed script running automatically on first start.

---

## Concurrency Strategy

Concurrency is handled through three layers working together:

### Layer 1: Database Transactions (ACID)

Every business operation (topup, bonus, spend) runs inside an explicit MySQL transaction:

```
BEGIN
  → check idempotency
  → lock accounts
  → check balance (spend only)
  → insert transaction record
  → insert ledger entries
COMMIT
```

If anything fails at any step, the entire transaction rolls back. No partial writes ever reach the database.

### Layer 2: Row-Level Locking (`SELECT ... FOR UPDATE`)

Before reading or writing any account balance, the relevant account rows are locked using `SELECT ... FOR UPDATE`to prevent any race conditions. 

```javascript
await conn.execute(
  `SELECT id FROM accounts WHERE id = ? FOR UPDATE`,
  [id]
);
```

This prevents the classic **read-modify-write race condition**


### Layer 3: Ordered Lock Acquisition (Deadlock Prevention)

When a transaction needs to lock two accounts (e.g., user account + revenue account), there is a risk of deadlock if two transactions lock them in opposite orders.

To prevent this, locks are **always acquired in ascending account ID order**, regardless of the transaction type:

```javascript
async function lockAccountsInOrder(conn, accountIds) {
  const sorted = [...new Set(accountIds)].sort((a, b) => a - b);
  for (const id of sorted) {
    await conn.execute(
      `SELECT id FROM accounts WHERE id = ? FOR UPDATE`,
      [id]
    );
  }
}
```

This guarantees that any two transactions touching the same pair of accounts will always lock them in the same order, eliminating circular waits entirely.

### System Account Cache (Performance)

System account IDs (treasury, bonus_pool, revenue) are loaded into memory once at startup. Every transaction that references a system account reads from memory instead of querying the database, eliminating unnecessary DB round trips on every request.

---

## Idempotency Strategy

Idempotency ensures that retrying the same request (due to network timeouts, client retries, etc.) never results in double processing.

### How It Works

Every write request requires an `idempotencyKey` from the client. This key is stored with a `UNIQUE` constraint in the `transactions` table.

The check happens inside the database transaction using two layers of protection:

**Layer 1- Explicit check before processing:**
```javascript
const [existing] = await conn.execute(
  `SELECT id FROM transactions WHERE idempotency_key = ?`,
  [idempotencyKey]
);
if (existing.length > 0) {
  // Return the original result without processing again
  return res.status(200).json({ message: 'Already processed', idempotent: true });
}
```

**Layer 2- Unique constraint catches race conditions:**

If two identical requests arrive simultaneously, both may pass the explicit check before either has committed. The `UNIQUE` constraint on `idempotency_key` ensures only one `INSERT` succeeds. The other receives `ER_DUP_ENTRY` from MySQL, which is caught and handled gracefully:

```javascript
} catch (err) {
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(200).json({ message: 'Already processed', idempotent: true });
  }
}
```


## Architecture: Double-Entry Ledger

Instead of storing a balance column that gets updated on every transaction, this service uses a **double-entry ledger**-the same accounting system used by banks.

Every business event creates exactly two ledger entries that sum to zero:

```
Top-up 100 coins:
  Treasury account:    -100  (debit - money leaves treasury)
  User account:        +100  (credit- money enters user wallet)
  ──────────────────────────
  Net:                    0  ✓

Bonus 50 coins:
  Bonus Pool account:   -50  (debit)
  User account:         +50  (credit)
  ──────────────────────────
  Net:                    0  ✓

Spend 30 coins:
  User account:         -30  (debit - money leaves user wallet)
  Revenue account:      +30  (credit- money enters revenue)
  ──────────────────────────
  Net:                    0  ✓
```

**Balance is never stored- it is always computed:**
```sql
SELECT COALESCE(SUM(amount), 0) AS balance
FROM ledger_entries
WHERE account_id = ?
```

This means:
- The balance is always consistent with the full transaction history
- Nothing is ever updated or deleted- the ledger is append-only
- A complete audit trail exists for every credit ever issued or spent
- The sum of all ledger entries across the entire system always equals zero

### System Accounts

Three system accounts handle the source and destination of all coin flows:

| Account | Role | Used In |
|---------|------|---------|
| Treasury | Source for purchased coins | Top-up flow |
| Bonus Pool | Source for free/incentive coins | Bonus flow |
| Revenue | Destination for spent coins | Spend flow |

System accounts are owned by a dedicated system user (id=1).

---

## Running Tests

### Concurrency Tests

```bash
node testConcurrency.js
```

Tests:
- 5 simultaneous top-ups- all should succeed and balance should increase by exactly 500
- 10 simultaneous spends on a 1000-coin balance- all 10 should succeed, balance 0
- 5 simultaneous spends on zero balance- all should be rejected, balance stays 0

### Idempotency Tests

```bash
node testIdempotency.js
```

Tests:
- Same request sent 3 times sequentially- only processes once
- Same request sent 5 times simultaneously- race condition handled, only processes once
- 3 requests with different keys- all 3 process independently
