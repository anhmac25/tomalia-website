const path = require("path");
const fs = require("fs");
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const methodOverride = require("method-override");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const QRCode = require("qrcode");

const { openDb, runSchema, DB_PATH } = require("./db");

// --- Render persistent disk bootstrap (keeps your bundled tomalia.sqlite as initial DB)
const RENDER_DB_PATH = process.env.DB_PATH; // e.g. /var/data/tomalia.sqlite
if (RENDER_DB_PATH && RENDER_DB_PATH.startsWith("/var/data")) {
  const bundled = path.join(__dirname, "tomalia.sqlite");
  const target = RENDER_DB_PATH;

  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(bundled)) {
        fs.copyFileSync(bundled, target);
        console.log("[DB] Copied bundled tomalia.sqlite to:", target);
      } else {
        console.log("[DB] Bundled tomalia.sqlite not found, will create new DB at:", target);
      }
    }
  } catch (e) {
    console.error("[DB] bootstrap failed:", e);
  }
}

const app = express();
const db = openDb();
runSchema(db);

// ---- App config
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));

// static
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// sessions
app.use(
  session({
    store: new SQLiteStore({
      db: process.env.SESSIONS_DB_FILE || "sessions.sqlite",
      dir: process.env.SESSIONS_DB_DIR || __dirname
    }),
    secret: "tomalia-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true },
  })
);

// ---- Multer for uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "uploads"));
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, Date.now() + "_" + safeName);
  },
});
const upload = multer({ storage });

// ---- Helpers
function currencyVND(n) {
  try {
    return new Intl.NumberFormat("vi-VN").format(n) + " ₫";
  } catch {
    return String(n) + " ₫";
  }
}

function daysAgo(isoString) {
  const created = new Date(isoString + "Z"); // stored as UTC-like in sqlite
  const now = new Date();
  const diffMs = now - created;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
  next();
}

