<?php
/**
 * Обработчик заявок КаргоМост для стандартного PHP-хостинга
 * - Принимает JSON заявку
 * - Сохраняет в leads.csv
 * - Отправляет уведомление в Telegram через SOCKS5H прокси (CURLPROXY_SOCKS5_HOSTNAME)
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
$allowedOrigin = getenv('CARGO_ALLOWED_ORIGIN') ?: '';
if ($allowedOrigin !== '' && hash_equals($allowedOrigin, $_SERVER['HTTP_ORIGIN'] ?? '')) {
    header('Access-Control-Allow-Origin: ' . $allowedOrigin);
    header('Vary: Origin');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

// Простое ограничение частоты запросов без внешних зависимостей.
$rateDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cargo-lead-rate';
if (!is_dir($rateDir)) {
    @mkdir($rateDir, 0700, true);
}
$clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$rateFile = $rateDir . DIRECTORY_SEPARATOR . hash('sha256', $clientIp) . '.json';
$rateFp = @fopen($rateFile, 'c+');
if ($rateFp) {
    flock($rateFp, LOCK_EX);
    $rateRaw = stream_get_contents($rateFp);
    $rateItems = json_decode($rateRaw ?: '[]', true);
    if (!is_array($rateItems)) $rateItems = [];
    $now = time();
    $rateItems = array_values(array_filter($rateItems, static function ($ts) use ($now) {
        return is_int($ts) && ($now - $ts) < 60;
    }));
    if (count($rateItems) >= 20) {
        flock($rateFp, LOCK_UN);
        fclose($rateFp);
        http_response_code(429);
        echo json_encode(['ok' => false, 'error' => 'Too many requests']);
        exit;
    }
    $rateItems[] = $now;
    ftruncate($rateFp, 0);
    rewind($rateFp);
    fwrite($rateFp, json_encode($rateItems));
    fflush($rateFp);
    flock($rateFp, LOCK_UN);
    fclose($rateFp);
}

// ==========================================
// НАСТРОЙКИ
// ==========================================
$botToken    = '';                        // Токен бота: "7123456789:AAH..."
$chatId      = '';                        // ID чата: "123456789" или "-100123456789"
$socks5Proxy = '127.0.0.1:1080';          // SOCKS5 прокси. Формат: 'ip:port' или 'user:pass@ip:port'. Оставьте пустым '' если без прокси.
$csvFile     = __DIR__ . '/leads.csv';    // Файл резервного сохранения заявок

// Получение входных данных
$rawInput = file_get_contents('php://input');
if (strlen($rawInput) > 65536) {
    http_response_code(413);
    echo json_encode(['ok' => false, 'error' => 'Request too large']);
    exit;
}
$data = json_decode($rawInput, true);

if (!is_array($data)) {
    $data = $_POST;
}

if (!is_array($data) || empty($data)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'No data received']);
    exit;
}

$allowedFields = [
    'source', 'contact', 'name', 'city', 'cargo', 'volume', 'priority', 'calc',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'yclid', 'ym_client_id', 'page_url', 'page_title', 'referrer'
];
$normalized = [];
foreach ($allowedFields as $field) {
    $value = $data[$field] ?? '';
    if (is_array($value) || is_object($value)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Invalid field: ' . $field]);
        exit;
    }
    $value = trim((string)$value);
    $normalized[$field] = function_exists('mb_substr') ? mb_substr($value, 0, 2000) : substr($value, 0, 2000);
}
$data = $normalized;
$contactLength = function_exists('mb_strlen') ? mb_strlen($data['contact']) : strlen($data['contact']);
if ($contactLength < 5) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Contact is required']);
    exit;
}

$data['timestamp'] = date('Y-m-d H:i:s');

// 1. Сохранение в CSV
$saved = false;
$fileExisted = file_exists($csvFile);
if ($fp = fopen($csvFile, 'a')) {
    flock($fp, LOCK_EX);
    if (!$fileExisted) {
        // UTF-8 BOM для корректного открытия в Excel
        fputs($fp, chr(0xEF) . chr(0xBB) . chr(0xBF));
        fputcsv($fp, [
            'timestamp', 'source', 'contact', 'name', 'city', 'cargo', 'volume',
            'priority', 'calc', 'utm_source', 'utm_medium', 'utm_campaign',
            'utm_content', 'utm_term', 'yclid', 'ym_client_id', 'page_url'
        ], ';');
    }

    fputcsv($fp, [
        $data['timestamp'] ?? '',
        $data['source'] ?? '',
        $data['contact'] ?? '',
        $data['name'] ?? '',
        $data['city'] ?? '',
        $data['cargo'] ?? '',
        $data['volume'] ?? '',
        $data['priority'] ?? '',
        $data['calc'] ?? '',
        $data['utm_source'] ?? '',
        $data['utm_medium'] ?? '',
        $data['utm_campaign'] ?? '',
        $data['utm_content'] ?? '',
        $data['utm_term'] ?? '',
        $data['yclid'] ?? '',
        $data['ym_client_id'] ?? '',
        $data['page_url'] ?? ''
    ], ';');
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    $saved = true;
}

// 2. Отправка в Telegram через SOCKS5H
$tgSent = false;
$tgStatus = 'Not configured';

if (!empty($botToken) && !empty($chatId)) {
    $esc = static function ($value, $fallback = '—') {
        return htmlspecialchars((string)($value ?: $fallback), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    };
    $msg = "🔥 <b>НОВАЯ ЗАЯВКА НА КАРГО</b>\n";
    $msg .= "⏰ <b>Время:</b> " . $esc($data['timestamp'] ?? '') . "\n";
    $msg .= "📍 <b>Источник:</b> " . $esc($data['source'] ?? '', 'Форма') . "\n\n";
    $msg .= "👤 <b>Имя:</b> " . $esc($data['name'] ?? '', 'Не указано') . "\n";
    $msg .= "📞 <b>Контакт:</b> <code>" . $esc($data['contact'] ?? '') . "</code>\n";
    $msg .= "🏙 <b>Город:</b> " . $esc($data['city'] ?? '', 'Не указан') . "\n\n";
    $msg .= "📦 <b>Груз:</b> " . $esc($data['cargo'] ?? '') . "\n";
    $msg .= "⚖️ <b>Объем:</b> " . $esc($data['volume'] ?? '') . "\n";
    $msg .= "🎯 <b>Приоритет:</b> " . $esc($data['priority'] ?? '') . "\n";
    $msg .= "💰 <b>Расчет:</b> " . $esc($data['calc'] ?? '') . "\n\n";

    if (!empty($data['utm_source']) || !empty($data['utm_term']) || !empty($data['yclid'])) {
        $msg .= "📊 <b>Данные Яндекс.Директа:</b>\n";
        if (!empty($data['utm_source'])) $msg .= "• utm_source: " . $esc($data['utm_source']) . "\n";
        if (!empty($data['utm_campaign'])) $msg .= "• utm_campaign: " . $esc($data['utm_campaign']) . "\n";
        if (!empty($data['utm_term'])) $msg .= "• Ключевик: " . $esc($data['utm_term']) . "\n";
        if (!empty($data['yclid'])) $msg .= "• YCLID: <code>" . $esc($data['yclid']) . "</code>\n";
        if (!empty($data['ym_client_id'])) $msg .= "• ClientID: <code>" . $esc($data['ym_client_id']) . "</code>\n";
    }

    $ch = curl_init("https://api.telegram.org/bot{$botToken}/sendMessage");
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'chat_id' => $chatId,
        'text' => $msg,
        'parse_mode' => 'HTML',
        'disable_web_page_preview' => true
    ]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);

    // Подключение через SOCKS5H с удаленным резолвом DNS
    if (!empty($socks5Proxy)) {
        // Очищаем от протокола если указан
        $cleanProxy = preg_replace('#^socks5h?://#i', '', $socks5Proxy);
        curl_setopt($ch, CURLOPT_PROXY, $cleanProxy);
        curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5_HOSTNAME); // socks5h
    }

    $resp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($httpCode === 200) {
        $tgSent = true;
        $tgStatus = 'Sent successfully';
    } else {
        $tgStatus = "Failed (HTTP $httpCode): $curlErr";
    }
}

echo json_encode([
    'ok'        => $saved,
    'saved'     => $saved,
    'telegram'  => $tgSent,
    'status'    => $tgStatus,
    'timestamp' => $data['timestamp']
]);
