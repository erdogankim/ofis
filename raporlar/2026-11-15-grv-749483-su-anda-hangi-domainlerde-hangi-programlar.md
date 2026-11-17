# Sunucu Domain ve Aktif Servis Dağılım Raporu

**Tarih:** 15 Kasım 2026  
**Raporlayan:** Yazılım Uzmanı  
**Koordinasyon:** Genel Müdür  
**Muhatap (Patron):** Mustafa  
**Görev ID:** GRV-749483  

---

## 1. Yönetici Özeti

Sunucu üzerinde yapılan ağ port taramaları (`ss -tulpn`), tersine proxy yapılandırma incelemesi ([/etc/caddy/Caddyfile](file:///etc/caddy/Caddyfile)), aktif konteynerler (`docker ps`) ve systemd servis kontrolleri sonucunda; tüm dış HTTP/HTTPS trafiğini **Caddy v2.11.7** web sunucusunun yönettiği ve otomatik SSL (Let's Encrypt) ile güvenceye aldığı tespit edilmiştir. 

Toplam **6 domain/alt domain** aktif olarak yayındadır ve arka plandaki mikroservislere, Docker konteynerlerine veya statik dosya sunucularına yönlendirilmektedir.

---

## 2. Domain — Program Eşleşme Özeti

| Domain | Yönlendirme Türü | Hedef (Yerel Port / Dizin) | Yayındaki Program & Teknoloji | Güvenlik / Yetki |
| :--- | :--- | :--- | :--- | :--- |
| **erdogan.kim** | Reverse Proxy | `127.0.0.1:59423` | **n8n Workflow Automation** (Docker: `saas-n8n`) | HTTP Basic Auth (`erdogan`) |
| **www.erdogan.kim** | Kalıcı Yönlendirme | `https://erdogan.kim` | 301 Permanent Redirect | Otomatik HTTPS |
| **console.erdogan.kim** | Reverse Proxy | `127.0.0.1:7681` | **Antigravity Web Console** (`ttyd` + `tmux` - Systemd) | HTTP Basic Auth (`erdogan`) |
| **ai.erdogan.kim** | Reverse Proxy | `127.0.0.1:4747` | **Ofis — AI Dijital Ajan Platformu** (Node.js - Systemd) | HTTP Basic Auth (`erdogan`) |
| **oto.erdogan.kim** | Reverse Proxy + Static | `127.0.0.1:3000` & `:8000` | **Aras Otomotiv Yönetim Portalı** (Next.js + FastAPI) | Genel Yayın / Uygulama Girişi |
| **test.erdogan.kim** | Static + Reverse Proxy | `/opt/saas/apps/arasotomotiv` & `:8000` | **Aras Otomotiv Test & Tanıtım Vitrini** (Static + API) | Genel Yayın |

---

## 3. Domain Bazında Detaylı Yapılandırma ve Servis Analizi

### 3.1. `erdogan.kim` & `www.erdogan.kim`
- **Uygulama:** **n8n İş Akışı ve Entegrasyon Motoru**
- **Çalışma Şekli:** Docker konteyneri (`saas-n8n`, İmaj: `docker.n8n.io/n8nio/n8n:latest`).
- **Port:** Konteyner içi `5678` portu, host üzerinde `127.0.0.1:59423` portuna bağlıdır.
- **Proxy Davranışı:** Caddy üzerinden `127.0.0.1:59423` adresine yönlendirilir. Kesintisiz akış için `flush_interval -1` ayarı etkindir.
- **Erişim Güvenliği:** HTTP Basic Auth koruması mevcuttur.
- **`www` Yönlendirmesi:** `www.erdogan.kim` adresine gelen tüm istekler doğrudan kalıcı (301) yönlendirmeyle `https://erdogan.kim` adresine aktarılır.

### 3.2. `console.erdogan.kim`
- **Uygulama:** **Antigravity Web Konsolu (ttyd Terminal)**
- **Çalışma Şekli:** Systemd servisi ([agy-web-console.service](file:///etc/systemd/system/agy-web-console.service)).
- **Port:** `127.0.0.1:7681`
- **Komut:** `/usr/local/bin/ttyd` üzerinden `/usr/local/bin/agy-console-session.sh` oturumu çalıştırılmaktadır.
- **Erişim Güvenliği:** HTTP Basic Auth korumalıdır. Web tarayıcısı üzerinden doğrudan CLI ortamına güvenli erişim sağlar.

### 3.3. `ai.erdogan.kim`
- **Uygulama:** **Ofis — Dijital Ajan Yönetim ve Orkestrasyon Sistemi**
- **Çalışma Şekli:** Systemd servisi ([agy-ofis.service](file:///etc/systemd/system/agy-ofis.service)).
- **Dizin:** [/opt/saas/apps/ofis/server.js](file:///opt/saas/apps/ofis/server.js) (Node.js Express / Web UI & API).
- **Port:** `127.0.0.1:4747`
- **Proxy Davranışı:** Caddy üzerinden `flush_interval -1` ile SSE (Server-Sent Events) akışı destekli tersine proxy.
- **Erişim Güvenliği:** HTTP Basic Auth korumalıdır.

### 3.4. `oto.erdogan.kim`
- **Uygulama:** **Aras Otomotiv — Servis Yönetim ve Takip Portalı (Canlı)**
- **Bileşen Dağılımı:**
  - **Kök İstekler (`/` ve `/login*`):** Otomatik olarak `/yonetim` yoluna 307 geçici yönlendirmesi yapılır.
  - **Yönetim Portalı (Ana Arayüz & BFF):** Diğer tüm yollar Docker üzerindeki `saas_aras_web` konteynerine (`127.0.0.1:3000` - Next.js / Node 22) iletilir.
  - **API İstekleri (`/api/*`, `/docs*`, `/redoc*`, `/openapi.json`, `/uploads/*`):** Docker üzerindeki `saas_aras_api` konteynerine (`127.0.0.1:8000` - FastAPI / Python 3.11) iletilir.
  - **AI ve Sipariş Uç Noktaları (`/api/ai/*`, `/api/orders*`):** `127.0.0.1:3000` portundaki web katmanına yönlendirilir.
  - **Statik Sayfalar (`/is-emirleri.html`, `/stok.html`, `/detay.html`):** Doğrudan [/opt/saas/apps/arasotomotiv/yonetim](file:///opt/saas/apps/arasotomotiv/yonetim) dizininden Caddy `file_server` modülüyle sunulur.

### 3.5. `test.erdogan.kim`
- **Uygulama:** **Aras Otomotiv — Test & Vitrin Ortamı**
- **Bileşen Dağılımı:**
  - **Ana Vitrin (Kök İstekler):** Doğrudan statik dosya sunucusu olarak [/opt/saas/apps/arasotomotiv](file:///opt/saas/apps/arasotomotiv) dizininden sunulur (`try_files {path} {path}/ /index.html`).
  - **API İstekleri:** `oto.erdogan.kim` ile aynı şekilde backend servislerine (`127.0.0.1:8000` ve `127.0.0.1:3000`) yönlendirilir.

---

## 4. Dış Domain'e Bağlı Olmayan / Dahili Çalışan Servisler

Sunucu üzerinde aktif olarak çalışan ancak doğrudan Caddyfile üzerinden bir dış domain altına yönlendirilmemiş diğer kritik servisler şunlardır:

1. **`bab_web_assistant` (Port: `127.0.0.1:3300`)**
   - **Konum:** [/opt/saas/apps/bab-web](file:///opt/saas/apps/bab-web)
   - **Durum:** Docker konteyneri olarak ayakta (Up 3 saat). Bab Web Asistanı (React + Vite + Express).
   - **Not:** Şu an Caddyfile'da aktif bir domain kuralı atanmamıştır, yerel port olarak dinlemededir.

2. **`saas_postgres` (PostgreSQL 17 Veritabanı)**
   - **Konum:** [/opt/saas/postgres](file:///opt/saas/postgres)
   - **Durum:** Docker konteyneri (`postgres-postgres-1`).
   - **Ağ:** Dış porta kapalıdır; Docker iç ağı üzerinden `saas_aras_api` ve diğer servislere hizmet verir.

3. **`agy-telegram-bot.service` (Telegram Arka Plan Botu)**
   - **Konum:** [/opt/saas/telegram/bot.py](file:///opt/saas/telegram/bot.py)
   - **Durum:** Systemd servisi olarak aktif çalışmaktadır (`@erdogankimbot`). Web portu açmaz, Telegram API ile haberleşir.

---

## 5. Sunucu Aktif Port Haritası

| Port / Protokol | Dinleyen Süreç | İlişkili Program / Rol |
| :--- | :--- | :--- |
| `*:80 (tcp)` | `caddy` (PID: 786) | HTTP trafiği ve HTTPS yönlendirme |
| `*:443 (tcp/udp)` | `caddy` (PID: 786) | HTTPS & HTTP/3 QUIC (Aktif SSL Sertifikaları) |
| `127.0.0.1:2019 (tcp)` | `caddy` (PID: 786) | Caddy Admin API |
| `127.0.0.1:4747 (tcp)` | `node` (PID: 44189) | Ofis AI Web Paneli (`ai.erdogan.kim`) |
| `127.0.0.1:7681 (tcp)` | `ttyd` (PID: 779) | Web Terminal Konsolu (`console.erdogan.kim`) |
| `127.0.0.1:59423 (tcp)` | `docker-proxy` (`saas-n8n`) | n8n Entegrasyon Motoru (`erdogan.kim`) |
| `127.0.0.1:3000 (tcp)` | `docker-proxy` (`saas_aras_web`) | Aras Otomotiv Next.js Frontend / BFF |
| `127.0.0.1:8000 (tcp)` | `docker-proxy` (`saas_aras_api`) | Aras Otomotiv FastAPI Python Backend |
| `127.0.0.1:3300 (tcp)` | `docker-proxy` (`bab_web_assistant`) | Bab Web Asistanı (Dahili) |
| `*:22 (tcp)` | `sshd` (PID: 858) | SSH Güvenli Kabuk Servisi |

---

## 6. Sonuç ve Değerlendirme

Sistemdeki tüm web yayınları modern ve güvenli bir tersine proxy mimarisiyle Caddy arkasında toplanmıştır. Hassas yönetim ekranları (`erdogan.kim`, `console.erdogan.kim`, `ai.erdogan.kim`) HTTP Basic Auth ile korunmaktadır. Servisler Docker ve systemd mimarileriyle izole edilmiş olup sağlıklı bir şekilde çalışmaktadır.
