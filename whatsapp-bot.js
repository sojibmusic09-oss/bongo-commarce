/**
 * BongoCommerce WhatsApp AI Bot Engine (Integrated with Neon PostgreSQL)
 * Multi-Device (3 Slots) | Gemini Multi-Key Rotation | Voice & Image AI | Telegram Alerts
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const axios = require('axios');
const pino = require('pino');
const QRCode = require('qrcode');
const { Pool } = require('pg');
const { GoogleGenAI } = require('@google/genai');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  makeCacheableSignalKeyStore,
  delay,
  Browsers,
} = require('@whiskeysockets/baileys');

const STORAGE_DIR = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_PATH || './storage', 'whatsapp');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const BOT_CONFIG_FILE = path.join(STORAGE_DIR, 'bot_config.json');
const CUSTOMERS_DB_FILE = path.join(STORAGE_DIR, 'customers_list.json');

let botConfig = {
  adminPhone: process.env.ADMIN_PHONE || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  siteBaseUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  selectedStoreSlug: process.env.WA_DEFAULT_STORE_SLUG || '',
};

try {
  if (fs.existsSync(BOT_CONFIG_FILE)) {
    botConfig = { ...botConfig, ...JSON.parse(fs.readFileSync(BOT_CONFIG_FILE, 'utf8')) };
  }
} catch {}

function saveBotConfig() {
  try {
    fs.writeFileSync(BOT_CONFIG_FILE, JSON.stringify(botConfig, null, 2), 'utf8');
  } catch {}
}

function getCleanAdminPhone() {
  let clean = String(botConfig.adminPhone || '').replace(/[^0-9]/g, '');
  if (clean.startsWith('01') && clean.length === 11) clean = '88' + clean;
  return clean;
}

// ================= GEMINI MULTI-KEY ENGINE =================
let geminiApiKeys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(/[\n,]+/)
  .map((k) => k.trim())
  .filter((k) => /^[\x20-\x7E]+$/.test(k) && k.length > 20);

let currentApiKeyIndex = 0;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS || 'gemini-2.0-flash,gemini-2.5-flash-lite'
)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const tokenStats = {
  totalTokensUsed: 0,
  requestsToday: 0,
  todayDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }),
};

function trackTokenUsage(tokens = 0) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  if (tokenStats.todayDate !== today) {
    tokenStats.totalTokensUsed = 0;
    tokenStats.requestsToday = 0;
    tokenStats.todayDate = today;
  }
  tokenStats.totalTokensUsed += Number(tokens) || 0;
  tokenStats.requestsToday += 1;
}

function getActiveGenAIClient() {
  if (geminiApiKeys.length === 0) return null;
  return new GoogleGenAI({ apiKey: geminiApiKeys[currentApiKeyIndex % geminiApiKeys.length] });
}

function rotateToNextApiKey() {
  if (geminiApiKeys.length > 1) {
    currentApiKeyIndex = (currentApiKeyIndex + 1) % geminiApiKeys.length;
    addLog('info', `Switched to Gemini API Key #${currentApiKeyIndex + 1}`);
  }
}

// ================= LOGGING & CUSTOMERS =================
const globalState = {
  catalogCount: 0,
  catalogLastUpdated: null,
  activeAiModel: GEMINI_MODEL,
  recentLogs: [],
};

function addLog(level, message, deviceId = null) {
  const time = new Date().toISOString().substring(11, 19);
  const msg = `${deviceId ? `[Dev ${deviceId}] ` : ''}${message}`;
  globalState.recentLogs.unshift({ time, level, message: msg });
  if (globalState.recentLogs.length > 100) globalState.recentLogs.pop();
  console.log(`[WA-BOT ${time}] [${level.toUpperCase()}] ${msg}`);
}

let previousCustomers = new Set();
try {
  if (fs.existsSync(CUSTOMERS_DB_FILE)) {
    const arr = JSON.parse(fs.readFileSync(CUSTOMERS_DB_FILE, 'utf8'));
    if (Array.isArray(arr)) previousCustomers = new Set(arr);
  }
} catch {}

function saveCustomerContact(phone) {
  const clean = String(phone).replace(/[^0-9]/g, '');
  if (clean.length >= 10 && !previousCustomers.has(clean)) {
    previousCustomers.add(clean);
    try {
      fs.writeFileSync(CUSTOMERS_DB_FILE, JSON.stringify(Array.from(previousCustomers), null, 2));
    } catch {}
  }
}

const chatHistories = new Map();
function getCustomerHistory(phone) {
  if (!chatHistories.has(phone)) chatHistories.set(phone, []);
  return chatHistories.get(phone);
}
function addCustomerHistory(phone, role, text) {
  const h = getCustomerHistory(phone);
  h.push({ role, text, time: Date.now() });
  if (h.length > 8) h.shift();
}

// ================= DATABASE POOL (NEON POSTGRES) =================
let pgPool = null;
function getPgPool() {
  if (!pgPool && process.env.DB_HOST) {
    pgPool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'bongo-commarce',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: String(process.env.DB_SSL || 'false') === 'true' ? { rejectUnauthorized: false } : false,
      max: 5,
    });
  }
  return pgPool;
}

let cachedCatalog = [];
async function refreshProductCatalog() {
  const pool = getPgPool();
  if (!pool) return;
  try {
    const baseUrl = (process.env.APP_URL || botConfig.siteBaseUrl || 'http://localhost:3000').replace(/\/+$/, '');
    const res = await pool.query(
      `SELECT p.id, p.store_id, p.name, p.slug, p.price, p.stock, p.images_json, p.description, s.slug AS store_slug, s.name AS store_name
       FROM products p JOIN stores s ON s.id = p.store_id
       WHERE p.is_active = TRUE AND s.status = 'ACTIVE'
       ORDER BY p.created_at DESC LIMIT 200`
    );
    cachedCatalog = res.rows.map((p) => {
      let img = '';
      try {
        const imgs = JSON.parse(p.images_json || '[]');
        if (imgs[0]) img = imgs[0];
      } catch {}
      return {
        id: p.id,
        store_id: p.store_id,
        store_slug: p.store_slug,
        store_name: p.store_name,
        name: String(p.name || '').trim(),
        price: parseFloat(p.price || 0),
        in_stock: Number(p.stock || 0) > 0,
        buy_link: `${baseUrl}/${p.store_slug}/${p.slug}`,
        image: img,
        description: String(p.description || '').replace(/<[^>]+>/g, ' ').trim(),
      };
    });
    globalState.catalogCount = cachedCatalog.length;
    globalState.catalogLastUpdated = new Date().toLocaleTimeString('bn-BD', { timeZone: 'Asia/Dhaka' });
  } catch (err) {
    addLog('warn', `Catalog sync skipped: ${err.message}`);
  }
}

setTimeout(() => {
  refreshProductCatalog();
  setInterval(refreshProductCatalog, 300_000);
}, 4000);

// ================= TELEGRAM & ORDER CREATION =================
async function sendTelegramAlert(messageText) {
  if (!botConfig.telegramBotToken || !botConfig.telegramChatId) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${botConfig.telegramBotToken}/sendMessage`,
      { chat_id: botConfig.telegramChatId, text: messageText, parse_mode: 'HTML' },
      { timeout: 8000 }
    );
    addLog('info', '✅ Telegram Order Alert Sent');
  } catch (err) {
    addLog('warn', `Telegram Error: ${err.message}`);
  }
}

async function createWebsiteOrder(orderInfo, activeSocket = null) {
  const pool = getPgPool();
  if (!pool) return { success: false };
  try {
    const prod = cachedCatalog.find((p) => String(p.id) === String(orderInfo.product_id)) || cachedCatalog[0];
    if (!prod) return { success: false };

    const orderId = crypto.randomUUID();
    const orderNumber = `WA-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
    const isDhaka = Boolean(
      orderInfo.address && (orderInfo.address.toLowerCase().includes('dhaka') || orderInfo.address.includes('ঢাকা'))
    );
    const courierFee = isDhaka ? 70 : 130;
    const qty = Math.max(1, Number(orderInfo.qty || 1));
    const subtotal = Number(prod.price) * qty;
    const grandTotal = subtotal + courierFee;
    const custPhone = String(orderInfo.phone || '').replace(/[^0-9]/g, '');

    await pool.query(
      `INSERT INTO orders (id, store_id, order_number, customer_name, customer_email, customer_phone, shipping_address, subtotal, discount_amount, shipping_fee, total_amount, currency, status, payment_status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0.00, $9, $10, 'BDT', 'PENDING', 'PENDING', 'WhatsApp AI Bot Order')`,
      [
        orderId,
        prod.store_id,
        orderNumber,
        orderInfo.name || 'WhatsApp Customer',
        `${custPhone || 'customer'}@whatsapp.local`,
        custPhone || '01700000000',
        orderInfo.address || 'Bangladesh',
        subtotal.toFixed(2),
        courierFee.toFixed(2),
        grandTotal.toFixed(2),
      ]
    );

    await pool.query(
      `INSERT INTO order_items (id, order_id, store_id, product_id, product_name, unit_price, quantity, line_total, is_digital)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)`,
      [
        crypto.randomUUID(),
        orderId,
        prod.store_id,
        prod.id,
        prod.name,
        prod.price.toFixed(2),
        qty,
        subtotal.toFixed(2),
      ]
    );

    await pool.query(
      `INSERT INTO payments (id, purpose, store_id, order_id, method, gateway, amount, currency, status, idempotency_key)
       VALUES ($1, 'STORE_ORDER', $2, $3, 'CASH_ON_DELIVERY', 'cod', $4, 'BDT', 'PENDING', $5)`,
      [crypto.randomUUID(), prod.store_id, orderId, grandTotal.toFixed(2), `wa_${orderId}`]
    );

    const sendSock = activeSocket || getAnyConnectedSocket();
    const adminPhone = getCleanAdminPhone();
    if (sendSock && adminPhone) {
      const adminMsg = `🚨 *নতুন WhatsApp অর্ডার!*\n🆔 #${orderNumber}\n📦 ${prod.name}\n👤 ${orderInfo.name}\n📞 ${custPhone}\n📍 ${orderInfo.address}\n💰 মোট বিল: ৳${grandTotal}`;
      sendSock.sendMessage(`${adminPhone}@s.whatsapp.net`, { text: adminMsg }).catch(() => {});
    }

    sendTelegramAlert(
      `🚨 <b>নতুন অর্ডার কনফার্ম (WhatsApp Bot)!</b>\n🆔 <b>#${orderNumber}</b>\n📦 ${prod.name}\n👤 ${orderInfo.name}\n📞 ${custPhone}\n📍 ${orderInfo.address}\n💰 মোট: ৳${grandTotal}`
    );

    return { success: true, orderId: orderNumber, grandTotal };
  } catch (err) {
    addLog('error', `Order DB Save Error: ${err.message}`);
    return { success: false };
  }
}

// ================= AI ENGINE =================
async function transcribeAudioWithGemini(audioBuffer, mimeType = 'audio/ogg') {
  if (geminiApiKeys.length === 0) return '';
  const cleanMime = (mimeType || 'audio/ogg').split(';')[0].trim();
  const audioPart = { inlineData: { data: audioBuffer.toString('base64'), mimeType: cleanMime } };
  const prompt = 'এই ভয়েস মেসেজে গ্রাহক কী বলেছেন তা হুবহু বাংলায় বা ইংরেজিতে শুধু টেক্সট আকারে লিখুন।';

  for (let i = 0; i < geminiApiKeys.length; i++) {
    const client = getActiveGenAIClient();
    if (!client) break;
    for (const modelId of [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS]) {
      try {
        const res = await client.models.generateContent({
          model: modelId,
          contents: [audioPart, prompt],
          config: { temperature: 0.1, maxOutputTokens: 200 },
        });
        trackTokenUsage(res.usageMetadata?.totalTokenCount || 0);
        const txt = res.text?.trim();
        if (txt) return txt;
      } catch {}
    }
    rotateToNextApiKey();
  }
  return '';
}

async function callGeminiUltraFast(prompt, systemInstruction, imageBuffer = null, imageMime = 'image/jpeg', deviceId = null) {
  if (geminiApiKeys.length === 0) throw new Error('GEMINI_API_KEY Missing');
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
  const contents = [];
  if (imageBuffer) {
    contents.push({ inlineData: { data: imageBuffer.toString('base64'), mimeType: imageMime.split(';')[0].trim() } });
  }
  contents.push(prompt);

  for (let attempt = 0; attempt < Math.min(geminiApiKeys.length, 2); attempt++) {
    const client = getActiveGenAIClient();
    if (!client) break;
    for (const modelId of models) {
      try {
        const start = Date.now();
        const res = await client.models.generateContent({
          model: modelId,
          contents,
          config: { systemInstruction, temperature: 0.35, maxOutputTokens: 1000 },
        });
        const text = res.text?.trim();
        if (text) {
          const usedTokens = res.usageMetadata?.totalTokenCount || 0;
          trackTokenUsage(usedTokens);
          addLog('info', `⚡ AI Replied in ${Date.now() - start}ms [${modelId}]`, deviceId);
          return text;
        }
      } catch (err) {
        if (String(err.message).includes('429') || String(err.message).includes('RESOURCE_EXHAUSTED')) {
          rotateToNextApiKey();
          break;
        }
      }
    }
  }
  throw new Error('All AI models busy');
}

async function handleCustomerIncomingMessage(phone, text, activeSocket = null, imageBuffer = null, imageMime = null, deviceId = null) {
  const cleanInput = (text || '').trim();
  const history = getCustomerHistory(phone);
  let cleanUserPhone = phone.replace(/@.*$/, '').replace(/[^0-9]/g, '');
  if (cleanUserPhone.startsWith('880')) cleanUserPhone = '0' + cleanUserPhone.slice(3);

  const catalogContext =
    cachedCatalog.length > 0
      ? cachedCatalog
          .slice(0, 20)
          .map((p) => `• [ID:${p.id}] ${p.name} | মূল্য: ৳${p.price} | স্টক: ${p.in_stock ? 'আছে' : 'শেষ'} | লিংক: ${p.buy_link}`)
          .join('\n')
      : 'এখনো কোনো প্রোডাক্ট যোগ করা হয়নি।';

  const historyText = history.map((h) => `${h.role === 'user' ? 'গ্রাহক' : 'অ্যাসিস্ট্যান্ট'}: ${h.text}`).join('\n');

  const systemPrompt = `তুমি আমাদের অনলাইন শপের একজন ভদ্র ও চটপটে বাংলা সেলস অ্যাসিস্ট্যান্ট। কাস্টমারকে "ভাইয়া" বলে সম্বোধন করবে। বোল্ড করতে সিঙ্গেল স্টার (*) ব্যবহার করবে।
ডেলিভারি চার্জ: ঢাকার ভেতরে ৳৭০, বাইরে ৳১৩০ (ক্যাশ অন ডেলিভারি)।
কাস্টমার অর্ডার করতে চাইলে নাম, মোবাইল, সম্পূর্ণ ঠিকানা চাইবে। সব দিলে একদম শেষে এই ট্যাগটি দেবে:
[[ORDER:{"product_id":"ID","product_name":"নাম","price":দাম,"qty":1,"name":"নাম","phone":"${cleanUserPhone}","address":"ঠিকানা"}]]

পূর্ববর্তী চ্যাট:\n${historyText}\n\nআমাদের পণ্যসমূহ:\n${catalogContext}`;

  try {
    let reply = await callGeminiUltraFast(
      imageBuffer ? `ছবি পাঠিয়েছে এবং লিখেছে: "${cleanInput}"` : `গ্রাহক: "${cleanInput}"`,
      systemPrompt,
      imageBuffer,
      imageMime,
      deviceId
    );
    reply = reply.replace(/\*\*/g, '*');

    const orderMatch = reply.match(/\[\[ORDER:(.*?)\]\]/);
    if (orderMatch && orderMatch[1]) {
      try {
        const orderData = JSON.parse(orderMatch[1]);
        if (!orderData.phone) orderData.phone = cleanUserPhone;
        const orderRes = await createWebsiteOrder(orderData, activeSocket);
        if (orderRes.success) {
          reply =
            reply.replace(/\[\[ORDER:(.*?)\]\]/, '') +
            `\n\n🎉 *আপনার অর্ডার কনফার্ম হয়েছে!*\n🆔 অর্ডার আইডি: #${orderRes.orderId}\n💰 মোট বিল: ৳${orderRes.grandTotal} (Cash on Delivery)`;
        } else {
          reply = reply.replace(/\[\[ORDER:(.*?)\]\]/, '');
        }
      } catch {
        reply = reply.replace(/\[\[ORDER:(.*?)\]\]/, '');
      }
    }

    addCustomerHistory(phone, 'user', cleanInput || 'ছবি');
    addCustomerHistory(phone, 'assistant', reply);
    return reply;
  } catch {
    return 'জি ভাইয়া! অনুগ্রহ করে কোন পণ্যটি দেখতে চাচ্ছেন জানাবেন? আমি এখনই দাম ও লিংক দিচ্ছি।';
  }
}

