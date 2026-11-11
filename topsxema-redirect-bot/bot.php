<?php
/**
 * @Top_sxema_rek_bot — foydalanuvchini asosiy botga (@Top_sxema_instagrambot)
 * yo'naltiradi + adminlar uchun /panel (statistika, xabarnoma).
 *
 * Long-polling, mustaqil PM2 jarayoni (webhook/web-server shart emas).
 * Ma'lumotlar shu papkada: users.json (foydalanuvchilar), meta.json
 * (oxirgi xabarnoma natijasi). Bitta jarayon ketma-ket ishlaydi, shuning
 * uchun fayl bilan ishlash xavfsiz; yozish atomik (tmp + rename).
 */

date_default_timezone_set('Asia/Tashkent');

$BOT_TOKEN = 'CHANGE_ME';
$API = "https://api.telegram.org/bot{$BOT_TOKEN}/";
$MAIN_BOT_URL = 'https://t.me/Top_sxema_instagrambot';
$MAIN_BOT_LABEL = '📊 Top sxema | Heshteg';
$ADMIN_IDS = [0];

$OFFSET_FILE = __DIR__ . '/offset.txt';
$USERS_FILE = __DIR__ . '/users.json';
$META_FILE = __DIR__ . '/meta.json';
$STATE_TTL = 10 * 60; // xabarnoma bosqichi 10 daqiqada eskiradi

$users = load_json($USERS_FILE);
$meta = load_json($META_FILE);
$state = []; // adminId => ['step' => 'await'|'confirm', 'msg_id' => int, 'ts' => int]

// ─────────────── Yordamchi funksiyalar ───────────────

function tg($method, $params = []) {
    global $API;
    $ch = curl_init($API . $method);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($params),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 40,
    ]);
    $res = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($err) {
        fwrite(STDERR, "[" . date('Y-m-d H:i:s') . "] curl xato ($method): $err\n");
        return null;
    }
    return json_decode($res, true);
}

function load_json($file) {
    if (!file_exists($file)) return [];
    $data = json_decode(file_get_contents($file), true);
    return is_array($data) ? $data : [];
}

function save_json($file, $data) {
    $tmp = $file . '.tmp';
    file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE));
    rename($tmp, $file);
}

function send($chatId, $text, $markup = null) {
    $p = ['chat_id' => $chatId, 'text' => $text, 'parse_mode' => 'HTML'];
    if ($markup) $p['reply_markup'] = $markup;
    return tg('sendMessage', $p);
}

function edit($chatId, $msgId, $text, $markup = null) {
    $p = ['chat_id' => $chatId, 'message_id' => $msgId, 'text' => $text, 'parse_mode' => 'HTML'];
    if ($markup) $p['reply_markup'] = $markup;
    return tg('editMessageText', $p);
}

function fmt($n) {
    return number_format($n, 0, '.', ' ');
}

function touch_user($from) {
    global $users, $USERS_FILE;
    $id = (string) $from['id'];
    $now = time();
    if (!isset($users[$id])) {
        $users[$id] = ['first_seen' => $now];
    }
    $users[$id]['first_name'] = $from['first_name'] ?? '';
    $users[$id]['username'] = $from['username'] ?? '';
    $users[$id]['last_seen'] = $now;
    $users[$id]['blocked'] = false; // xabar yozgan bo'lsa — demak bloklamagan
    save_json($USERS_FILE, $users);
}

function active_count() {
    global $users;
    $n = 0;
    foreach ($users as $u) {
        if (empty($u['blocked'])) $n++;
    }
    return $n;
}

// ─────────────── Matnlar va tugmalar ───────────────

function send_welcome($chatId, $startParam = '') {
    global $MAIN_BOT_URL, $MAIN_BOT_LABEL;
    $url = $MAIN_BOT_URL;
    $label = $MAIN_BOT_LABEL;
    if (!empty($startParam)) {
        if (preg_match('/^(?:auction|auc)[_-]?(\d+)?/i', $startParam, $m)) {
            $aucId = !empty($m[1]) ? $m[1] : '';
            $url = $aucId ? "https://t.me/Top_sxema_instagrambot?startapp=auction_{$aucId}" : "https://t.me/Top_sxema_instagrambot?startapp=auction";
            $label = "🔨 Auksionni ochish";
        }
    }
    tg('sendMessage', [
        'chat_id' => $chatId,
        'text' =>
            "👋 Assalomu alaykum!\n\n" .
            "Asosiy botimiz shu yerda — pastdagi tugma orqali undan foydalanishingiz mumkin 👇\n\n" .
            "━━━━━━━━━━\n\n" .
            "👋 Здравствуйте!\n\n" .
            "Наш основной бот находится здесь — воспользуйтесь им по кнопке ниже 👇",
        'reply_markup' => ['inline_keyboard' => [[['text' => $label, 'url' => $url]]]],
    ]);
}

