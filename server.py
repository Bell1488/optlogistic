#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Высокоскоростной HTTP-сервер для лендинга КаргоМост
- Раздает статические файлы сайта (HTML, CSS, JS)
- Принимает заявки с сайта (POST /api/lead)
- Сохраняет заявки в leads.csv и leads.json с блокировкой и атомарной записью
- Отправляет уведомления в Telegram через SOCKS5H прокси (socks5h://)
"""

import http.server
import socketserver
import json
import os
import sys
import time
import datetime
import csv
import subprocess
import urllib.parse
import html
import tempfile
import threading

# Импорт конфигурации
try:
    import server_config as cfg
except ImportError:
    class cfg:
        PORT = 8085
        TELEGRAM_BOT_TOKEN = ""
        TELEGRAM_CHAT_ID = ""
        SOCKS5_PROXY = "socks5h://127.0.0.1:1080"
        LEADS_CSV_FILE = "leads.csv"
        LEADS_JSON_FILE = "leads.json"

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_LOCK = threading.Lock()
MAX_BODY_BYTES = 64 * 1024
PUBLIC_FILES = {'/', '/index.html', '/buyout.html', '/buyout.css', '/buyout.js', '/mobile-menu.js', '/style.css', '/script.js', '/config.js', '/privacy.html', '/logo.png', '/hero-back.png', '/pic-ico.png'}
RATE_LIMIT = 20
RATE_WINDOW = 60
RATE_STATE = {}
RATE_LOCK = threading.Lock()


def public_path(request_path):
    path = urllib.parse.urlsplit(request_path).path or '/'
    return path if path == '/' else '/' + path.lstrip('/')


def mask_proxy(proxy):
    if not proxy:
        return ''
    parsed = urllib.parse.urlsplit(proxy if '://' in proxy else '//' + proxy)
    if not parsed.hostname:
        return 'configured'
    host = parsed.hostname
    if parsed.port:
        host += f':{parsed.port}'
    return f'{parsed.scheme + "://" if parsed.scheme else ""}{"***@" if parsed.username else ""}{host}'


def normalize_lead(data):
    if not isinstance(data, dict):
        raise ValueError('Lead payload must be an object')

    allowed = {
        'source', 'contact', 'name', 'city', 'cargo', 'volume', 'priority', 'calc',
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
        'yclid', 'ym_client_id', 'page_url', 'page_title', 'referrer'
    }
    normalized = {}
    for key in allowed:
        value = data.get(key, '')
        if value is None:
            value = ''
        if not isinstance(value, (str, int, float, bool)):
            raise ValueError(f'Invalid field: {key}')
        normalized[key] = str(value).strip()[:2000]

    if len(normalized['contact']) < 5:
        raise ValueError('Contact is required')
    return normalized


def rate_limit_ok(client_ip):
    now = time.time()
    with RATE_LOCK:
        timestamps = [ts for ts in RATE_STATE.get(client_ip, []) if now - ts < RATE_WINDOW]
        if len(timestamps) >= RATE_LIMIT:
            RATE_STATE[client_ip] = timestamps
            return False
        timestamps.append(now)
        RATE_STATE[client_ip] = timestamps
        return True

def save_lead_locally(lead_data):
    """Гарантированное сохранение лида на сервере"""
    lead_data['timestamp'] = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    fieldnames = [
        'timestamp', 'source', 'contact', 'name', 'city', 'cargo', 'volume',
        'priority', 'calc', 'utm_source', 'utm_medium', 'utm_campaign',
        'utm_content', 'utm_term', 'yclid', 'ym_client_id', 'page_url'
    ]
    errors = []
    with SAVE_LOCK:
        json_path = os.path.join(ROOT_DIR, getattr(cfg, 'LEADS_JSON_FILE', 'leads.json'))
        try:
            leads = []
            if os.path.exists(json_path):
                with open(json_path, 'r', encoding='utf-8') as f:
                    leads = json.load(f)
            if not isinstance(leads, list):
                raise ValueError('Lead JSON must contain an array')
            leads.append(lead_data)
            directory = os.path.dirname(json_path) or ROOT_DIR
            fd, temp_path = tempfile.mkstemp(prefix='.leads-', suffix='.tmp', dir=directory)
            try:
                with os.fdopen(fd, 'w', encoding='utf-8') as f:
                    json.dump(leads, f, ensure_ascii=False, indent=2)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(temp_path, json_path)
            finally:
                if os.path.exists(temp_path):
                    os.unlink(temp_path)
        except Exception as e:
            errors.append(f'JSON: {e}')

        csv_path = os.path.join(ROOT_DIR, getattr(cfg, 'LEADS_CSV_FILE', 'leads.csv'))
        try:
            file_exists = os.path.exists(csv_path)
            with open(csv_path, 'a', encoding='utf-8-sig', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore', delimiter=';')
                if not file_exists:
                    writer.writeheader()
                writer.writerow(lead_data)
                f.flush()
                os.fsync(f.fileno())
        except Exception as e:
            errors.append(f'CSV: {e}')

    if errors:
        print(f"[ERROR] Failed to save lead: {'; '.join(errors)}", file=sys.stderr)
    return not errors


def format_telegram_message(lead):
    """Форматирование карточки лида для Telegram"""
    def esc(value, fallback='—'):
        value = lead.get(value, fallback)
        return html.escape(str(value or fallback), quote=False)

    dt = lead.get('timestamp') or datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    src = esc('source', 'Форма на сайте')

    msg = [
        f"🔥 <b>НОВАЯ ЗАЯВКА НА КАРГО</b>",
        f"⏰ <b>Время:</b> {html.escape(str(dt), quote=False)}",
        f"📍 <b>Источник:</b> {src}",
        "",
        f"👤 <b>Имя:</b> {esc('name', 'Не указано')}",
        f"📞 <b>Контакт:</b> <code>{esc('contact')}</code>",
        f"🏙 <b>Город доставки:</b> {esc('city', 'Не указан')}",
        "",
        f"📦 <b>Что везут:</b> {esc('cargo')}",
        f"⚖️ <b>Объем партии:</b> {esc('volume')}",
        f"🎯 <b>Приоритет:</b> {esc('priority')}",
        f"💰 <b>Предварительный расчет:</b> {esc('calc')}",
        ""
    ]

    # Данные Директа и Метрики
    analytics = []
    if lead.get('utm_source'): analytics.append(f"• <b>utm_source:</b> {esc('utm_source')}")
    if lead.get('utm_campaign'): analytics.append(f"• <b>utm_campaign:</b> {esc('utm_campaign')}")
    if lead.get('utm_term'): analytics.append(f"• <b>Ключевое слово (term):</b> {esc('utm_term')}")
    if lead.get('yclid'): analytics.append(f"• <b>YCLID (Яндекс):</b> <code>{esc('yclid')}</code>")
    if lead.get('ym_client_id'): analytics.append(f"• <b>ClientID Метрики:</b> <code>{esc('ym_client_id')}</code>")

    if analytics:
        msg.append("📊 <b>Данные Яндекс.Директа:</b>")
        msg.extend(analytics)

    return "\n".join(msg)


def send_to_telegram_socks5h(text):
    """Отправка сообщения в Telegram через SOCKS5H прокси"""
    bot_token = getattr(cfg, 'TELEGRAM_BOT_TOKEN', '').strip()
    chat_id = getattr(cfg, 'TELEGRAM_CHAT_ID', '').strip()
    proxy = getattr(cfg, 'SOCKS5_PROXY', '').strip()

    if not bot_token or not chat_id:
        print("[INFO] Telegram Bot Token or Chat ID not configured. Lead saved locally.", flush=True)
        return False, "Telegram not configured"

    tg_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }

    # Способ 1: Использование httpx с socks5h
    try:
        import httpx
        client_kwargs = {"timeout": 15.0}
        if proxy:
            # Преобразуем socks5h:// в формат httpx если нужно
            client_kwargs["proxy"] = proxy

        with httpx.Client(**client_kwargs) as client:
            resp = client.post(tg_url, json=payload)
            if resp.status_code == 200:
                print(f"[OK] Telegram notification sent via httpx (proxy: {proxy or 'direct'})", flush=True)
                return True, "Sent via httpx"
            else:
                print(f"[WARN] Telegram API error: {resp.status_code} - {resp.text}", flush=True)
    except Exception as e:
        print(f"[WARN] httpx failed ({e}), attempting system curl fallback...", flush=True)

    # Способ 2: Надежный системный фолбэк через curl.exe (нативная поддержка --socks5-hostname)
    try:
        cmd = ["curl.exe", "-s", "-X", "POST", tg_url, "-H", "Content-Type: application/json", "-d", json.dumps(payload)]
        if proxy and proxy.startswith("socks5h://"):
            proxy_clean = proxy.replace("socks5h://", "")
            cmd.extend(["--socks5-hostname", proxy_clean])
        elif proxy and proxy.startswith("socks5://"):
            proxy_clean = proxy.replace("socks5://", "")
            cmd.extend(["--socks5", proxy_clean])

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if result.returncode == 0 and '"ok":true' in result.stdout:
            print("[OK] Telegram notification sent via curl.exe --socks5-hostname", flush=True)
            return True, "Sent via curl"
        else:
            print(f"[ERROR] curl failed: {result.stderr or result.stdout}", flush=True)
    except Exception as e:
        print(f"[ERROR] System curl execution failed: {e}", flush=True)

    return False, "Failed to send to Telegram"


class CargoRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Кастомный HTTP-обработчик для статики и API-заявок"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def do_POST(self):
        # Эндпоинт приема лидов
        if self.path in ('/api/lead', '/api/lead/'):
            if not rate_limit_ok(self.client_address[0]):
                self.send_error(429, 'Too many requests')
                return
            try:
                content_length = int(self.headers.get('Content-Length', 0))
            except ValueError:
                self.send_error(400, 'Invalid Content-Length')
                return
            if content_length <= 0 or content_length > MAX_BODY_BYTES:
                self.send_error(413 if content_length > MAX_BODY_BYTES else 400, 'Invalid request size')
                return
            post_body = self.rfile.read(content_length)

            try:
                text_body = post_body.decode('utf-8')
            except UnicodeDecodeError:
                text_body = post_body.decode('cp1251', errors='replace')

            try:
                lead_data = json.loads(text_body)
            except Exception:
                parsed = urllib.parse.parse_qs(text_body)
                lead_data = {k: v[0] if isinstance(v, list) else v for k, v in parsed.items()}

            try:
                lead_data = normalize_lead(lead_data)
            except ValueError as e:
                self.send_error(400, str(e))
                return

            # 1. Локальное сохранение
            saved = save_lead_locally(lead_data)

            # 2. Форматирование и отправка в Telegram через socks5h
            msg_text = format_telegram_message(lead_data)
            tg_ok, tg_status = send_to_telegram_socks5h(msg_text)

            # Ответ браузеру
            response = {
                "ok": saved,
                "saved": saved,
                "telegram": tg_ok,
                "status": tg_status,
                "timestamp": lead_data.get('timestamp')
            }

            self.send_response(200 if saved else 500)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            return

        self.send_error(404, "Endpoint not found")

    def do_OPTIONS(self):
        """Поддержка CORS"""
        self.send_response(200)
        self._send_cors_origin()
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def end_headers(self):
        # Заголовки кеширования для статики
        if self.path.endswith(('.html', '.js', '.css')):
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

    def _send_cors_origin(self):
        origin = self.headers.get('Origin')
        allowed = getattr(cfg, 'ALLOWED_ORIGINS', [])
        if origin and origin in allowed:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')

    def do_GET(self):
        if public_path(self.path) not in PUBLIC_FILES:
            self.send_error(404, 'Not found')
            return
        super().do_GET()

    def do_HEAD(self):
        if public_path(self.path) not in PUBLIC_FILES:
            self.send_error(404, 'Not found')
            return
        super().do_HEAD()

    def log_message(self, format, *args):
        # Лаконичные логи запросов
        try:
            message = format % args
        except (TypeError, ValueError):
            message = f'{format} {args}'
        if '/api/lead' in message:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


def run_server():
    port = getattr(cfg, 'PORT', 8085)
    socketserver.TCPServer.allow_reuse_address = True
    host = getattr(cfg, 'HOST', '127.0.0.1')
    with socketserver.ThreadingTCPServer((host, port), CargoRequestHandler) as httpd:
        httpd.daemon_threads = True
        print("=" * 60)
        print(f"  🚀 КАРГО СЕРВЕР ЗАПУЩЕН НА ПОРТУ {port}")
        print(f"  • Адрес:             http://{host}:{port}")
        print(f"  • Прием заявок:      http://localhost:{port}/api/lead")
        proxy = getattr(cfg, 'SOCKS5_PROXY', '')
        print(f"  • SOCKS5H Прокси:    {mask_proxy(proxy) if proxy else 'Отключен (прямое подключение)'}")
        print(f"  • Telegram Бот:      {'Настроен' if getattr(cfg, 'TELEGRAM_BOT_TOKEN', '') else 'Не настроен (заявки сохраняются локально)'}")
        print("=" * 60, flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен.")


if __name__ == '__main__':
    run_server()
