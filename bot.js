const BOT_TOKEN = "8867098071:AAHGl0bPQTYbFeUnHlBBememsQsY1_xh_O4";
const SB_URL = "https://aqhnkuesjrcupsipnlub.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaG5rdWVzanJjdXBzaXBubHViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MDQ4NDEsImV4cCI6MjA5NjM4MDg0MX0.p2jhgfASmshEwjxNpqGmGrY04tpitE_b1ijs7Pey1sg";

const https = require("https");
const http = require("http");

// ─── Supabase ───────────────────────────────────────────────
function sbRequest(table, method, body, params = "") {
  return new Promise((resolve, reject) => {
    const path = `/rest/v1/${table}${params}`;
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: "aqhnkuesjrcupsipnlub.supabase.co",
      path, method,
      headers: {
        "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        ...(method === "POST" ? { "Prefer": "return=representation" } : {}),
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {})
      }
    }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Telegram ───────────────────────────────────────────────
function tgSend(chatId, text) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" });
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve()); });
    req.on("error", () => resolve());
    req.write(data); req.end();
  });
}

function tgGetUpdates(offset) {
  return new Promise((resolve) => {
    const path = `/bot${BOT_TOKEN}/getUpdates?timeout=25&offset=${offset}`;
    const req = https.request({ hostname: "api.telegram.org", path, method: "GET" }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false, result: [] }); } });
    });
    req.on("error", () => resolve({ ok: false, result: [] }));
    req.end();
  });
}

// ─── Parser ─────────────────────────────────────────────────
function parseTransaction(text) {
  const amountMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(usdt|usdc|usd|uah|грн|гривень|доларів|баксів|\$|€|євро|eur)/i);
  if (!amountMatch) return null;

  const isIncome = /отримали|отримав|зайшло|надійшло|прийшло|заплатив клієнт|від клієнта|received/i.test(text);
  const isExpense = /заплатили|витратили|відправили|переказали|витратив|spent|paid/i.test(text);
  if (!isIncome && !isExpense) return null;

  const amount = parseFloat(amountMatch[1].replace(",", "."));
  const rawCur = amountMatch[2].toLowerCase();
  const currency = rawCur.includes("uah") || rawCur.includes("грн") || rawCur.includes("гривень") ? "UAH"
    : rawCur.includes("eur") || rawCur.includes("євро") || rawCur === "€" ? "EUR" : "USD";

  const category =
    /payroll|зарплат|vitaliy|natalie|plafon|illia|sonya|lera|nastya/i.test(text) ? "Payroll" :
    /facebook|ads|реклам|таргет/i.test(text) ? "Facebook Ads" :
    /автор|author|баскак|лобод|суров/i.test(text) ? "Author Payment" :
    /keycrm|chatgpt|server|hosting|google|domain/i.test(text) ? "Subscriptions" :
    isIncome ? "Song Sale" : "Other";

  return {
    date: new Date().toISOString().slice(0, 10),
    amount, currency,
    type: isIncome ? "income" : "expense",
    category,
    account: currency === "UAH" ? "Mono Katrine" : /крипт|usdt|usdc/i.test(text) ? "Katrine Binance" : "Buffer USD",
    project: "ninja_music",
    comment: text.slice(0, 200),
    module: "business"
  };
}