function panel_view() {
    global $users;
    $text =
        "🛠 <b>Admin panel</b>\n\n" .
        "👥 Foydalanuvchilar: <b>" . fmt(count($users)) . "</b>\n" .
        "✅ Faol: <b>" . fmt(active_count()) . "</b>\n\n" .
        "Kerakli bo'limni tanlang:";
    $markup = ['inline_keyboard' => [
        [['text' => '📊 Statistika', 'callback_data' => 'p:stats']],
        [['text' => '📨 Xabarnoma', 'callback_data' => 'p:bc']],
    ]];
    return [$text, $markup];
}

function stats_view() {
    global $users, $meta;
    $now = time();
    $today = strtotime('today');
    $total = count($users);
    $blocked = $d0 = $d7 = $d30 = $act24 = 0;
    foreach ($users as $u) {
        if (!empty($u['blocked'])) $blocked++;
        $fs = $u['first_seen'] ?? 0;
        if ($fs >= $today) $d0++;
        if ($fs >= $now - 7 * 86400) $d7++;
        if ($fs >= $now - 30 * 86400) $d30++;
        if (($u['last_seen'] ?? 0) >= $now - 86400) $act24++;
    }
    $text =
        "📊 <b>Statistika</b>\n" .
        "━━━━━━━━━━\n" .
        "👥 Jami foydalanuvchi: <b>" . fmt($total) . "</b>\n" .
        "✅ Faol: <b>" . fmt($total - $blocked) . "</b>\n" .
        "🚫 Botni bloklagan: <b>" . fmt($blocked) . "</b>\n" .
        "━━━━━━━━━━\n" .
        "🆕 Bugun qo'shilgan: <b>" . fmt($d0) . "</b>\n" .
        "📅 Oxirgi 7 kun: <b>" . fmt($d7) . "</b>\n" .
        "🗓 Oxirgi 30 kun: <b>" . fmt($d30) . "</b>\n" .
        "🔥 24 soatda faol: <b>" . fmt($act24) . "</b>\n";
    if (!empty($meta['last_broadcast'])) {
        $b = $meta['last_broadcast'];
        $text .=
            "━━━━━━━━━━\n" .
            "📨 Oxirgi xabarnoma: " . date('d.m.Y H:i', $b['at']) . "\n" .
            "   ✔️ " . fmt($b['ok']) . "  🚫 " . fmt($b['blocked']) . "  ❌ " . fmt($b['fail']) . "\n";
    }
    $text .= "\n<i>Yangilandi: " . date('d.m.Y H:i:s') . "</i>";
    $markup = ['inline_keyboard' => [
        [['text' => '🔄 Yangilash', 'callback_data' => 'p:stats']],
        [['text' => '⬅️ Orqaga', 'callback_data' => 'p:home']],
    ]];
    return [$text, $markup];
}

function cancel_markup() {
    return ['inline_keyboard' => [[['text' => '❌ Bekor qilish', 'callback_data' => 'p:cancel']]]];
}

// ─────────────── Xabarnoma ───────────────