// ================= 3-DEVICE BAILEYS ENGINE =================
const devices = {
  1: { id: 1, sessionDir: path.join(STORAGE_DIR, 'auth_1'), sock: null, reconnectTimeout: null, state: { waConnected: false, waConnecting: false, qrCodeDataUrl: null, pairingCode: null, pairingPhone: null } },
  2: { id: 2, sessionDir: path.join(STORAGE_DIR, 'auth_2'), sock: null, reconnectTimeout: null, state: { waConnected: false, waConnecting: false, qrCodeDataUrl: null, pairingCode: null, pairingPhone: null } },
  3: { id: 3, sessionDir: path.join(STORAGE_DIR, 'auth_3'), sock: null, reconnectTimeout: null, state: { waConnected: false, waConnecting: false, qrCodeDataUrl: null, pairingCode: null, pairingPhone: null } },
};
for (const d of Object.values(devices)) fs.mkdirSync(d.sessionDir, { recursive: true });

function getAnyConnectedSocket() {
  for (const d of Object.values(devices)) {
    if (d.sock && d.state.waConnected) return d.sock;
  }
  return null;
}

async function startWhatsAppBot(deviceId = 1) {
  const d = devices[deviceId];
  if (!d || d.state.waConnecting || d.state.waConnected) return;
  d.state.waConnecting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(d.sessionDir);
    const { version } = await fetchLatestBaileysVersion();
    const waLogger = pino({ level: 'silent' });

    d.sock = makeWASocket({
      version,
      logger: waLogger,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, waLogger) },
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });

    d.sock.ev.on('creds.update', saveCreds);

    d.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) QRCode.toDataURL(qr).then((u) => (d.state.qrCodeDataUrl = u)).catch(() => {});

      if (connection === 'close') {
        d.state.waConnected = false;
        d.state.waConnecting = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        addLog('warn', `Disconnected (${code})`, deviceId);
        if (code === DisconnectReason.loggedOut) {
          fs.rmSync(d.sessionDir, { recursive: true, force: true });
          fs.mkdirSync(d.sessionDir, { recursive: true });
          return;
        }
        clearTimeout(d.reconnectTimeout);
        d.reconnectTimeout = setTimeout(() => startWhatsAppBot(deviceId), 6000);
      } else if (connection === 'open') {
        d.state.waConnected = true;
        d.state.waConnecting = false;
        d.state.qrCodeDataUrl = null;
        d.state.pairingCode = null;
        addLog('info', `✅ Device #${deviceId} Connected!`, deviceId);
      }
    });

    d.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          if (!msg.message || msg.key.fromMe) continue;
          const sender = msg.key.remoteJid;
          if (!sender || sender.includes('@g.us') || sender === 'status@broadcast') continue;
          saveCustomerContact(sender);

          const m = msg.message.ephemeralMessage?.message || msg.message.viewOnceMessage?.message || msg.message;
          let text = (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || '').trim();
          let imageBuffer = null;
          let imageMime = 'image/jpeg';

          if (m.imageMessage) {
            imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: waLogger });
            imageMime = m.imageMessage.mimetype || 'image/jpeg';
          } else if (m.audioMessage) {
            const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: waLogger });
            text = await transcribeAudioWithGemini(buf, m.audioMessage.mimetype || 'audio/ogg');
          }

          if (!text && !imageBuffer) continue;
          await refreshProductCatalog();
          const reply = await handleCustomerIncomingMessage(sender, text, d.sock, imageBuffer, imageMime, deviceId);
          await d.sock.sendMessage(sender, { text: reply });
        } catch (err) {
          addLog('error', `Msg error: ${err.message}`, deviceId);
        }
      }
    });
  } catch (err) {
    d.state.waConnecting = false;
    addLog('error', `Start error: ${err.message}`, deviceId);
  }
}

