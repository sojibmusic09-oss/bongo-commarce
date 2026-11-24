require('dotenv').config();
const http = require('node:http');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Load WhatsApp AI Bot Engine inside the same Node process
  try {
    require('./whatsapp-bot.js');
    console.log('✅ WhatsApp AI Bot Engine mounted.');
  } catch (err) {
    console.warn('⚠️ WhatsApp Bot mount warning:', err.message);
  }

  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  server.listen(port, hostname, () => {
    console.log(`✅ BongoCommerce SaaS + WhatsApp Bot running on http://${hostname}:${port}`);
  });
});
