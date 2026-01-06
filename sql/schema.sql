PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url TEXT DEFAULT '/public/avatar-placeholder.png',
  rating REAL DEFAULT 4.7,
  tags TEXT DEFAULT 'Quick reply, PRO seller',
  verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL,
  brand_name TEXT,
  category_hashtag TEXT NOT NULL,
  condition TEXT NOT NULL,
  features TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  shipping_fee_payer TEXT NOT NULL,          -- Yes | No (shipping included in price?)
  shipping_method TEXT NOT NULL,
  days_to_ship TEXT NOT NULL,
  price_vnd INTEGER NOT NULL,
  shipping_from_city TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',  -- available | sold | discarded
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS item_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  item_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

-- New order flow:
-- purchase (buyer) -> confirm payment (buyer) -> seller chooses shipping method -> seller confirms shipped -> buyer confirms received
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,

  price_vnd INTEGER NOT NULL,
  shipping_fee_vnd INTEGER NOT NULL DEFAULT 0,       -- 20000 if not included in price else 0
  shipping_included INTEGER NOT NULL DEFAULT 0,      -- 1 if included in price

  payment_method TEXT,                               -- vnpay | card | momo (prototype)
  shipping_method_choice TEXT,                       -- tomatogo | other | meetup

  status TEXT NOT NULL DEFAULT 'awaiting_payment',   -- awaiting_payment | awaiting_shipping_method | awaiting_shipment | shipped | completed
  paid_at TEXT,
  shipped_at TEXT,
  received_at TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  no_actions INTEGER NOT NULL DEFAULT 0,             -- 1 = no interactive buttons on notifications page
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