async function requestPairingCode(deviceId, phoneInput) {
  const d = devices[deviceId] || devices[1];
  let clean = String(phoneInput || '').replace(/[^0-9]/g, '');
  if (clean.startsWith('01') && clean.length === 11) clean = '88' + clean;
  if (clean.length < 12) throw new Error('সঠিক মোবাইল নম্বর দিন (যেমন: 017...)');

  if (!d.state.waConnected) {
    fs.rmSync(d.sessionDir, { recursive: true, force: true });
    fs.mkdirSync(d.sessionDir, { recursive: true });
    d.sock = null;
    d.state.waConnecting = false;
    await startWhatsAppBot(d.id);
    await delay(2500);
  }
  if (!d.sock || d.sock.authState.creds.registered) {
    throw new Error(`Device #${d.id} ইতিমধ্যে কানেক্টেড আছে বা প্রস্তুত নয়।`);
  }
  const code = await d.sock.requestPairingCode(clean);
  d.state.pairingCode = code;
  d.state.pairingPhone = clean;
  addLog('info', `Pairing Code generated: ${code}`, d.id);
  return code;
}

async function logoutDevice(deviceId = 1) {
  const d = devices[deviceId];
  if (!d) return;
  clearTimeout(d.reconnectTimeout);
  try { if (d.sock) await d.sock.logout(); } catch {}
  d.sock = null;
  d.state = { waConnected: false, waConnecting: false, qrCodeDataUrl: null, pairingCode: null, pairingPhone: null };
  fs.rmSync(d.sessionDir, { recursive: true, force: true });
  fs.mkdirSync(d.sessionDir, { recursive: true });
  addLog('info', `Device #${deviceId} logged out`, deviceId);
}

