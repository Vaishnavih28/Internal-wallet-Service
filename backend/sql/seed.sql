CREATE DATABASE IF NOT EXISTS wallet_db;
USE wallet_db;



CREATE TABLE IF NOT EXISTS users (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username   VARCHAR(100) NOT NULL UNIQUE,
    email      VARCHAR(255) NOT NULL UNIQUE,
    is_system  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id      INT UNSIGNED NOT NULL,
    account_type ENUM('user', 'treasury', 'bonus_pool', 'revenue') NOT NULL,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT chk_account_type CHECK (
        (user_id = 1 AND account_type IN ('treasury', 'bonus_pool', 'revenue'))
        OR
        (user_id != 1 AND account_type = 'user')
    ),
    UNIQUE KEY uq_user_account (user_id, account_type)
);

CREATE TABLE IF NOT EXISTS transactions (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    type            ENUM('topup', 'bonus', 'spend') NOT NULL,
    description     VARCHAR(500),
    status          ENUM('pending', 'completed', 'failed') NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_idempotency (idempotency_key)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT UNSIGNED NOT NULL,
    account_id     INT UNSIGNED NOT NULL,
    amount         DECIMAL(18, 4) NOT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (account_id)     REFERENCES accounts(id),
    INDEX idx_account     (account_id),
    INDEX idx_transaction (transaction_id)
);



INSERT INTO users (id, username, email, is_system) VALUES
    (1, 'System Account', 'SystemAccount@gmail.com', TRUE);

INSERT INTO users (username, email) VALUES
    ('Alice', 'AliceThomas@gmail.com'),
    ('Sam',   'Sam@gmail.com');


INSERT INTO accounts (user_id, account_type) VALUES
    (1, 'treasury'),
    (1, 'bonus_pool'),
    (1, 'revenue');


INSERT INTO accounts (user_id, account_type)
SELECT id, 'user' FROM users
WHERE is_system = FALSE;


INSERT INTO transactions (idempotency_key, type, description, status)
VALUES ('seed-alice-opening-balance', 'topup', 'Opening balance for Alice', 'completed');

INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES
    (LAST_INSERT_ID(),
     (SELECT id FROM accounts WHERE user_id = 1 AND account_type = 'treasury'),
     -500.0000),
    (LAST_INSERT_ID(),
     (SELECT a.id FROM accounts a JOIN users u ON a.user_id = u.id
      WHERE u.username = 'Alice' AND a.account_type = 'user'),
     500.0000);


INSERT INTO transactions (idempotency_key, type, description, status)
VALUES ('seed-sam-opening-balance', 'topup', 'Opening balance for Sam', 'completed');

INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES
    (LAST_INSERT_ID(),
     (SELECT id FROM accounts WHERE user_id = 1 AND account_type = 'treasury'),
     -300.0000),
    (LAST_INSERT_ID(),
     (SELECT a.id FROM accounts a JOIN users u ON a.user_id = u.id
      WHERE u.username = 'Sam' AND a.account_type = 'user'),
     300.0000);