// ─── Message Handler ────────────────────────────────────────
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const from = msg.from?.first_name || "?";
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

  console.log(`[${msg.chat.type}] ${from}: ${text}`);

  // In group — only react to financial messages or commands
  if (isGroup && !text.startsWith("/")) {
    const hasFinancial = /отримали|отримав|заплатили|витратили|зайшло|надійшло|відправили|переказали|\$|usdt|usdc|грн|uah/i.test(text);
    if (!hasFinancial) return;
  }

  // /start /help
  if (text === "/start" || text === "/help") {
    await tgSend(chatId,
      `🟢 <b>ORACUL активний</b>\n\n` +
      `Пишіть природньо:\n` +
      `• <i>отримали $2500 від Дарії за пісню</i>\n` +
      `• <i>заплатили Vitaliy 32000 грн</i>\n` +
      `• <i>Facebook ads 237 доларів</i>\n\n` +
      `Команди:\n` +
      `/status — стан фінансів\n` +
      `/payroll — виплати команді\n` +
      `/deals — відкриті угоди`
    );
    return;
  }

  // /status
  if (text === "/status") {
    try {
      const txs = await sbRequest("transactions", "GET", null, "?select=*&limit=500");
      const arr = Array.isArray(txs) ? txs : [];
      const incUSD = arr.filter(t => t.type === "income" && t.currency === "USD").reduce((s, t) => s + Number(t.amount), 0);
      const expUSD = arr.filter(t => t.type === "expense" && t.currency === "USD").reduce((s, t) => s + Number(t.amount), 0);
      const incUAH = arr.filter(t => t.type === "income" && t.currency === "UAH").reduce((s, t) => s + Number(t.amount), 0);
      const expUAH = arr.filter(t => t.type === "expense" && t.currency === "UAH").reduce((s, t) => s + Number(t.amount), 0);
      await tgSend(chatId,
        `📊 <b>ORACUL — Стан фінансів</b>\n\n` +
        `💵 USD: +$${incUSD.toFixed(0)} / -$${expUSD.toFixed(0)} = <b>$${(incUSD - expUSD).toFixed(0)}</b>\n` +
        `🇺🇦 UAH: +₴${incUAH.toFixed(0)} / -₴${expUAH.toFixed(0)} = <b>₴${(incUAH - expUAH).toFixed(0)}</b>\n\n` +
        `📝 Транзакцій в базі: ${arr.length}\n` +
        `📅 ${new Date().toLocaleDateString("uk-UA")}`
      );
    } catch(e) {
      await tgSend(chatId, "❌ Помилка бази даних");
    }
    return;
  }

  // /payroll
  if (text === "/payroll") {
    await tgSend(chatId,
      `👥 <b>Payroll цього місяця</b>\n\n` +
      `• Vitaliy — ₴30-32K (12-го, FOP)\n` +
      `• Natalie — $400-500+% (1-5)\n` +
      `• Lera+Sonya — ~$700 (1-5)\n` +
      `• Plafon — $587 (1 і 15)\n` +
      `• Illia — $200 + ₴8,500 (1-5)\n` +
      `• Nastya — ? (1 і 15)\n\n` +
      `💵 Разом: ~$1,737 + ₴40,500`
    );
    return;
  }

  // /deals
  if (text === "/deals") {
    try {
      const deals = await sbRequest("deals", "GET", null, "?select=*&status=eq.open&order=created_at.desc");
      const arr = Array.isArray(deals) ? deals : [];
      if (!arr.length) { await tgSend(chatId, "📋 Відкритих угод немає в базі"); return; }
      const list = arr.slice(0, 10).map(d => `• ${d.song_name} — $${d.price_usd} (нам $${d.profit_usd})`).join("\n");
      await tgSend(chatId, `📋 <b>Відкриті угоди (${arr.length})</b>\n\n${list}`);
    } catch(e) {
      await tgSend(chatId, "❌ Помилка");
    }
    return;
  }

  // Parse financial transaction
  const tx = parseTransaction(text);
  if (tx) {
    try {
      await sbRequest("transactions", "POST", tx);
      const emoji = tx.type === "income" ? "✅" : "💸";
      const sign = tx.type === "income" ? "+" : "-";
      await tgSend(chatId,
        `${emoji} <b>Записано в ORACUL</b>\n\n` +
        `${sign}${tx.amount} ${tx.currency}\n` +
        `📁 ${tx.category}\n` +
        `🏦 ${tx.account}\n` +
        `👤 ${from}\n` +
        `📅 ${tx.date}`
      );
    } catch(e) {
      await tgSend(chatId, "❌ Не вдалось зберегти в базу");
    }
    return;
  }

  // Private chat fallback
  if (!isGroup) {
    await tgSend(chatId,
      `Не розпізнав транзакцію.\n\n` +
      `Приклади:\n` +
      `• отримали $2500 від клієнта\n` +
      `• заплатили 32000 грн Vitaliy\n` +
      `• Facebook ads 237 доларів\n\n` +
      `/status /payroll /deals`
    );
  }
}

// ─── Long Polling Loop ───────────────────────────────────────
let offset = 0;
async function poll() {
  try {
    const res = await tgGetUpdates(offset);
    if (res.ok && res.result.length) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
      }
    }
  } catch(e) {
    console.error("Poll error:", e.message);
    await new Promise(r => setTimeout(r, 5000));
  }
  setImmediate(poll);
}

// ─── Health check server ─────────────────────────────────────
http.createServer((req, res) => {
  res.writeHead(200);
  res.end(JSON.stringify({ status: "ok", bot: "ORACUL", uptime: process.uptime() }));
}).listen(process.env.PORT || 3000, () => {
  console.log("✅ ORACUL Bot started");
  console.log("🤖 Polling Telegram...");
  poll();
});