// Register global bridge for Next.js API routes
globalThis.__bongoWaBot = {
  getStatus(deviceId = 1) {
    const d = devices[deviceId] || devices[1];
    return {
      waConnected: d.state.waConnected,
      waConnecting: d.state.waConnecting,
      qrCode: d.state.qrCodeDataUrl,
      pairingCode: d.state.pairingCode,
      pairingPhone: d.state.pairingPhone,
      catalogCount: globalState.catalogCount,
      catalogLastUpdated: globalState.catalogLastUpdated,
      recentLogs: globalState.recentLogs.slice(0, 40),
      activeAiModel: GEMINI_MODEL,
      apiKeysCount: geminiApiKeys.length,
      adminPhone: getCleanAdminPhone(),
      telegramConfigured: Boolean(botConfig.telegramBotToken && botConfig.telegramChatId),
      savedCustomersCount: previousCustomers.size,
      tokenUsage: tokenStats,
      devices: [1, 2, 3].map((id) => ({
        id,
        connected: devices[id].state.waConnected,
        connecting: devices[id].state.waConnecting,
        pairingCode: devices[id].state.pairingCode,
      })),
    };
  },
  requestPairingCode,
  logoutDevice,
  async hardReset(deviceId = 1) {
    await logoutDevice(deviceId);
    setTimeout(() => startWhatsAppBot(deviceId), 1500);
  },
  setApiKeys(rawKeys) {
    const list = String(rawKeys || '')
      .split(/[\n,]+/)
      .map((k) => k.trim())
      .filter((k) => /^[\x20-\x7E]+$/.test(k) && k.length > 20);
    if (list.length === 0) throw new Error('কমপক্ষে ১টি সঠিক Gemini API Key দিন');
    geminiApiKeys = list;
    currentApiKeyIndex = 0;
    return { totalKeys: geminiApiKeys.length };
  },
  saveConfig({ adminPhone, telegramBotToken, telegramChatId }) {
    if (adminPhone !== undefined) botConfig.adminPhone = adminPhone;
    if (telegramBotToken !== undefined) botConfig.telegramBotToken = telegramBotToken;
    if (telegramChatId !== undefined) botConfig.telegramChatId = telegramChatId;
    saveBotConfig();
    return botConfig;
  },
  async testTelegram() {
    if (!botConfig.telegramBotToken || !botConfig.telegramChatId) {
      throw new Error('Telegram Token ও Chat ID আগে সেভ করুন');
    }
    await sendTelegramAlert('✅ <b>BongoCommerce WhatsApp Bot Telegram Test Successful!</b>');
  },
  async broadcast(message, imageUrl) {
    const sock = getAnyConnectedSocket();
    if (!sock) throw new Error('কোনো WhatsApp ডিভাইস কানেক্টেড নেই');
    const targets = Array.from(previousCustomers);
    for (const phone of targets) {
      const clean = phone.startsWith('01') ? `88${phone}` : phone;
      if (imageUrl) await sock.sendMessage(`${clean}@s.whatsapp.net`, { image: { url: imageUrl }, caption: message || '' }).catch(() => {});
      else await sock.sendMessage(`${clean}@s.whatsapp.net`, { text: message }).catch(() => {});
      await delay(1200);
    }
    return { totalRecipients: targets.length };
  },
  async testChat(message) {
    await refreshProductCatalog();
    return handleCustomerIncomingMessage('web_test', message);
  },
};

// Auto-resume existing sessions if creds exist
for (const id of [1, 2, 3]) {
  if (fs.existsSync(path.join(devices[id].sessionDir, 'creds.json'))) {
    startWhatsAppBot(id);
  }
}

module.exports = globalThis.__bongoWaBot;
