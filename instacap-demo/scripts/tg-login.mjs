// SaveAsBot session yaratish — 2 bosqichli login.
//
// Bosqich 1 (kod so'rash):
//   node tg-login.mjs request "+923360679002"
//     → Telegram kod yuboradi, scriptdan phoneCodeHash chiqadi (state faylga saqlanadi)
//
// Bosqich 2 (kodni tasdiqlash):
//   node tg-login.mjs verify "+923360679002" "12345" [2fa_password]
//     → muvaffaqiyatli bo'lsa server/saveasbot-sessions/<phone>.session yoziladi
//
// Ishlatishdan oldin: pnpm install (telegram paketi kerak — allaqachon bog'langan).

import fs from "node:fs";
import path from "node:path";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const API_ID = Number(process.env.TG_API_ID || 2040);
const API_HASH = process.env.TG_API_HASH || "b18441a1ff607e10a989891a5462e627";
const ROOT = process.cwd();
const STATE_FILE = path.join(ROOT, "scripts", ".tg-login-state.json");
const SESSIONS_DIR = path.join(ROOT, "server", "saveasbot-sessions");

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

async function makeClient() {
  const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
    connectionRetries: 3,
  });
  client.setLogLevel?.("error");
  await client.connect();
  return client;
}

async function request(phone) {
  const client = await makeClient();
  const res = await client.invoke(
    new Api.auth.SendCode({
      phoneNumber: phone,
      apiId: API_ID,
      apiHash: API_HASH,
      settings: new Api.CodeSettings({ allowFlashcall: false, currentNumber: false, allowAppHash: true }),
    }),
  );
  const hash = res.phoneCodeHash;
  const session = client.session.save();
  saveState({ phone, hash, session });
  console.log("OK_REQUEST");
  console.log("phone:", phone);
  console.log("phoneCodeHash:", hash);
  console.log("→ Kodni qabul qildingizmi? Bo'lsa: node tg-login.mjs verify \"" + phone + "\" \"<KOD>\"");
  await client.disconnect();
}

async function verify(phone, code, password) {
  const st = loadState();
  if (!st.phone || st.phone !== phone || !st.hash || !st.session) {
    throw new Error("Avval request bosqichini bajaring (state topilmadi yoki phone mos kelmadi)");
  }
  const client = new TelegramClient(new StringSession(st.session), API_ID, API_HASH, {
    connectionRetries: 3,
  });
  client.setLogLevel?.("error");
  await client.connect();

  try {
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash: st.hash,
        phoneCode: code,
      }),
    );
  } catch (err) {
    if (err?.errorMessage === "SESSION_PASSWORD_NEEDED") {
      if (!password) throw new Error("2FA paroli kerak. Buyruqning oxirida parolni kiriting.");
      const { computeCheck } = await import("telegram/Password.js");
      const pw = await client.invoke(new Api.account.GetPassword());
      const passwordSrp = await computeCheck(pw, password);
      await client.invoke(new Api.auth.CheckPassword({ password: passwordSrp }));
    } else {
      throw err;
    }
  }

  const sessionStr = client.session.save();
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const fname = path.join(SESSIONS_DIR, `${phone}.session`);
  fs.writeFileSync(fname, sessionStr);
  fs.unlinkSync(STATE_FILE);
  console.log("OK_VERIFY");
  console.log("session saved:", fname);
  await client.disconnect();
}

const [, , cmd, ...args] = process.argv;
(async () => {
  try {
    if (cmd === "request") await request(args[0]);
    else if (cmd === "verify") await verify(args[0], args[1], args[2]);
    else {
      console.error("Usage:");
      console.error("  node tg-login.mjs request \"+923360679002\"");
      console.error("  node tg-login.mjs verify  \"+923360679002\" \"12345\" [2fa_password]");
      process.exit(2);
    }
  } catch (e) {
    console.error("ERROR:", e?.errorMessage || e?.message || e);
    process.exit(1);
  }
})();
