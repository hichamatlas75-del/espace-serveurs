-- ============================================================================
-- GREY CORNER — SCHÉMA CLOUDFLARE D1 (SQLITE)
-- Base de données relationnelle serverless sur l'Edge Cloudflare
-- ============================================================================

-- 1. Tables du restaurant
CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY,
    zone TEXT NOT NULL,
    assignedTo TEXT DEFAULT '',
    status TEXT DEFAULT 'libre',
    active INTEGER DEFAULT 1,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. Demandes et appels clients (serveur, eau, addition, récompense)
CREATE TABLE IF NOT EXISTS waiters_calls (
    id TEXT PRIMARY KEY,
    tableNum INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    assignedTo TEXT DEFAULT '',
    loyaltyPhone TEXT DEFAULT '',
    loyaltyName TEXT DEFAULT '',
    note TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    acceptedAt TEXT,
    completedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_calls_status ON waiters_calls(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_calls_table ON waiters_calls(tableNum);

-- 3. Précommandes reçues depuis le menu QR
CREATE TABLE IF NOT EXISTS pre_orders (
    id TEXT PRIMARY KEY,
    tableNum INTEGER NOT NULL,
    items TEXT NOT NULL, -- JSON array of items [{id, name, qty, price, category}]
    note TEXT DEFAULT '',
    totalPrice REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    assignedTo TEXT DEFAULT '',
    loyaltyPhone TEXT DEFAULT '',
    loyaltyName TEXT DEFAULT '',
    loyaltyPoints INTEGER DEFAULT NULL,
    loyaltyCredited INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    acceptedAt TEXT,
    completedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON pre_orders(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_orders_table ON pre_orders(tableNum);

-- 4. Membres du Club Fidélité Grey Corner (500 pts = 1 consommation)
CREATE TABLE IF NOT EXISTS loyalty_members (
    phone TEXT PRIMARY KEY,
    firstName TEXT NOT NULL,
    points INTEGER DEFAULT 20,
    totalEarned INTEGER DEFAULT 20,
    rewardsClaimed INTEGER DEFAULT 0,
    source TEXT DEFAULT 'qr_menu',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_points ON loyalty_members(points);

-- 5. Historique des transactions fidélité (gains, déductions, cadeaux)
CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    type TEXT NOT NULL, -- 'WELCOME', 'EARN', 'REDEEM', 'ADMIN_ADJUST'
    pointsDelta INTEGER NOT NULL,
    amountDH REAL DEFAULT 0,
    tableNumber TEXT DEFAULT '',
    orderId TEXT DEFAULT '',
    validatedBy TEXT DEFAULT 'waiter',
    note TEXT DEFAULT '',
    createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_phone ON loyalty_transactions(phone, createdAt);

-- 6. Configuration système (Rush mode freeze, paramètres fidélité)
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);
