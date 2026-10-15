require('dotenv').config();
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Set SESSION_SECRET to a random secret of at least 32 characters in hosting environment variables.');
  process.exit(1);
}

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'loveconnect.sqlite');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  age_confirmed INTEGER NOT NULL DEFAULT 0,
  membership_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  payment_id TEXT UNIQUE,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);
const SQLiteStore = SQLiteStoreFactory(session);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.dirname(dbPath), concurrentDB: true }),
  name: 'loveconnect.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const razorpay = (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET)
  ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET }) : null;

function publicUser(row) {
  if (!row) return null;
  const active = row.membership_until && new Date(row.membership_until).getTime() > Date.now();
  return { id: row.id, name: row.name, email: row.email, membershipActive: Boolean(active), membershipUntil: row.membership_until || null };
}
function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
}
function requireAuth(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: 'Please log in first.' });
  next();
}
const genericLoginError = 'Email or password is incorrect.';

app.post('/api/auth/register', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Name must be 2–80 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be 8–128 characters.' });
    if (req.body?.ageConfirmed !== true) return res.status(400).json({ error: 'You must confirm that you are 18 or older.' });
    const passwordHash = await bcrypt.hash(password, 12);
    let info;
    try {
      info = db.prepare('INSERT INTO users (name, email, password_hash, age_confirmed) VALUES (?, ?, ?, 1)').run(name, email, passwordHash);
    } catch (e) {
      if (String(e.code).includes('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'An account with this email already exists.' });
      throw e;
    }
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Could not start session. Please try again.' });
      req.session.userId = Number(info.lastInsertRowid);
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'Could not save session.' });
        res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId)) });
      });
    });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ error: 'Account could not be created. Please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!row || !(await bcrypt.compare(password, row.password_hash))) return res.status(401).json({ error: genericLoginError });
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Could not start session. Please try again.' });
      req.session.userId = row.id;
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'Could not save session.' });
        res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)) });
      });
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});
app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(currentUser(req)) }));
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed.' });
    res.clearCookie('loveconnect.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true });
  });
});

app.post('/api/create-order', requireAuth, async (req, res) => {
  try {
    if (!razorpay) return res.status(503).json({ error: 'Razorpay Live/Test keys are not configured on the server.' });
    const order = await razorpay.orders.create({
      amount: 29900, currency: 'INR', receipt: 'lc_' + Date.now(),
      notes: { product: 'LoveConnect 6 Months Membership', user_id: String(req.session.userId) }
    });
    db.prepare('INSERT INTO payments (user_id, order_id, amount, status) VALUES (?, ?, ?, ?)').run(req.session.userId, order.id, order.amount, 'created');
    res.json({ id: order.id, amount: order.amount, currency: order.currency, keyId: RAZORPAY_KEY_ID });
  } catch (err) {
    console.error('Create order failed:', err.message);
    res.status(500).json({ error: 'Razorpay order could not be created. Check hosting keys and Razorpay account activation.' });
  }
});

app.post('/api/verify-payment', requireAuth, (req, res) => {
  try {
    if (!RAZORPAY_KEY_SECRET) return res.status(503).json({ verified: false, error: 'Razorpay server keys are not configured.' });
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return res.status(400).json({ verified: false, error: 'Payment response is incomplete.' });
    const payment = db.prepare('SELECT * FROM payments WHERE order_id = ? AND user_id = ?').get(razorpay_order_id, req.session.userId);
    if (!payment) return res.status(400).json({ verified: false, error: 'Order does not belong to this account.' });
    const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(razorpay_signature, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
      return res.status(400).json({ verified: false, error: 'Payment signature verification failed.' });
    const existing = db.prepare('SELECT * FROM payments WHERE payment_id = ?').get(razorpay_payment_id);
    if (existing && existing.user_id !== req.session.userId)
      return res.status(409).json({ verified: false, error: 'Payment is already linked to another account.' });
    const until = new Date(Date.now());
    until.setMonth(until.getMonth() + 6);
    db.prepare('UPDATE payments SET payment_id = ?, status = ? WHERE order_id = ?').run(razorpay_payment_id, 'verified', razorpay_order_id);
    db.prepare('UPDATE users SET membership_until = ? WHERE id = ?').run(until.toISOString(), req.session.userId);
    res.json({ verified: true, paymentId: razorpay_payment_id, user: publicUser(currentUser(req)) });
  } catch (err) {
    console.error('Verification error:', err.message);
    res.status(500).json({ verified: false, error: 'Payment verification failed.' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`LoveConnect server listening on port ${PORT}`));
