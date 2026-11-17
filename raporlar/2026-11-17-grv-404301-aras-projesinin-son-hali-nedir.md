# Aras Otomotiv (Aras Service) Projesi Güncel Durum Raporu

**Tarih:** 17 Kasım 2026  
**Raporlayan:** Genel Müdür  
**Muhatap (Patron):** Mustafa  
**Görev ID:** GRV-404301  
**İlgili Proje Klasörü:** [/opt/saas/apps/arasotomotiv](file:///opt/saas/apps/arasotomotiv)  

---

## 1. Yönetici Özeti

Aras Otomotiv (**Aras Service / Volvo Özel Servis Yönetim Ekosistemi**), geleneksel araç servis süreçlerini dijitalleştiren; araç kabul, 6 lift canlı atölye telemetrisi, iş emirleri, parça stoğu ve müşteri şeffaflık portalını içeren uçtan uca bir SaaS platformudur.

Yapılan detaylı altyapı, Git sürüm geçmişi, Docker servisleri ve ağ yönlendirme analizleri neticesinde:
- **Genel Durum:** Proje tamamen çalışır (production live) ve kararlı durumdadır.
- **Git Durumu:** `main` dalı `origin/main` ile tam senkrondur, çalışma ağacı temizdir (uncommitted değişiklik bulunmamaktadır). Son commit **15 Kasım 2026** tarihlidir (`7d03a08`).
- **Canlı Yayın & Erişim:** Sistem [Caddyfile](file:///etc/caddy/Caddyfile) üzerinden otomatik HTTPS ile **`oto.erdogan.kim`** (yönetim portalı) ve **`test.erdogan.kim`** (vitrin & API dokümantasyonu) adreslerinde yayındadır.
- **Çalışma Durumu:** Arka planda Docker üzerinde çalışan Next.js web sunucusu (`saas_aras_web`) ve FastAPI backend sunucusu (`saas_aras_api`) aktiftir ve sağlıklı (healthy) yanıt vermektedir.

---

## 2. Mimari Bileşenler ve Çalışma Durum Tablosu

| Bileşen | Teknoloji / Çatı | Konteyner / Süreç | Port / Dizin | Canlı Adres / Yönlendirme | Durum |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Yönetim & Müşteri Web Portalı** | Next.js 16 / React 19 / Tailwind | `saas_aras_web` (Node 22) | `127.0.0.1:3000` <br>[web](file:///opt/saas/apps/arasotomotiv/web) | `https://oto.erdogan.kim` <br>(Kök istek `/yonetim`'e yönlendirilir) | Aktif (200 OK) |
| **Merkezi REST API & AI Motoru** | Python FastAPI / Uvicorn | `saas_aras_api` (Python 3) | `127.0.0.1:8000` <br>[backend](file:///opt/saas/apps/arasotomotiv/backend) | `https://oto.erdogan.kim/api` <br>`https://test.erdogan.kim/docs` | Aktif (Healthy) |
| **Veri Depolama & Kalıcılık** | Paylaşılan JSON Veritabanı | Ortak Docker Volume (`/data`) | [aras_db.json](file:///opt/saas/apps/arasotomotiv/data/aras_db.json) | Web ve Backend ortak erişir | Aktif (Kalıcı) |
| **Mobil Uygulama (Aras Mobil)** | Flutter (Dart SDK ^3.12) | İstemci Kaynak Kodu | [mobile](file:///opt/saas/apps/arasotomotiv/mobile) | Usta ve Yönetici çift modlu mimari | Kod tabanı hazır |
| **Statik Tanıtım Vitrini** | HTML5 / CSS3 / Vanilla JS | Caddy File Server | [index.html](file:///opt/saas/apps/arasotomotiv/index.html) | `https://test.erdogan.kim` | Aktif |

---

## 3. Modül ve Fonksiyonel Yetenek Durumu

### 3.1. Yönetim Portalı (`/yonetim`)
- **Dosya:** [page.tsx](file:///opt/saas/apps/arasotomotiv/web/src/app/yonetim/page.tsx)
- **Hızlı Araç Kabul (Fast Admission):** Plaka sorgulama, otomatik müşteri eşleştirme, çoklu araç seçimi, did-you-mean servis otomatik tamamlama, kaporta durumu ve görsel yükleme özellikleri sorunsuz çalışmaktadır.
- **6 Lift Canlı Takip Paneli:** Lift doluluğu, devam eden iş emri, sorumlu usta ve kalan süre telemetrisi tek ekrandan izlenebilmektedir.
- **İş Emirleri & Aşamalar:** 5 aşamalı iş akışı (Kabul -> Teşhis/Ekspertiz -> Mekanik Onarım -> Test & Kalite Kontrol -> Teslime Hazır).
- **Yedek Parça Stok Modülü:** OEM kodlu parça arama, stok miktarı ve anlık iş emrine parça tahsis mekanizması mevcuttur.

### 3.2. Müşteri Şeffaflık Portalı (`/musteri-portali`)
- **Dosya:** [page.tsx](file:///opt/saas/apps/arasotomotiv/web/src/app/musteri-portali/page.tsx)
- Araç sahiplerinin plaka ile giriş yaparak araçlarının hangi aşamada olduğunu (liftte mi, parça bekliyor mu, testte mi), yapılan işlemleri ve parça/işçilik kalemlerini canlı takip edebildiği modern arayüz aktiftir.

### 3.3. Yapay Zekâ (AI) ve Teşhis Servisleri
- **Plaka OCR:** Araç fotoğrafından plaka okuma (`/api/ai/plate-ocr`).
- **Dış Ekspertiz / Hasar Tespiti:** Araç kabul fotoğraflarındaki hasarları tespit eden analiz servisi (`/api/ai/exterior-inspect`).
- **Gösterge Paneli Analizi:** Kadran fotoğrafından anlık KM, yakıt seviyesi ve yanan arıza ikaz lambalarını otomatik ayrıştıran servis (`/api/ai/dashboard-inspect`).
- **VIDA / DTC Hata Çözümü:** Volvo diagnostik arıza kodlarını analiz edip Türkçe teknik çözüm adımları sunan modül (`/api/dtc`).

### 3.4. Mimari Sadeleştirme & Arşiv Notu
- Daha önce prototip olarak geliştirilen OpenAI Realtime tabanlı sesli asistan / bas-konuş sistemi, sanayi ortamındaki gürültü ve saha kullanım zorlukları göz önüne alınarak 11-12 Kasım tarihlerinde arşiv klasörüne ([archive/voice_assistant](file:///opt/saas/apps/arasotomotiv/archive)) taşınmıştır.
- Yerine atölye tabletlerinde tek dokunuşla çalışan, hızlı ve hatasız giriş sağlayan "Hızlı Araç Kabul" ekranı entegre edilmiştir.

---

## 4. Veritabanı ve Güncel Veri Durumu

Paylaşımlı veri katmanı olan [aras_db.json](file:///opt/saas/apps/arasotomotiv/data/aras_db.json) dosyasının güncel veri dökümü şöyledir:

| Veri Tipi | Kayıt Sayısı | Açıklama |
| :--- | :--- | :--- |
| **Müşteriler (Customers)** | 3 Kayıt | Çoklu araç tanımlı müşteri kayıtları |
| **Liftler (Lifts)** | 6 Lift | LİFT 01 - LİFT 06 (Tümü aktif ve telemetriye hazır) |
| **OEM Yedek Parçalar** | 6 Kalem | Yağ filtresi, ön/arka balatalar, polen filtresi, Castrol yağ vb. |
| **İş Emirleri (Work Orders)** | 4 İş Emri | Gerçek kabul akışı test edilmiş kayıtlar (`WO-2026-8841` .. `8844`) |

---

## 5. Son Yapılan Geliştirmeler (15 Kasım 2026)

Git geçmişine göre projeye uygulanan en son optimizasyonlar:
1. **Veritabanı Kalıcılığı:** Hızlı kabul ekranından girilen yeni araçların bellek yerine kalıcı olarak [aras_db.json](file:///opt/saas/apps/arasotomotiv/data/aras_db.json)'a yazılması sağlandı.
2. **Çoklu Araç & Müşteri Arama:** Müşteri adına veya telefonuna göre kayıtlı tüm araçları getiren modal ve akıllı seçim eklendi.
3. **Servis Tamamlama:** Eksik veya yanlış yazılan servis kalemleri için akıllı öneri desteği getirildi.
4. **UX İyileştirmeleri:** Fotoğraf silme butonları netleştirildi; arayüzde kalan varsayılan test plakası (34 VR 8920) ve sahte veriler sıfırlandı.
5. **Konteyner Volume Düzeltmesi:** [backend/compose.yaml](file:///opt/saas/apps/arasotomotiv/backend/compose.yaml) ve [web/compose.yaml](file:///opt/saas/apps/arasotomotiv/web/compose.yaml) dosyalarında paylaşılan `/data` dizini bağlanarak veri tutarsızlıkları tamamen giderildi.

---

## 6. Genel Müdür Değerlendirmesi ve Sonraki Adımlar

- **Altyapı Sağlığı:** Sistem kesintisiz çalışmaktadır; web ve API servisleri stabildir.
- **Mobil Uygulama:** [mobile](file:///opt/saas/apps/arasotomotiv/mobile) altındaki Flutter uygulamasının canlı REST API (`oto.erdogan.kim/api`) ile uçtan uca saha testlerinin yapılması ve APK/iOS derleme paketlerinin hazırlanması önerilir.
- **Yedekleme:** [aras_db.json](file:///opt/saas/apps/arasotomotiv/data/aras_db.json) dosyasının günlük olarak otomatik yedeklenmesi (n8n veya cron üzerinden) güvenlik açısından faydalı olacaktır.