function run_broadcast($adminId, $fromMsgId, $statusMsgId) {
    global $users, $meta, $USERS_FILE, $META_FILE;

    $targets = [];
    foreach ($users as $id => $u) {
        if (empty($u['blocked']) && (int) $id !== $adminId) $targets[] = (int) $id;
    }
    $n = count($targets);
    $ok = $blocked = $fail = 0;
    $lastEdit = 0;
    $started = time();

    foreach ($targets as $i => $uid) {
        $attempt = 0;
        while (true) {
            // copyMessage — matn/media/caption/formatlash aynan o'zgarishsiz ketadi.
            $r = tg('copyMessage', ['chat_id' => $uid, 'from_chat_id' => $adminId, 'message_id' => $fromMsgId]);
            if (!empty($r['ok'])) {
                $ok++;
                break;
            }
            $code = $r['error_code'] ?? 0;
            if ($code == 429 && $attempt < 3) {
                sleep((int) ($r['parameters']['retry_after'] ?? 1) + 1);
                $attempt++;
                continue;
            }
            if ($code == 403) {
                $blocked++;
                $users[(string) $uid]['blocked'] = true;
            } else {
                $fail++;
            }
            break;
        }
        usleep(40000); // ~25 xabar/soniya — Telegram limitidan past

        if (time() - $lastEdit >= 3 && $i + 1 < $n) {
            edit($adminId, $statusMsgId, "⏳ <b>Yuborilmoqda...</b>\n\n" . fmt($i + 1) . " / " . fmt($n));
            $lastEdit = time();
        }
    }

    save_json($USERS_FILE, $users);
    $meta['last_broadcast'] = ['at' => time(), 'total' => $n, 'ok' => $ok, 'blocked' => $blocked, 'fail' => $fail];
    save_json($META_FILE, $meta);

    edit($adminId, $statusMsgId,
        "✅ <b>Xabarnoma yakunlandi</b>\n" .
        "━━━━━━━━━━\n" .
        "👥 Jami: <b>" . fmt($n) . "</b>\n" .
        "✔️ Yetkazildi: <b>" . fmt($ok) . "</b>\n" .
        "🚫 Botni bloklagan: <b>" . fmt($blocked) . "</b>\n" .
        "❌ Boshqa xato: <b>" . fmt($fail) . "</b>\n" .
        "⏱ Vaqt: " . (time() - $started) . " s",
        ['inline_keyboard' => [[['text' => '⬅️ Panelga qaytish', 'callback_data' => 'p:home']]]]
    );
    echo "[" . date('Y-m-d H:i:s') . "] Xabarnoma: admin=$adminId jami=$n ok=$ok blocked=$blocked fail=$fail\n";
}

// ─────────────── Update ishlovchilar ───────────────

function handle_callback($cb) {
    global $ADMIN_IDS, $state;
    $fromId = $cb['from']['id'];
    $chatId = $cb['message']['chat']['id'] ?? null;
    $msgId = $cb['message']['message_id'] ?? null;
    $data = $cb['data'] ?? '';

    if (!in_array($fromId, $ADMIN_IDS, true) || !$chatId) {
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]);
        return;
    }

    if ($data === 'p:send') {
        $st = $state[$fromId] ?? null;
        if (!$st || $st['step'] !== 'confirm') {
            tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => 'Xabarnoma muddati tugagan. Qaytadan boshlang.', 'show_alert' => true]);
            return;
        }
        unset($state[$fromId]);
        tg('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => 'Yuborish boshlandi']);
        edit($chatId, $msgId, "⏳ <b>Yuborilmoqda...</b>");
        run_broadcast($fromId, $st['msg_id'], $msgId);
        return;
    }

    tg('answerCallbackQuery', ['callback_query_id' => $cb['id']]);

    if ($data === 'p:home') {
        unset($state[$fromId]);
        [$t, $m] = panel_view();
        edit($chatId, $msgId, $t, $m);
    } elseif ($data === 'p:stats') {
        [$t, $m] = stats_view();
        edit($chatId, $msgId, $t, $m);
    } elseif ($data === 'p:bc') {
        $state[$fromId] = ['step' => 'await', 'ts' => time()];
        edit($chatId, $msgId,
            "📨 <b>Xabarnoma</b>\n\n" .
            "Barcha foydalanuvchilarga yubormoqchi bo'lgan xabaringizni shu chatga yuboring.\n" .
            "Istalgan turi bo'ladi: matn, foto, video, fayl, GIF, ovozli xabar.\n\n" .
            "Yuborishdan oldin ko'rinishini ko'rsatib, tasdiq so'rayman.\n\n" .
            "👥 Qabul qiluvchilar: <b>" . fmt(active_count()) . "</b>",
            cancel_markup()
        );
    } elseif ($data === 'p:cancel') {
        unset($state[$fromId]);
        edit($chatId, $msgId, "🚫 Bekor qilindi.",
            ['inline_keyboard' => [[['text' => '⬅️ Panelga qaytish', 'callback_data' => 'p:home']]]]);
    }
}

