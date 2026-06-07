const BOT_TOKEN = "8867098071:AAHGl0bPQTYbFeUnHlBBememsQsY1_xh_O4";
const SB_URL = "https://aqhnkuesjrcupsipnlub.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaG5rdWVzanJjdXBzaXBubHViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MDQ4NDEsImV4cCI6MjA5NjM4MDg0MX0.p2jhgfASmshEwjxNpqGmGrY04tpitE_b1ijs7Pey1sg";

const https = require("https");
const http = require("http");

// Pending confirmations: chatId -> { tx, messageId }
const pending = {};

// ─── Supabase ───────────────────────────────────────────────
function sbRequest(table, method, body, params = "") {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: "aqhnkuesjrcupsipnlub.supabase.co",
      path: `/rest/v1/${table}${params}`,
      method,
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
function tgRequest(method, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${BOT_TOKEN}/${method}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on("error", () => resolve({}));
    req.write(data); req.end();
  });
}

function tgSend(chatId, text, extra = {}) {
  return tgRequest("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

function tgGetUpdates(offset) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${BOT_TOKEN}/getUpdates?timeout=25&offset=${offset}`,
      method: "GET"
    }, res => {
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

  const isIncome = /отримали|отримав|зайшло|надійшло|прийшло|заплатив клієнт|від клієнта|received|income/i.test(text);
  const isExpense = /заплатили|витратили|відправили|переказали|витратив|spent|paid|expense/i.test(text);
  if (!isIncome && !isExpense) return null;

  const amount = parseFloat(amountMatch[1].replace(",", "."));
  const rawCur = amountMatch[2].toLowerCase();
  const currency = rawCur.includes("uah") || rawCur.includes("грн") || rawCur.includes("гривень") ? "UAH"
    : rawCur.includes("eur") || rawCur.includes("євро") || rawCur === "€" ? "EUR" : "USD";

  // Extract client name
  const clientMatch = text.match(/від\s+([А-ЯІЇЄA-Z][а-яіїєa-z]+(?:\s+[А-ЯІЇЄA-Z][а-яіїєa-z]+)?)/i);
  const client = clientMatch ? clientMatch[1] : null;

  // Extract song name
  const songMatch = text.match(/(?:пісн[юі]|за пісню|song)\s+[«"']?([^»"'\n,]+)[»"']?/i);
  const song = songMatch ? songMatch[1].trim() : null;

  // Payment method
  const paymentMethod = /крипт|crypto|usdt|usdc/i.test(text) ? "crypto"
    : /кеш|cash|готівк/i.test(text) ? "cash"
    : /карт|card|paypal/i.test(text) ? "card"
    : /фоп|fop/i.test(text) ? "fop" : null;

  const category =
    /payroll|зарплат|vitaliy|natalie|plafon|illia|sonya|lera|nastya/i.test(text) ? "Payroll" :
    /facebook|ads|реклам|таргет/i.test(text) ? "Facebook Ads" :
    /автор|author|баскак|лобод|суров|ноунейм/i.test(text) ? "Author Payment" :
    /keycrm|chatgpt|server|hosting|google|domain/i.test(text) ? "Subscriptions" :
    isIncome ? "Song Sale" : "Other";

  const account = paymentMethod === "crypto" ? "Katrine Binance"
    : currency === "UAH" ? "Mono Katrine"
    : "Buffer USD";

  return {
    tx: {
      date: new Date().toISOString().slice(0, 10),
      amount, currency,
      type: isIncome ? "income" : "expense",
      category, account,
      project: "ninja_music",
      comment: text.slice(0, 200),
      module: "business"
    },
    meta: { client, song, paymentMethod }
  };
}

// ─── Format confirmation message ────────────────────────────
function formatConfirm(tx, meta) {
  const sign = tx.type === "income" ? "+" : "-";
  const emoji = tx.type === "income" ? "💰" : "💸";
  
  let msg = `${emoji} <b>Зберегти транзакцію?</b>\n\n`;
  msg += `${sign}${tx.amount} ${tx.currency}\n`;
  msg += `📁 ${tx.category}\n`;
  msg += `🏦 ${tx.account}\n`;
  if (meta.client) msg += `👤 Клієнт: ${meta.client}\n`;
  if (meta.song) msg += `🎵 Пісня: ${meta.song}\n`;
  if (meta.paymentMethod) msg += `💳 Оплата: ${meta.paymentMethod}\n`;
  msg += `📅 ${tx.date}\n`;

  // Warn about missing info
  const missing = [];
  if (!meta.client && tx.type === "income") missing.push("клієнт");
  if (!meta.song && tx.type === "income" && tx.category === "Song Sale") missing.push("пісня");
  if (!meta.paymentMethod) missing.push("спосіб оплати");

  if (missing.length) {
    msg += `\n⚠️ <i>Не вказано: ${missing.join(", ")}</i>`;
  }

  return msg;
}

// ─── Message Handler ────────────────────────────────────────
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const from = msg.from?.first_name || "?";
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

  console.log(`[${msg.chat.type}] ${from}: ${text}`);

  // Check if answering a pending question
  if (pending[chatId]) {
    const p = pending[chatId];
    
    if (p.waitingFor === "client") {
      p.tx.comment = `${p.tx.comment} | клієнт: ${text}`;
      p.meta.client = text;
      
      if (!p.meta.song && p.tx.category === "Song Sale") {
        pending[chatId] = { ...p, waitingFor: "song" };
        await tgSend(chatId, `👤 Клієнт: <b>${text}</b>\n\nЯка пісня? (або напиши "пропустити")`);
        return;
      }
      
      // Save
      await saveTx(chatId, p.tx, p.meta, from);
      delete pending[chatId];
      return;
    }

    if (p.waitingFor === "song") {
      if (text.toLowerCase() !== "пропустити") {
        p.tx.comment = `${p.tx.comment} | пісня: ${text}`;
        p.meta.song = text;
      }
      await saveTx(chatId, p.tx, p.meta, from);
      delete pending[chatId];
      return;
    }

    if (p.waitingFor === "payment") {
      const method = text.toLowerCase();
      p.meta.paymentMethod = method;
      p.tx.account = method.includes("крипт") || method.includes("usdt") ? "Katrine Binance"
        : method.includes("кеш") || method.includes("cash") ? "Cash"
        : method.includes("фоп") ? "FOP Eugene"
        : "Mono Katrine";
      await saveTx(chatId, p.tx, p.meta, from);
      delete pending[chatId];
      return;
    }
  }

  // In group — only react to financial messages or commands
  if (isGroup && !text.startsWith("/")) {
    const hasFinancial = /отримали|отримав|заплатили|витратили|зайшло|надійшло|відправили|переказали|\$|usdt|usdc|грн|uah/i.test(text);
    if (!hasFinancial) return;
  }

  // Commands
  if (text === "/start" || text === "/help") {
    await tgSend(chatId,
      `🟢 <b>ORACUL активний</b>\n\n` +
      `Пишіть природньо:\n` +
      `• <i>отримали $2500 від Дарії за пісню Мрія, крипто</i>\n` +
      `• <i>заплатили Vitaliy 32000 грн</i>\n` +
      `• <i>Facebook ads 237 доларів</i>\n\n` +
      `Або коротко — бот сам уточнить деталі:\n` +
      `• <i>отримали $500</i> → бот спитає від кого і яка пісня\n\n` +
      `Команди:\n` +
      `/status — стан фінансів\n` +
      `/payroll — виплати команді\n` +
      `/deals — відкриті угоди\n` +
      `/clear — видалити тестові дані`
    );
    return;
  }

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
        `💵 USD: +$${incUSD.toFixed(0)} / -$${expUSD.toFixed(0)} = <b>$${(incUSD-expUSD).toFixed(0)}</b>\n` +
        `🇺🇦 UAH: +₴${incUAH.toFixed(0)} / -₴${expUAH.toFixed(0)} = <b>₴${(incUAH-expUAH).toFixed(0)}</b>\n\n` +
        `📝 Транзакцій в базі: <b>${arr.length}</b>\n` +
        `📅 ${new Date().toLocaleDateString("uk-UA")}`
      );
    } catch(e) { await tgSend(chatId, "❌ Помилка бази даних"); }
    return;
  }

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

  if (text === "/deals") {
    try {
      const deals = await sbRequest("deals", "GET", null, "?select=*&status=eq.open&order=created_at.desc");
      const arr = Array.isArray(deals) ? deals : [];
      if (!arr.length) { await tgSend(chatId, "📋 Відкритих угод немає в базі"); return; }
      const list = arr.slice(0, 10).map(d => `• ${d.song_name} — $${d.price_usd} (нам $${d.profit_usd})`).join("\n");
      await tgSend(chatId, `📋 <b>Відкриті угоди (${arr.length})</b>\n\n${list}`);
    } catch(e) { await tgSend(chatId, "❌ Помилка"); }
    return;
  }

  if (text === "/clear") {
    await tgSend(chatId,
      `⚠️ <b>Видалити всі тестові дані?</b>\n\nНапиши <b>ТАК ВИДАЛИТИ</b> для підтвердження`
    );
    pending[chatId] = { waitingFor: "clear_confirm", tx: null, meta: null };
    return;
  }

  if (pending[chatId]?.waitingFor === "clear_confirm") {
    delete pending[chatId];
    if (text === "ТАК ВИДАЛИТИ") {
      try {
        await sbRequest("transactions", "DELETE", null, "?id=neq.00000000-0000-0000-0000-000000000000");
        await tgSend(chatId, "✅ Всі транзакції видалені з бази");
      } catch(e) { await tgSend(chatId, "❌ Помилка видалення"); }
    } else {
      await tgSend(chatId, "Скасовано.");
    }
    return;
  }

  // Parse financial transaction
  const parsed = parseTransaction(text);
  if (parsed) {
    const { tx, meta } = parsed;
    const missing = [];
    if (!meta.client && tx.type === "income") missing.push("client");
    if (!meta.song && tx.type === "income" && tx.category === "Song Sale") missing.push("song");
    if (!meta.paymentMethod) missing.push("payment");

    // If full info — save immediately
    if (missing.length === 0) {
      await saveTx(chatId, tx, meta, from);
      return;
    }

    // Save immediately AND ask for missing details
    await sbRequest("transactions", "POST", tx);
    
    let reply = `✅ <b>Записано в ORACUL</b>\n\n`;
    reply += `${tx.type === "income" ? "+" : "-"}${tx.amount} ${tx.currency} — ${tx.category}\n`;
    reply += `📅 ${tx.date} · 👤 ${from}\n\n`;

    // Ask ONE most important missing detail
    if (!meta.client && tx.type === "income") {
      reply += `❓ <b>Від кого отримали?</b> (напиши ім'я клієнта)`;
      pending[chatId] = { tx, meta, waitingFor: "client" };
    } else if (!meta.song && tx.category === "Song Sale") {
      reply += `❓ <b>Яка пісня?</b> (або "пропустити")`;
      pending[chatId] = { tx, meta, waitingFor: "song" };
    } else if (!meta.paymentMethod) {
      reply += `❓ <b>Як оплата?</b> (крипто / кеш / карта / фоп)`;
      pending[chatId] = { tx, meta, waitingFor: "payment" };
    }

    await tgSend(chatId, reply);
    return;
  }

  // Private chat fallback
  if (!isGroup) {
    await tgSend(chatId,
      `Не розпізнав транзакцію.\n\nПриклади:\n` +
      `• отримали $2500 від Дарії за пісню Мрія\n` +
      `• заплатили 32000 грн Vitaliy\n` +
      `• Facebook ads 237 доларів\n\n` +
      `/status /payroll /deals`
    );
  }
}

