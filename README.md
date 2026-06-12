# ASTRA FRONTIER — Multiplayer (10 Kişilik FFA)

## Yerel çalıştırma
```
npm install
npm start
```
Tarayıcıda `http://localhost:3000` aç. Aynı ağdaki başka cihazlar
(telefon dahil) `http://<bilgisayar-ip>:3000` adresiyle katılır.

## Mimari
- **server.js** — otoriter sunucu. 20 Hz sabit tick. Hareket hızı, ateş
  hızı (min 80 ms) ve isabet kararı (ray vs AABB, headshot > 1.35 m)
  tamamen sunucuda hesaplanır. İstemci yalnızca girdi yollar; hız hilesi
  ve atış spam'i sunucuda reddedilir.
- **public/index.html** — oyun istemcisi. Client-side prediction
  (kendi karakterin anında tepki verir), sunucu uzlaşması
  (sapma > 0.5 m yumuşak düzeltme, > 3 m anında ışınlama), uzak
  oyuncular için 120 ms geriden interpolasyon.
- Oda sistemi: oyuncu ilk boş odaya yerleştirilir, oda dolunca (10)
  otomatik yeni oda açılır.
- Sunucu yoksa (dosya doğrudan açılırsa) oyun offline gezinme moduna
  düşer — skor panelinde "offline" yazar.

## Yayına alma (özet)
1. VPS kirala (Hetzner CX22 ~€4/ay yeterli; Frankfurt = TR'den ~50 ms).
2. Node 20+ kur, projeyi kopyala, `npm install`.
3. Kalıcılık için pm2: `npm i -g pm2 && pm2 start server.js --name astra`.
4. Alan adı + Cloudflare proxy (DDoS koruması) + HTTPS reverse proxy
   (Caddy en kolayı). PWA kurulumu için HTTPS şart.

## Bilinçli eksikler (v0.1)
- Cephane/reload sunucuda doğrulanmıyor (kozmetik; ateş hızı limiti
  zaten sunucuda).
- Lag compensation yok — isabet, sunucunun o anki pozisyonlarına göre.
- Botlar ve pickup'lar multiplayer'da yok (tek oyunculu sürümde duruyor;
  sunucuya taşınmaları sonraki adım).
- Oyuncu-oyuncu çarpışması yok (iç içe geçilebilir).
