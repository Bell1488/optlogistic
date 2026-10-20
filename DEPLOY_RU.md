# Деплой сайта на opt-logistic.com

Инструкция рассчитана на VPS с Ubuntu 22.04/24.04, публичным IPv4, Nginx и отдельным SOCKS5-прокси. Домен должен быть зарегистрирован и доступен для управления DNS.

## 1. DNS домена

У DNS-провайдера создайте записи:

| Тип | Имя | Значение |
|---|---|---|
| A | `@` | публичный IPv4 вашего VPS |
| A | `www` | тот же IPv4 |

Удалите конфликтующие старые A/AAAA записи. Если IPv6 на VPS не настроен, удалите AAAA-записи. DNS может обновляться до 24 часов.

Проверьте после обновления DNS:

```bash
dig +short opt-logistic.com A
dig +short www.opt-logistic.com A
```

Оба имени должны показать IP VPS.

## 2. Подготовка VPS

Подключитесь по SSH от имени пользователя с `sudo`:

```bash
ssh USER@SERVER_IP
sudo apt update
sudo apt install -y nginx python3 python3-venv git curl certbot python3-certbot-nginx
```

Откройте только SSH, HTTP и HTTPS в облачном firewall и UFW (если он используется):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Порт `8085` наружу не открывайте: приложение слушает только localhost, Nginx проксирует трафик локально.

## 3. Установка сайта

Создайте системного пользователя приложения и каталог:

```bash
sudo adduser --system --group --home /opt/optlogistic --shell /usr/sbin/nologin optlogistic
sudo mkdir -p /opt/optlogistic/app
sudo chown -R optlogistic:optlogistic /opt/optlogistic
```

Установите проект из GitHub:

```bash
sudo -u optlogistic git clone --branch main https://github.com/Bell1488/optlogistic.git /opt/optlogistic/app
cd /opt/optlogistic/app
sudo python3 -m venv .venv
sudo .venv/bin/pip install --upgrade pip
sudo .venv/bin/pip install -r requirements.txt
sudo chown -R optlogistic:optlogistic /opt/optlogistic/app
```

## 4. Telegram и SOCKS5H

Создайте бота у `@BotFather`, добавьте его в нужный Telegram-чат/канал и узнайте ID чата. Нужен работающий SOCKS5-прокси с доступом с VPS; `127.0.0.1:1080` верно только если прокси действительно запущен на самом VPS.

Создайте закрытый конфиг, не публикуйте его в Git:

```bash
sudo nano /opt/optlogistic/app/server_config.py
```

Заполните значения в файле:

```python
TELEGRAM_BOT_TOKEN = "ТОКЕН_ОТ_BOTFATHER"
TELEGRAM_CHAT_ID = "ID_ЧАТА"
SOCKS5_PROXY = "socks5h://USER:PASSWORD@PROXY_HOST:1080"
PORT = 8085
HOST = "127.0.0.1"
ALLOWED_ORIGINS = []
LEADS_CSV_FILE = "/var/lib/optlogistic/leads.csv"
LEADS_JSON_FILE = "/var/lib/optlogistic/leads.json"
```

Для прокси без авторизации используйте `socks5h://PROXY_HOST:1080`. Не вставляйте настоящие реквизиты в документацию, команды, GitHub или сообщения.

Создайте защищенное хранилище лидов и назначьте права:

```bash
sudo install -d -o optlogistic -g optlogistic -m 700 /var/lib/optlogistic
sudo chown optlogistic:optlogistic /opt/optlogistic/app/server_config.py
sudo chmod 600 /opt/optlogistic/app/server_config.py
```

Если имя пользователя/пароль SOCKS содержит `@`, `:`, `/` или специальные символы, URL-кодируйте их либо используйте отдельные учетные данные без этих символов.

## 5. Автозапуск Python-сервера

Создайте службу systemd:

```bash
sudo nano /etc/systemd/system/optlogistic.service
```

Содержимое:

```ini
[Unit]
Description=Opt Logistic website and lead API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=optlogistic
Group=optlogistic
WorkingDirectory=/opt/optlogistic/app
ExecStart=/opt/optlogistic/app/.venv/bin/python /opt/optlogistic/app/server.py
Restart=on-failure
RestartSec=5
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/optlogistic

[Install]
WantedBy=multi-user.target
```

Запустите и проверьте сервис:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now optlogistic
sudo systemctl status optlogistic --no-pager
sudo journalctl -u optlogistic -n 50 --no-pager
curl -I http://127.0.0.1:8085/
```

Ожидайте HTTP `200`. Если служба не запускается, проверьте логи, синтаксис `server_config.py`, установку зависимостей и доступность прокси.

## 6. Nginx и домен

Создайте конфигурацию сайта:

```bash
sudo nano /etc/nginx/sites-available/opt-logistic.com
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name opt-logistic.com www.opt-logistic.com;

    client_max_body_size 64k;

    location / {
        proxy_pass http://127.0.0.1:8085;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Включите конфигурацию:

```bash
sudo ln -s /etc/nginx/sites-available/opt-logistic.com /etc/nginx/sites-enabled/opt-logistic.com
sudo nginx -t
sudo systemctl reload nginx
```

Убедитесь, что `http://opt-logistic.com` открывает страницу, прежде чем выпускать сертификат.

## 7. HTTPS

Выпустите сертификат Let's Encrypt:

```bash
sudo certbot --nginx -d opt-logistic.com -d www.opt-logistic.com
sudo certbot renew --dry-run
```

Certbot настроит HTTPS и перенаправление с HTTP. После этого проверьте `https://opt-logistic.com` и `https://www.opt-logistic.com`.

## 8. Тест заявок

Проверьте SOCKS5H с самого VPS:

```bash
curl --socks5-hostname PROXY_HOST:1080 https://api.telegram.org
```

Для прокси с авторизацией добавьте `--proxy-user USER:PASSWORD`. Команда проверяет сетевой маршрут, но не отправляет сообщение боту.

Отправьте тестовую заявку через форму на сайте. Убедитесь, что:

- появилась запись в Telegram;
- заявка записалась в `/var/lib/optlogistic/leads.csv` и `leads.json`;
- в браузере форма показала успешное завершение.

Проверьте логи:

```bash
sudo journalctl -u optlogistic -f
```

Права на резервные копии ограничены каталогом `700`. Настройте регулярную резервную копию `/var/lib/optlogistic` вне VPS.

## 9. Обновление сайта

После отправки изменений в GitHub:

```bash
cd /opt/optlogistic/app
sudo -u optlogistic git pull --ff-only origin main
sudo -u optlogistic .venv/bin/pip install -r requirements.txt
sudo systemctl restart optlogistic
sudo systemctl status optlogistic --no-pager
```

Не перезаписывайте `server_config.py` при обновлении: там находятся секреты и настройки продакшена.

## Проверка после деплоя

- `https://opt-logistic.com` и `https://www.opt-logistic.com` доступны по HTTPS.
- В браузере нет ошибок загрузки `config.js`, `script.js`, `style.css`, `logo.png` и `hero-back.png`.
- Форма отправляет данные на тот же домен по `/api/lead`.
- Заявка приходит в Telegram и сохраняется на сервере.
- Порт `8085` недоступен напрямую из интернета.
- Реальные токен бота и пароль прокси не попали в GitHub.