function handle_admin_message($msg) {
    global $state, $STATE_TTL;
    $fromId = $msg['from']['id'];
    $text = $msg['text'] ?? '';

    if ($text === '/panel' || $text === '/admin') {
        unset($state[$fromId]);
        [$t, $m] = panel_view();
        send($fromId, $t, $m);
        return true;
    }

    $st = $state[$fromId] ?? null;
    if ($st && time() - $st['ts'] > $STATE_TTL) {
        unset($state[$fromId]);
        $st = null;
    }
    if (!$st || $st['step'] !== 'await') return false;
    if ($text !== '' && $text[0] === '/') return false; // boshqa buyruq — xabarnoma emas

    $state[$fromId] = ['step' => 'confirm', 'msg_id' => $msg['message_id'], 'ts' => time()];
    send($fromId, "👇 <b>Foydalanuvchilar shunday ko'radi:</b>");
    tg('copyMessage', ['chat_id' => $fromId, 'from_chat_id' => $fromId, 'message_id' => $msg['message_id']]);
    send($fromId,
        "Shu xabar <b>" . fmt(active_count()) . "</b> ta foydalanuvchiga yuboriladi. Tasdiqlaysizmi?",
        ['inline_keyboard' => [
            [['text' => '✅ Yuborish', 'callback_data' => 'p:send']],
            [['text' => '❌ Bekor qilish', 'callback_data' => 'p:cancel']],
        ]]
    );
    return true;
}

function handle_my_chat_member($m) {
    global $users, $USERS_FILE;
    if (($m['chat']['type'] ?? '') !== 'private') return;
    $id = (string) $m['chat']['id'];
    $status = $m['new_chat_member']['status'] ?? '';
    if (!isset($users[$id])) {
        if ($status !== 'member') return;
        touch_user($m['from']);
    }
    $users[$id]['blocked'] = ($status === 'kicked');
    save_json($USERS_FILE, $users);
}

// ─────────────── Ishga tushirish ───────────────

echo "[" . date('Y-m-d H:i:s') . "] Redirect bot ishga tushdi (@Top_sxema_rek_bot), foydalanuvchilar: " . count($users) . "\n";

// /panel buyrug'i faqat adminlarning buyruqlar menyusida ko'rinadi.
foreach ($ADMIN_IDS as $aid) {
    tg('setMyCommands', [
        'commands' => [
            ['command' => 'start', 'description' => 'Boshlash'],
            ['command' => 'panel', 'description' => 'Admin panel'],
        ],
        'scope' => ['type' => 'chat', 'chat_id' => $aid],
    ]);
}

$offset = file_exists($OFFSET_FILE) ? (int) trim(file_get_contents($OFFSET_FILE)) : 0;

while (true) {
    $updates = tg('getUpdates', [
        'offset' => $offset,
        'timeout' => 30,
        'allowed_updates' => ['message', 'callback_query', 'my_chat_member'],
    ]);
    if (empty($updates['ok'])) {
        sleep(2); // tarmoq xatosi — spam-loop bo'lmasin
        continue;
    }
    foreach ($updates['result'] as $update) {
        $offset = $update['update_id'] + 1;
        file_put_contents($OFFSET_FILE, (string) $offset);

        try {
            if (isset($update['callback_query'])) {
                handle_callback($update['callback_query']);
                continue;
            }
            if (isset($update['my_chat_member'])) {
                handle_my_chat_member($update['my_chat_member']);
                continue;
            }
            $msg = $update['message'] ?? null;
            if (!$msg || ($msg['chat']['type'] ?? '') !== 'private' || empty($msg['from'])) continue;

            touch_user($msg['from']);
            if (in_array($msg['from']['id'], $ADMIN_IDS, true) && handle_admin_message($msg)) continue;
            $txt = trim($msg['text'] ?? '');
            $startParam = '';
            if (strpos($txt, '/start') === 0) {
                $startParam = trim(substr($txt, 6));
            }
            send_welcome($msg['chat']['id'], $startParam);
        } catch (Throwable $e) {
            fwrite(STDERR, "[" . date('Y-m-d H:i:s') . "] Update xato: " . $e->getMessage() . "\n");
        }
    }
}
