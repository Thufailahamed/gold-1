CREATE TABLE subcategories (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE designs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE product_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE metal_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE stone_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
INSERT INTO metal_types (id, name, code, created_at) VALUES
  ('metal-gold', 'Gold', 'GOLD', 1759000000000),
  ('metal-silver', 'Silver', 'SILVER', 1759000000000),
  ('metal-platinum', 'Platinum', 'PLATINUM', 1759000000000);
INSERT INTO stone_types (id, name, code, created_at) VALUES
  ('stone-none', 'None', 'NONE', 1759000000000),
  ('stone-diamond', 'Diamond', 'DIAMOND', 1759000000000),
  ('stone-ruby', 'Ruby', 'RUBY', 1759000000000),
  ('stone-sapphire', 'Sapphire', 'SAPPHIRE', 1759000000000),
  ('stone-emerald', 'Emerald', 'EMERALD', 1759000000000),
  ('stone-pearl', 'Pearl', 'PEARL', 1759000000000);
