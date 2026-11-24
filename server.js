/**
 * BongoCommerce SaaS - cPanel & VPS Production Server Entry
 * Supports Next.js App + Optional TechXZone WhatsApp/Gemini/Telegram Bot Module
 */
require('dotenv').config();
const http = require('node:http');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  server.listen(port, hostname, () => {
    console.log(`✅ BongoCommerce SaaS running on http://${hostname}:${port} (${dev ? 'dev' : 'prod'})`);

    // আপনার দেওয়া TechXZone WhatsApp + Gemini Bot মডিউল চালু করার ব্রিজ:
    // এটি চালু করতে .env এ ENABLE_WHATSAPP_BOT=true দিন এবং
    // আপনার বট কোডটি bot-engine.js নামে রাখুন ও প্রয়োজনীয় npm প্যাকেজ ইনস্টল করুন।
    if (String(process.env.ENABLE_WHATSAPP_BOT || 'false') === 'true') {
      try {
        require('./bot-engine.js');
        console.log('✅ TechXZone WhatsApp AI Bot Engine loaded alongside SaaS.');
      } catch (err) {
        console.warn('⚠️ WhatsApp Bot module not loaded:', err.message);
      }
    }
  });
});