// ─── Save transaction ────────────────────────────────────────
async function saveTx(chatId, tx, meta, from) {
  try {
    if (meta?.client) tx.comment = `${tx.comment} | від: ${meta.client}`;
    if (meta?.song) tx.comment = `${tx.comment} | пісня: ${meta.song}`;
    if (meta?.paymentMethod) tx.comment = `${tx.comment} | оплата: ${meta.paymentMethod}`;

    await sbRequest("transactions", "POST", tx);

    const sign = tx.type === "income" ? "+" : "-";
    const emoji = tx.type === "income" ? "✅" : "💸";
    let msg = `${emoji} <b>Збережено в ORACUL</b>\n\n`;
    msg += `${sign}${tx.amount} ${tx.currency}\n`;
    msg += `📁 ${tx.category}\n`;
    msg += `🏦 ${tx.account}\n`;
    if (meta?.client) msg += `👤 ${meta.client}\n`;
    if (meta?.song) msg += `🎵 ${meta.song}\n`;
    if (meta?.paymentMethod) msg += `💳 ${meta.paymentMethod}\n`;
    msg += `📅 ${tx.date}`;

    await tgSend(chatId, msg);
  } catch(e) {
    await tgSend(chatId, "❌ Помилка збереження");
  }
}

// ─── Polling ─────────────────────────────────────────────────
let offset = 0;
async function poll() {
  try {
    const res = await tgGetUpdates(offset);
    if (res.ok && res.result?.length) {
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

// ─── Server ──────────────────────────────────────────────────
http.createServer((req, res) => {
  res.writeHead(200);
  res.end(JSON.stringify({ status: "ok", bot: "ORACUL", uptime: Math.floor(process.uptime()) }));
}).listen(process.env.PORT || 3000, () => {
  console.log("✅ ORACUL Bot started with smart clarification");
  poll();
});