function isSeller(req, itemRow) {
  return req.session.user && Number(req.session.user.id) === Number(itemRow.seller_id);
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function createNotification(userId, title, body, link = null, opts = {}) {
  const noActions = opts.noActions ? 1 : 0;
  const isRead = opts.isRead ? 1 : 0;

  // Try new schema first (has no_actions + is_read)
  try {
    await dbRun(
      "INSERT INTO notifications (user_id, title, body, link, no_actions, is_read) VALUES (?,?,?,?,?,?)",
      [userId, title, body, link, noActions, isRead]
    );
    return;
  } catch (err) {
    // Fallback for older DB schema (only user_id, title, body, link)
    await dbRun(
      "INSERT INTO notifications (user_id, title, body, link) VALUES (?,?,?,?)",
      [userId, title, body, link]
    );
  }
}


function isShippingIncludedValue(v) {
  const s = String(v || "").toLowerCase().trim();
  return s === "yes" || s.includes("included") || s.includes("seller pays");
}

async function seedIfEmpty() {
  const u = await dbGet("SELECT COUNT(*) as c FROM users");
  const i = await dbGet("SELECT COUNT(*) as c FROM items");
  if (u.c === 0) {
    const pass = await bcrypt.hash("Password123!", 10);
    await dbRun(
      "INSERT INTO users (name, username, phone, email, password_hash, rating, tags, verified) VALUES (?,?,?,?,?,?,?,?)",
      ["Demo Seller", "demo_seller", "+84 900000000", "seller@tomalia.vn", pass, 4.8, "Quick reply, PRO seller", 1]
    );
    await dbRun(
      "INSERT INTO users (name, username, phone, email, password_hash, rating, tags, verified) VALUES (?,?,?,?,?,?,?,?)",
      ["Demo Buyer", "demo_buyer", "+84 911111111", "buyer@tomalia.vn", pass, 4.6, "Bulk purchase supporter", 0]
    );
  }
  if (i.c === 0) {
    const seller = await dbGet("SELECT id FROM users WHERE username='demo_seller'");
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const items = [
      {
        name: "Photocard set - limited edition",
        category: "#kpop #photocard",
        condition: "Like new",
        brand: "N/A",
        features: "Official, rare, sleeved",
        desc: "Authentic photocard set. Stored in sleeve + toploader. DM for more photos.",
        price: 350000,
        city: "Ho Chi Minh City",
      },
      {
        name: "Anime figure (sealed box)",
        category: "#anime #figure",
        condition: "New, unused",
        brand: "Banpresto",
        features: "Sealed, no box damage",
        desc: "Bought from official retailer. Box sealed, perfect condition.",
        price: 890000,
        city: "Hanoi",
      },
      {
        name: "V-pop concert lightstick (2024)",
        category: "#vpop #lightstick",
        condition: "Slightly scratched or dirty",
        brand: "Official",
        features: "Works well, battery not included",
        desc: "Used once in concert. Minor scratches but fully functional.",
        price: 420000,
        city: "Da Nang",
      }
    ];
    for (const it of items) {
      const r = await dbRun(
        `INSERT INTO items
        (seller_id, brand_name, category_hashtag, condition, features, name, description, shipping_fee_payer, shipping_method, days_to_ship, price_vnd, shipping_from_city)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          seller.id,
          it.brand,
          it.category,
          it.condition,
          it.features,
          it.name,
          it.desc,
          "Yes",
          "Standard delivery",
          "1-2 days",
          it.price,
          it.city,
        ]
      );
      // Add placeholder images (use a local SVG)
      await dbRun("INSERT INTO item_images (item_id, file_path, sort_order) VALUES (?,?,?)", [
        r.lastID,
        "/public/item-placeholder.svg",
        0,
      ]);
    }
  }
}
seedIfEmpty().catch(console.error);

// ---- Globals to templates
app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.currencyVND = currencyVND;
  res.locals.daysAgo = daysAgo;

  // unread notif count
  if (req.session.user) {
    try {
      const row = await dbGet(
        "SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0",
        [req.session.user.id]
      );
      res.locals.unreadCount = row.c;
    } catch (e) {
      res.locals.unreadCount = 0;
    }
  } else {
    res.locals.unreadCount = 0;
  }

  next();
});

// ---- Routes
app.get("/", async (req, res) => {
  const categories = [
    { label: "K‑pop", tag: "kpop" },
    { label: "Anime/Manga", tag: "anime" },
    { label: "V‑pop", tag: "vpop" },
    { label: "Games", tag: "game" },
    { label: "Art Toys", tag: "toy" },
    { label: "Books/Novel", tag: "books" },
    { label: "Esports/Streamer", tag: "esports" },
  ];

  let items = [];
  if (req.session.user) {
    // suggestions based on last viewed categories
    const viewed = await dbAll(
      `SELECT items.category_hashtag as category
       FROM views JOIN items ON items.id=views.item_id
       WHERE views.user_id=?
       ORDER BY views.created_at DESC
       LIMIT 8`,
      [req.session.user.id]
    );
    const cats = [...new Set(viewed.map((v) => (v.category || "").split(/\s+/)[0]).filter(Boolean))];
    if (cats.length > 0) {
      const like = cats.map(() => "items.category_hashtag LIKE ?").join(" OR ");
      const params = cats.map((c) => `%${c}%`);
      items = await dbAll(
        `SELECT items.*, users.username, users.rating
         FROM items JOIN users ON users.id=items.seller_id
         WHERE items.status='available' AND (${like})
         ORDER BY items.created_at DESC
         LIMIT 12`,
        params
      );
    }
  }
  if (items.length === 0) {
    // fallback: newest available items
    items = await dbAll(
      `SELECT items.*, users.username, users.rating
       FROM items JOIN users ON users.id=items.seller_id
       WHERE items.status='available'
       ORDER BY items.created_at DESC
       LIMIT 12`
    );
  }

  // attach first image
  for (const it of items) {
    const img = await dbGet("SELECT file_path FROM item_images WHERE item_id=? ORDER BY sort_order ASC LIMIT 1", [
      it.id,
    ]);
    it.image = img ? img.file_path : "/public/item-placeholder.svg";
    if (it.status === 'sold') {
      const o = await dbGet(
        "SELECT id FROM orders WHERE item_id=? ORDER BY created_at DESC LIMIT 1",
        [it.id]
      );
      it.order_id = o ? o.id : null;
    }

  }

  res.render("index", { title: "Tomalia", items, categories });
});

app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const tagRaw = (req.query.tag || "").trim();
  const tag = tagRaw.startsWith("#") ? tagRaw.slice(1) : tagRaw;
  const where = [];
  const params = [];

  where.push("items.status != 'discarded'");
  if (q) {
    where.push("(items.name LIKE ? OR items.description LIKE ? OR items.category_hashtag LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (tag) {
    where.push("(items.category_hashtag LIKE ? OR items.category_hashtag LIKE ?)");
    params.push(`%#${tag}%`, `%${tag}%`);
  }
  const sql = `
    SELECT items.*, users.username, users.rating
    FROM items JOIN users ON users.id=items.seller_id
    WHERE ${where.join(" AND ")}
    ORDER BY items.created_at DESC
    LIMIT 60
  `;
  const items = await dbAll(sql, params);
  for (const it of items) {
    const img = await dbGet("SELECT file_path FROM item_images WHERE item_id=? ORDER BY sort_order ASC LIMIT 1", [it.id]);
    it.image = img ? img.file_path : "/public/item-placeholder.svg";
  }
  res.render("search", { title: "Search", items, q, tag });
});

// Auth
app.get("/register", (req, res) => res.render("auth_register", { title: "Register", error: null }));
app.post("/register", async (req, res) => {
  const { name, username, phone, email, password } = req.body;
  const phoneNorm = (phone || "").trim();
  const emailNorm = (email || "").trim().toLowerCase();
  const usernameNorm = (username || "").trim();

  if (!name || !usernameNorm || !phoneNorm || !emailNorm || !password) {
    return res.render("auth_register", { title: "Register", error: "Please fill in all required fields." });
  }
  if (!phoneNorm.startsWith("+84")) {
    return res.render("auth_register", { title: "Register", error: "Phone must start with +84." });
  }
  if (password.length < 8) {
    return res.render("auth_register", { title: "Register", error: "Password must be at least 8 characters." });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await dbRun(
      "INSERT INTO users (name, username, phone, email, password_hash) VALUES (?,?,?,?,?)",
      [name.trim(), usernameNorm, phoneNorm, emailNorm, hash]
    );
    req.session.user = { id: r.lastID, name: name.trim(), username: usernameNorm };
    return res.redirect("/");
  } catch (e) {
    const msg = String(e.message || e);
    let error = "Could not register. Username/phone/email may already exist.";
    if (msg.includes("UNIQUE")) error = "Username, phone, or email already exists.";
    return res.render("auth_register", { title: "Register", error });
  }
});

app.get("/login", (req, res) => res.render("auth_login", { title: "Login", error: null, next: req.query.next || "/" }));
app.post("/login", async (req, res) => {
  const { identifier, password, next } = req.body; // identifier can be email or username
  const id = (identifier || "").trim();
  if (!id || !password) return res.render("auth_login", { title: "Login", error: "Missing credentials.", next });

  const user = await dbGet("SELECT * FROM users WHERE email=? OR username=?", [id.toLowerCase(), id]);
  if (!user) return res.render("auth_login", { title: "Login", error: "Invalid credentials.", next });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.render("auth_login", { title: "Login", error: "Invalid credentials.", next });

  req.session.user = { id: user.id, name: user.name, username: user.username };
  res.redirect(next || "/");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// Notifications
app.get("/notifications", requireAuth, async (req, res) => {
  const notifs = await dbAll(
    "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
    [req.session.user.id]
  );
  res.render("notifications", { title: "Notifications", notifs });
});

app.post("/notifications/:id/read", requireAuth, async (req, res) => {
  await dbRun("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?", [req.params.id, req.session.user.id]);
  res.redirect("/notifications");
});

// Item detail
app.get("/items/:id", async (req, res) => {
  const id = Number(req.params.id);
  const item = await dbGet(
    `SELECT items.*, users.name as seller_name, users.username as seller_username, users.rating as seller_rating,
            users.tags as seller_tags, users.verified as seller_verified, users.avatar_url as seller_avatar
     FROM items JOIN users ON users.id=items.seller_id
     WHERE items.id=?`,
    [id]
  );
  if (!item) return res.status(404).send("Item not found");

  // log view (also for anonymous)
  await dbRun("INSERT INTO views (user_id, item_id) VALUES (?,?)", [req.session.user ? req.session.user.id : null, id]);

  const images = await dbAll("SELECT * FROM item_images WHERE item_id=? ORDER BY sort_order ASC", [id]);

  // interest count
  const interestCountRow = await dbGet("SELECT COUNT(*) as c FROM interests WHERE item_id=?", [id]);
  const interestCount = interestCountRow.c;

  let interested = false;
  if (req.session.user) {
    const r = await dbGet("SELECT 1 as ok FROM interests WHERE user_id=? AND item_id=?", [req.session.user.id, id]);
    interested = !!r;
  }

  // suggestions based on hashtag token (first tag)
  const token = (item.category_hashtag || "").split(/\s+/)[0];
  const suggestions = await dbAll(
    `SELECT items.*, users.username
     FROM items JOIN users ON users.id=items.seller_id
     WHERE items.status='available' AND items.id!=? AND items.category_hashtag LIKE ?
     ORDER BY items.created_at DESC
     LIMIT 8`,
    [id, `%${token}%`]
  );
  for (const s of suggestions) {
    const img = await dbGet("SELECT file_path FROM item_images WHERE item_id=? ORDER BY sort_order ASC LIMIT 1", [s.id]);
    s.image = img ? img.file_path : "/public/item-placeholder.svg";
  }

  // related keywords (simple)
  const keywords = Array.from(
    new Set(
      (item.name + " " + item.category_hashtag)
        .toLowerCase()
        .replace(/[^\w\s#-]+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3)
        .slice(0, 8)
    )
  );

  res.render("item", {
    title: item.name,
    item,
    images,
    interestCount,
    interested,
    isOwner: isSeller(req, item),
    suggestions,
    keywords,
  });
});

// Interest toggle (AJAX)
app.post("/api/items/:id/interest", requireAuth, async (req, res) => {
  const itemId = Number(req.params.id);
  const item = await dbGet("SELECT status FROM items WHERE id=?", [itemId]);
  if (!item || item.status !== "available") {
    return res.status(400).json({ ok: false, message: "Item not available" });
  }

  const exists = await dbGet("SELECT id FROM interests WHERE user_id=? AND item_id=?", [req.session.user.id, itemId]);
  if (exists) {
    await dbRun("DELETE FROM interests WHERE id=?", [exists.id]);
  } else {
    await dbRun("INSERT INTO interests (user_id, item_id) VALUES (?,?)", [req.session.user.id, itemId]);
  }
  const countRow = await dbGet("SELECT COUNT(*) as c FROM interests WHERE item_id=?", [itemId]);
  res.json({ ok: true, interested: !exists, count: countRow.c });
});

// Cart
app.post("/api/items/:id/cart", requireAuth, async (req, res) => {
  const itemId = Number(req.params.id);
  const item = await dbGet("SELECT status FROM items WHERE id=?", [itemId]);
  if (!item || item.status !== "available") return res.status(400).json({ ok: false, message: "Item not available" });

  try {
    await dbRun("INSERT INTO cart_items (user_id, item_id) VALUES (?,?)", [req.session.user.id, itemId]);
  } catch (_) {
    // ignore duplicate
  }
  res.json({ ok: true });
});

app.get("/cart", requireAuth, async (req, res) => {
  const items = await dbAll(
    `SELECT items.*, users.username
     FROM cart_items
     JOIN items ON items.id=cart_items.item_id
     JOIN users ON users.id=items.seller_id
     WHERE cart_items.user_id=?
     ORDER BY cart_items.created_at DESC`,
    [req.session.user.id]
  );
  for (const it of items) {
    const img = await dbGet("SELECT file_path FROM item_images WHERE item_id=? ORDER BY sort_order ASC LIMIT 1", [it.id]);
    it.image = img ? img.file_path : "/public/item-placeholder.svg";
  }
  res.render("cart", { title: "Cart", items });
});

app.delete("/cart/:itemId", requireAuth, async (req, res) => {
  await dbRun("DELETE FROM cart_items WHERE user_id=? AND item_id=?", [req.session.user.id, req.params.itemId]);
  res.redirect("/cart");
});

// Buy Now (creates order, marks item as sold/reserved)
app.post("/items/:id/buy", requireAuth, async (req, res) => {
  const itemId = Number(req.params.id);
  const item = await dbGet("SELECT * FROM items WHERE id=?", [itemId]);
  if (!item || item.status !== "available") return res.status(400).send("Item is not available.");

  if (Number(item.seller_id) === Number(req.session.user.id)) {
    return res.status(400).send("You cannot buy your own item.");
  }

  // Reserve the item immediately to prevent double-buy.
  await dbRun("UPDATE items SET status='sold', updated_at=datetime('now') WHERE id=?", [itemId]);

  const shippingIncluded = isShippingIncludedValue(item.shipping_fee_payer);
  const shippingFlat = 20000;
  const shippingFee = shippingIncluded ? 0 : shippingFlat;

  const r = await dbRun(
    `INSERT INTO orders (buyer_id, seller_id, item_id, price_vnd, shipping_fee_vnd, shipping_included)
     VALUES (?,?,?,?,?,?)`,
    [req.session.user.id, item.seller_id, itemId, item.price_vnd, shippingFee, shippingIncluded ? 1 : 0]
  );

  // Notify buyer to proceed to payment (transaction screen).
  await createNotification(
    req.session.user.id,
    "This item is ready for your payment, traveler!",
    `You reserved "${item.name}". Please confirm payment to continue.`,
    `/orders/${r.lastID}/transaction`
  );

  res.redirect(`/orders/${r.lastID}/transaction`);
});

// Sell page
app.get("/sell", requireAuth, (req, res) => {
  res.render("sell", { title: "Sell an item", error: null, form: {} });
});

app.post("/sell", requireAuth, upload.array("photos", 8), async (req, res) => {
  const photos = req.files || [];
  if (photos.length < 1) {
    return res.render("sell", { title: "Sell an item", error: "At least 1 photo is required.", form: req.body });
  }

  const {
    category_hashtag,
    brand_name,
    condition,
    features,
    product_name,
    description,
    shipping_fee_payer,
    shipping_method,
    days_to_ship,
    price_vnd,
    shipping_from_city,
  } = req.body;

  if (!category_hashtag || !condition || !product_name || !description || !shipping_fee_payer || !shipping_method || !days_to_ship || !price_vnd || !shipping_from_city) {
    return res.render("sell", { title: "Sell an item", error: "Please fill in all required fields.", form: req.body });
  }
  if (String(product_name).length > 50) {
    return res.render("sell", { title: "Sell an item", error: "Product Name must be max 50 characters.", form: req.body });
  }

  const price = Number(price_vnd);
  if (!Number.isFinite(price) || price <= 0) {
    return res.render("sell", { title: "Sell an item", error: "Selling Price must be a positive number.", form: req.body });
  }

  const r = await dbRun(
    `INSERT INTO items
     (seller_id, brand_name, category_hashtag, condition, features, name, description, shipping_fee_payer, shipping_method, days_to_ship, price_vnd, shipping_from_city)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      req.session.user.id,
      brand_name || "",
      category_hashtag.trim(),
      condition,
      features || "",
      product_name.trim(),
      description.trim(),
      shipping_fee_payer,
      shipping_method,
      days_to_ship,
      price,
      shipping_from_city,
    ]
  );

  // images
  let sort = 0;
  for (const f of photos) {
    await dbRun("INSERT INTO item_images (item_id, file_path, sort_order) VALUES (?,?,?)", [
      r.lastID,
      "/uploads/" + f.filename,
      sort++,
    ]);
  }

  res.redirect(`/items/${r.lastID}`);
});

// Edit item (seller only)
app.get("/items/:id/edit", requireAuth, async (req, res) => {
  const itemId = Number(req.params.id);
  const item = await dbGet("SELECT * FROM items WHERE id=?", [itemId]);
  if (!item) return res.status(404).send("Item not found");
  if (!isSeller(req, item)) return res.status(403).send("Forbidden");

  res.render("item_edit", { title: "Edit item", error: null, item });
});

app.put("/items/:id", requireAuth, async (req, res) => {
  const itemId = Number(req.params.id);
  const item = await dbGet("SELECT * FROM items WHERE id=?", [itemId]);
  if (!item) return res.status(404).send("Item not found");
  if (!isSeller(req, item)) return res.status(403).send("Forbidden");
  if (item.status !== "available") return res.status(400).send("Cannot edit sold/ discarded item.");

  const {
    category_hashtag,
    brand_name,
    condition,
    features,
    product_name,
    description,
    shipping_fee_payer,
    shipping_method,
    days_to_ship,
    price_vnd,
    shipping_from_city,
  } = req.body;

  await dbRun(
    `UPDATE items SET
      brand_name=?, category_hashtag=?, condition=?, features=?, name=?, description=?,
      shipping_fee_payer=?, shipping_method=?, days_to_ship=?, price_vnd=?, shipping_from_city=?,
      updated_at=datetime('now')
     WHERE id=?`,
    [
      brand_name || "",
      category_hashtag.trim(),
      condition,
      features || "",
      product_name.trim(),
      description.trim(),
      shipping_fee_payer,
      shipping_method,
      days_to_ship,
      Number(price_vnd),
      shipping_from_city,
      itemId,
    ]
  );
  res.redirect(`/items/${itemId}`);
});

app.delete("/items/:id", requireAuth, async (req, res) => {
  const itemId = Number(req.params.id);
  const item = await dbGet("SELECT * FROM items WHERE id=?", [itemId]);
  if (!item) return res.status(404).send("Item not found");
  if (!isSeller(req, item)) return res.status(403).send("Forbidden");
  if (item.status !== "available") return res.status(400).send("Cannot discard sold item.");

  await dbRun("UPDATE items SET status='discarded', updated_at=datetime('now') WHERE id=?", [itemId]);
  res.redirect("/mypage?tab=selling");
});

// My page
app.get("/mypage", requireAuth, async (req, res) => {
  const tab = req.query.tab || "profile";

  const user = await dbGet("SELECT * FROM users WHERE id=?", [req.session.user.id]);

  const selling = await dbAll("SELECT * FROM items WHERE seller_id=? AND status!='discarded' ORDER BY created_at DESC", [
    req.session.user.id,
  ]);
  const soldItems = selling.filter((it) => it.status === "sold");
  const sellingAvail = selling.filter((it) => it.status === "available");

  // Attach thumbnail and (for sold items) the latest order_id so seller can open the transaction screen directly.
  for (const it of selling) {
    const img = await dbGet("SELECT file_path FROM item_images WHERE item_id=? ORDER BY sort_order ASC LIMIT 1", [it.id]);
    it.image = img ? img.file_path : "/public/item-placeholder.svg";

    if (it.status === "sold") {
      const o = await dbGet("SELECT id FROM orders WHERE item_id=? ORDER BY created_at DESC LIMIT 1", [it.id]);
      it.order_id = o ? o.id : null;
    }
  }

  const purchases = await dbAll(
    `SELECT orders.*, items.name as item_name, items.id as item_id
     FROM orders JOIN items ON items.id=orders.item_id
     WHERE orders.buyer_id=?
     ORDER BY orders.created_at DESC`,
    [req.session.user.id]
  );

  const interested = await dbAll(
    `SELECT items.*, users.username
     FROM interests JOIN items ON items.id=interests.item_id
     JOIN users ON users.id=items.seller_id
     WHERE interests.user_id=?
     ORDER BY interests.created_at DESC`,
    [req.session.user.id]
  );
  for (const it of interested) {
    const img = await dbGet("SELECT file_path FROM item_images WHERE item_id=? ORDER BY sort_order ASC LIMIT 1", [it.id]);
    it.image = img ? img.file_path : "/public/item-placeholder.svg";
  }

  res.render("mypage", {
    title: "My Page",
    tab,
    user,
    sellingAvail,
    soldItems,
    purchases,
    interested,
  });
});

// Update profile
app.post("/mypage/profile", requireAuth, upload.single("avatar"), async (req, res) => {
  const { name, tags } = req.body;
  let avatarUrl = null;
  if (req.file) avatarUrl = "/uploads/" + req.file.filename;

  await dbRun(
    `UPDATE users SET name=?, tags=?, avatar_url=COALESCE(?, avatar_url) WHERE id=?`,
    [name?.trim() || "", tags?.trim() || "", avatarUrl, req.session.user.id]
  );

  // refresh session display name
  const u = await dbGet("SELECT id, name, username FROM users WHERE id=?", [req.session.user.id]);
  req.session.user = { id: u.id, name: u.name, username: u.username };

  res.redirect("/mypage?tab=profile");
});

// Verification
app.post("/mypage/verify", requireAuth, upload.single("id_doc"), async (req, res) => {
  // For prototype: accept upload and mark verified
  await dbRun("UPDATE users SET verified=1 WHERE id=?", [req.session.user.id]);
  await createNotification(req.session.user.id, "Verification complete ✅", "Your identity has been verified.", "/mypage?tab=verify");
  res.redirect("/mypage?tab=verify");
});

// Transaction screen (buyer + seller)
app.get("/orders/:orderId/transaction", requireAuth, async (req, res) => {
  const orderId = Number(req.params.orderId);

  const order = await dbGet(
    `SELECT orders.*, items.name as item_name
     FROM orders JOIN items ON items.id=orders.item_id
     WHERE orders.id=?`,
    [orderId]
  );
  if (!order) return res.status(404).send("Order not found");

  const uid = Number(req.session.user.id);
  const isSellerView = Number(order.seller_id) === uid;
  const isBuyerView = Number(order.buyer_id) === uid;
  if (!isSellerView && !isBuyerView) return res.status(403).send("Forbidden");

  const shippingFlat = 20000;
  const shippingIncluded = Number(order.shipping_included) === 1;
  const serviceFee = Math.round(Number(order.price_vnd) * 0.05);
  const sellerProfit = Number(order.price_vnd) - serviceFee;
  const buyerTotal = Number(order.price_vnd) + (shippingIncluded ? 0 : shippingFlat);

  res.render("transaction", {
    title: "Transaction",
    order,
    isSeller: isSellerView,
    isBuyer: isBuyerView,
    shippingFlat,
    shippingIncluded,
    serviceFee,
    sellerProfit,
    buyerTotal,
  });
});

// Buyer confirms payment
app.post("/orders/:orderId/pay", requireAuth, async (req, res) => {
  const orderId = Number(req.params.orderId);
  const paymentMethod = String(req.body.payment_method || "").trim().toLowerCase();

  const order = await dbGet(
    `SELECT orders.*, items.name as item_name
     FROM orders JOIN items ON items.id=orders.item_id
     WHERE orders.id=?`,
    [orderId]
  );
  if (!order) return res.status(404).send("Order not found");
  if (Number(order.buyer_id) !== Number(req.session.user.id)) return res.status(403).send("Forbidden");
  if (order.status !== "awaiting_payment") return res.redirect(`/orders/${orderId}/transaction`);

  const allowed = new Set(["vnpay", "card", "momo"]);
  const pm = allowed.has(paymentMethod) ? paymentMethod : "vnpay";

  await dbRun(
    `UPDATE orders
     SET payment_method=?, status='awaiting_shipping_method', paid_at=datetime('now'), updated_at=datetime('now')
     WHERE id=?`,
    [pm, orderId]
  );

  // Seller gets notified to choose shipping method
  await createNotification(
    order.seller_id,
    "Item sold, traveler!",
    `Your item "${order.item_name}" has been purchased and paid. Please choose a shipping method.`,
    `/orders/${orderId}/transaction`
  );

  // Buyer thanks page
  res.redirect(`/orders/${orderId}/thanks`);
});

// Buyer thank-you page
app.get("/orders/:orderId/thanks", requireAuth, async (req, res) => {
  const orderId = Number(req.params.orderId);
  const order = await dbGet(
    `SELECT orders.*, items.name as item_name
     FROM orders JOIN items ON items.id=orders.item_id
     WHERE orders.id=?`,
    [orderId]
  );
  if (!order) return res.status(404).send("Order not found");
  if (Number(order.buyer_id) !== Number(req.session.user.id)) return res.status(403).send("Forbidden");
  res.render("transaction_thanks", { title: "Thank you", order });
});

// Seller chooses shipping method
app.post("/orders/:orderId/shipping-method", requireAuth, async (req, res) => {
  const orderId = Number(req.params.orderId);
  const shippingChoice = String(req.body.shipping_choice || "").trim().toLowerCase();

  const order = await dbGet(
    `SELECT orders.*, items.name as item_name
     FROM orders JOIN items ON items.id=orders.item_id
     WHERE orders.id=?`,
    [orderId]
  );
  if (!order) return res.status(404).send("Order not found");
  if (Number(order.seller_id) !== Number(req.session.user.id)) return res.status(403).send("Forbidden");
  if (order.status !== "awaiting_shipping_method") return res.redirect(`/orders/${orderId}/transaction`);

  const allowed = new Set(["tomatogo", "other", "meetup"]);
  const choice = allowed.has(shippingChoice) ? shippingChoice : "tomatogo";

  await dbRun(
    `UPDATE orders
     SET shipping_method_choice=?, status='awaiting_shipment', updated_at=datetime('now')
     WHERE id=?`,
    [choice, orderId]
  );

  await createNotification(
    order.buyer_id,
    "The ship for your item has been assigned!",
    `Seller chose shipping method: ${choice}. Waiting for shipment.`,
    `/orders/${orderId}/transaction`
  );

  res.redirect(`/orders/${orderId}/transaction`);
});

// Seller confirms shipped
app.post("/orders/:orderId/ship", requireAuth, async (req, res) => {
  const orderId = Number(req.params.orderId);
  const order = await dbGet(
    `SELECT orders.*, items.name as item_name
     FROM orders JOIN items ON items.id=orders.item_id
     WHERE orders.id=?`,
    [orderId]
  );
  if (!order) return res.status(404).send("Order not found");
  if (Number(order.seller_id) !== Number(req.session.user.id)) return res.status(403).send("Forbidden");
  if (order.status !== "awaiting_shipment") return res.redirect(`/orders/${orderId}/transaction`);

  await dbRun(
    "UPDATE orders SET status='shipped', shipped_at=datetime('now'), updated_at=datetime('now') WHERE id=?",
    [orderId]
  );

  // No interactive buttons in this notification
  await createNotification(
    order.buyer_id,
    "Your item is on the way, traveler!",
    "Look out for packages coming from the sky and confirm when it arrive.",
    null,
    { noActions: true, isRead: true }
  );

  res.redirect(`/orders/${orderId}/transaction`);
});

// Buyer confirms received
app.post("/orders/:orderId/receive", requireAuth, async (req, res) => {
  const orderId = Number(req.params.orderId);
  const order = await dbGet(
    `SELECT orders.*, items.name as item_name
     FROM orders JOIN items ON items.id=orders.item_id
     WHERE orders.id=?`,
    [orderId]
  );

  if (!order) return res.status(404).send("Order not found");
  if (Number(order.buyer_id) !== Number(req.session.user.id)) return res.status(403).send("Forbidden");
  if (order.status !== "shipped") return res.redirect(`/orders/${orderId}/transaction`);

  await dbRun(
    "UPDATE orders SET status='completed', received_at=datetime('now'), updated_at=datetime('now') WHERE id=?",
    [orderId]
  );

  // No interactive buttons in this notification
  await createNotification(
    order.seller_id,
    "Your item has arrived to its destination!",
    `Buyer confirmed received: "${order.item_name}".`,
    null,
    { noActions: true, isRead: true }
  );

  // go to thank-you page (NOT transaction)
  return res.redirect(`/orders/${orderId}/thanks`);
});

// ---- Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Tomalia running on http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});