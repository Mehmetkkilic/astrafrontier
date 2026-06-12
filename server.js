// =====================================================================
// ASTRA FRONTIER — Otoriter Multiplayer Sunucusu
// Oda başına maks 10 oyuncu, 20 Hz sabit tick, FFA deathmatch.
// İstemciye GÜVENİLMEZ: hareket, atış hızı ve isabet burada hesaplanır.
// =====================================================================
'use strict';

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------
// HARİTA COLLIDER'LARI — istemcideki addBox çağrılarıyla BİREBİR aynı
// ---------------------------------------------------------------------
const colliders = [];
function addBox(w, h, d, x, y, z, rotY) {
  const r = rotY || 0;
  const hx = (w * Math.abs(Math.cos(r)) + d * Math.abs(Math.sin(r))) / 2;
  const hz = (w * Math.abs(Math.sin(r)) + d * Math.abs(Math.cos(r))) / 2;
  colliders.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, maxY: y + h / 2 });
}

// Command Hub
addBox(16, 7, 12, 0, 3.5, -20);
addBox(17, 1, 13, 0, 7.5, -20);
addBox(6, 4, 1, 0, 2, -13.6);
addBox(4, 3.2, 0.4, 0, 1.6, -13.4);
addBox(10, 1.6, 0.6, 0, 6.2, -13.6);
// Merdiven
addBox(4, 0.5, 2, -8, 0.25, -14);
addBox(4, 1.0, 2, -8, 0.5, -16);
addBox(4, 1.5, 2, -8, 0.75, -18);
// Çevre duvarları
const wallDefs = [
  [40, 4, 2, -30, 2, -45], [40, 4, 2, 30, 2, -45],
  [40, 4, 2, -30, 2, 45], [40, 4, 2, 30, 2, 45],
  [2, 4, 40, -50, 2, -25], [2, 4, 40, -50, 2, 25],
  [2, 4, 40, 50, 2, -25], [2, 4, 40, 50, 2, 25]
];
for (const w of wallDefs) addBox(w[0], w[1], w[2], w[3], w[4], w[5]);
// Bariyerler
const barriers = [
  [-10, 5, 0.3], [-4, 8, 0], [4, 6, -0.2], [12, 10, 0.5],
  [-18, -5, 1.2], [18, -2, -0.8], [-6, 18, 0.1], [8, 20, -0.4],
  [22, 12, 0.9], [-24, 14, -0.3], [8, 32, 0.2], [-14, 28, 0.6]
];
for (const b of barriers) addBox(5, 1.6, 1, b[0], 0.8, b[1], b[2]);
// Sandıklar
const crates = [
  [-15, 1.25, 8, 2.5], [-15, 3.4, 8, 1.8], [-12.4, 1.0, 8.5, 2.0],
  [16, 1.25, 6, 2.5], [16, 1.0, 9, 2.0], [25, 1.5, -15, 3.0],
  [-28, 1.25, -8, 2.5], [-30, 1.0, -5, 2.0], [10, 1.0, 35, 2.0],
  [30, 1.25, 25, 2.5], [-35, 1.5, 20, 3.0], [5, 1.0, -35, 2.0],
  [-20, 1.25, -30, 2.5], [35, 1.0, -30, 2.0], [40, 1.25, 5, 2.5]
];
for (let i = 0; i < crates.length; i++) {
  const c = crates[i];
  addBox(c[3], c[3], c[3], c[0], c[1], c[2], (i * 0.7) % 1.2);
}
// Kum torbaları
function sandbagRow(x, z, len, rotY) {
  addBox(len, 0.5, 0.9, x, 0.25, z, rotY);
  addBox(len - 0.8, 0.5, 0.85, x, 0.72, z, rotY);
}
sandbagRow(14, -8, 6, 0.3);
sandbagRow(-12, -10, 5, -0.5);
sandbagRow(-2, 25, 7, 0.1);
sandbagRow(26, 0, 5, 1.1);
// Kule
addBox(3, 8, 3, -42, 4, -38);
addBox(4.5, 2, 4.5, -42, 9, -38);

const PLAYER_RADIUS = 0.5;
function collide(px, pz) {
  for (const c of colliders) {
    if (c.maxY < 0.6) continue;
    if (px > c.minX - PLAYER_RADIUS && px < c.maxX + PLAYER_RADIUS &&
        pz > c.minZ - PLAYER_RADIUS && pz < c.maxZ + PLAYER_RADIUS) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------
// OYUN SABİTLERİ — istemcideki değerlerle aynı
// ---------------------------------------------------------------------
const TICK_MS = 50;          // 20 Hz
const TICK_DT = TICK_MS / 1000;
const WALK_SPEED = 7;
const RUN_SPEED = 11.5;
const ACCEL = 12;
const FIRE_MIN_MS = 80;      // ~700 rpm üst sınırı (hız hilesi reddi)
const BODY_DMG = 34;
const HEAD_DMG = 100;
const RESPAWN_S = 3;
const REGEN_DELAY_S = 4;
const REGEN_RATE = 16;
const MAX_PLAYERS = 10;

const SPAWNS = [
  [0, 38], [-35, -28], [38, -24], [-30, 16], [24, 30], [18, -32], [-22, 2]
];
function randomSpawn() {
  return SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
}

// ---------------------------------------------------------------------
// ODALAR
// ---------------------------------------------------------------------
const rooms = new Map();   // roomId -> { id, players: Map<socketId, player> }
let roomSeq = 0;

function findRoom() {
  for (const r of rooms.values()) {
    if (r.players.size < MAX_PLAYERS) return r;
  }
  const r = { id: 'oda-' + (++roomSeq), players: new Map() };
  rooms.set(r.id, r);
  return r;
}

function makePlayer(id, name) {
  const sp = randomSpawn();
  return {
    id, name,
    x: sp[0], z: sp[1],
    vx: 0, vz: 0,
    yaw: 0,
    hp: 100, dead: false, respawnT: 0, sinceHit: 99,
    kills: 0, deaths: 0,
    lastFire: 0,
    input: { wx: 0, wz: 0, sp: false, yaw: 0 }
  };
}

// ---------------------------------------------------------------------
// BOTLAR — oda 4 kişiye tamamlanır, insan girdikçe bot çıkar
// ---------------------------------------------------------------------
const BOT_NAMES = ['Kartal', 'Şahin', 'Atmaca', 'Doğan', 'Akbaba', 'Pars', 'Çakır', 'Bora'];
const BOT_FILL = 4;
let botSeq = 0;

function makeBot() {
  const b = makePlayer('bot-' + (++botSeq), 'Bot-' + BOT_NAMES[botSeq % BOT_NAMES.length]);
  b.isBot = true;
  b.ai = {
    tx: 0, tz: 0,                 // devriye hedefi
    burstCd: 2 + Math.random() * 2, burstLeft: 0, shotT: 0,
    los: false, losT: 0,
    strafeT: Math.random() * 6,
    stuckT: 0, px: b.x, pz: b.z
  };
  pickPatrol(b);
  return b;
}
function pickPatrol(b) {
  b.ai.tx = -40 + Math.random() * 80;
  b.ai.tz = -38 + Math.random() * 76;
}

function humanCount(room) {
  let n = 0;
  for (const p of room.players.values()) if (!p.isBot) n++;
  return n;
}

function syncBots(room) {
  const humans = humanCount(room);
  const want = humans > 0 ? Math.max(0, BOT_FILL - humans) : 0;
  const bots = [];
  for (const p of room.players.values()) if (p.isBot) bots.push(p);
  while (bots.length < want && room.players.size < MAX_PLAYERS) {
    const b = makeBot();
    room.players.set(b.id, b);
    bots.push(b);
  }
  while (bots.length > want) {
    const b = bots.pop();
    room.players.delete(b.id);
    io.to(room.id).emit('left', { id: b.id });
  }
}

// Göz hizasında (1.55 m) yatay görüş hattı kontrolü
function losClear(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.001) return true;
  const ndx = dx / dist, ndz = dz / dist;
  for (const c of colliders) {
    if (c.maxY < 1.55) continue;   // göz hizasının altındaki engeller görüşü kesmez
    const t = rayAABB(ax, 1.55, az, ndx, 0, ndz, c.minX, 0, c.minZ, c.maxX, c.maxY, c.maxZ);
    if (t >= 0 && t < dist) return false;
  }
  return true;
}

function botFire(room, b, target, dist) {
  // Göğse nişan + mesafeyle artan sapma → isabet oranı doğal düşer
  const dx = target.x - b.x, dz = target.z - b.z;
  const spread = 0.02 + dist * 0.0012;
  b.yaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * spread * 2;
  const horiz = Math.max(0.5, Math.hypot(dx, dz));
  const pitch = Math.atan2(1.25 - 1.7, horiz) + (Math.random() - 0.5) * spread * 2;
  serverFire(room, b, pitch);
}

function botAI(b, room, dt) {
  const ai = b.ai;

  // Hedef: en yakın canlı oyuncu (insan veya bot — FFA)
  let best = null, bd = 1e9;
  for (const q of room.players.values()) {
    if (q === b || q.dead) continue;
    const d = Math.hypot(q.x - b.x, q.z - b.z);
    if (d < bd) { bd = d; best = q; }
  }

  // LOS her 4 tick'te bir (0.2 s) — maliyet dağıtımı
  ai.losT++;
  if (ai.losT >= 4) {
    ai.losT = 0;
    ai.los = !!best && bd < 48 && losClear(b.x, b.z, best.x, best.z);
  }
  if (!best) ai.los = false;

  let wx = 0, wz = 0, mag = 0;

  if (ai.los && best) {
    // SAVAŞ: yüzünü dön, mesafe koru, yanal salın, burst at
    const dx = best.x - b.x, dz = best.z - b.z;
    b.input.yaw = Math.atan2(-dx, -dz);
    ai.strafeT += dt;
    const s = Math.sin(ai.strafeT * 1.3);
    wx = (-dz / bd) * s; wz = (dx / bd) * s;
    if (bd > 20) { wx += dx / bd; wz += dz / bd; }
    else if (bd < 9) { wx -= dx / bd; wz -= dz / bd; }
    mag = 0.45;   // ~3.2 m/s

    if (ai.burstLeft > 0) {
      ai.shotT -= dt;
      if (ai.shotT <= 0) { botFire(room, b, best, bd); ai.burstLeft--; ai.shotT = 0.15; }
    } else {
      ai.burstCd -= dt;
      if (ai.burstCd <= 0) {
        ai.burstLeft = 3; ai.shotT = 0;
        ai.burstCd = 1.6 + Math.random() * 1.6;
      }
    }
  } else {
    // DEVRİYE
    const dxt = ai.tx - b.x, dzt = ai.tz - b.z;
    const dtg = Math.hypot(dxt, dzt);
    if (dtg < 2) pickPatrol(b);
    else {
      wx = dxt / dtg; wz = dzt / dtg;
      b.input.yaw = Math.atan2(-dxt, -dzt);
      mag = 0.35;   // ~2.4 m/s
    }
    // Takılma tespiti: pozisyon değişmiyorsa yeni hedef
    if (Math.hypot(b.x - ai.px, b.z - ai.pz) < 0.03) {
      ai.stuckT += dt;
      if (ai.stuckT > 0.6) { pickPatrol(b); ai.stuckT = 0; }
    } else ai.stuckT = 0;
  }

  // Hareket isteğini normalize edip yaz (sunucu hız sabitini uygular)
  const len = Math.hypot(wx, wz);
  if (len > 0.001) {
    b.input.wx = (wx / len) * mag;
    b.input.wz = (wz / len) * mag;
  } else {
    b.input.wx = 0; b.input.wz = 0;
  }
  b.input.sp = false;
  ai.px = b.x; ai.pz = b.z;
}

// ---------------------------------------------------------------------
// IŞIN (RAY) TESTLERİ — sunucu tarafı isabet kararı
// ---------------------------------------------------------------------
function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0, tmax = 300;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [minX, minY, minZ], mx = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
    } else {
      let ta = (mn[i] - o[i]) / d[i];
      let tb = (mx[i] - o[i]) / d[i];
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > tmin) tmin = ta;
      if (tb < tmax) tmax = tb;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

function serverFire(room, p, pitch) {
  const now = Date.now();
  if (now - p.lastFire < FIRE_MIN_MS) return;   // hız hilesi reddi
  p.lastFire = now;

  // Bakış yönü (istemci kamera matematiğiyle aynı: YXZ)
  const cp = Math.cos(pitch), spt = Math.sin(pitch);
  const dx = -Math.sin(p.yaw) * cp;
  const dy = spt;
  const dz = -Math.cos(p.yaw) * cp;
  const ox = p.x, oy = 1.7, oz = p.z;

  // En yakın duvar mesafesi
  let wallT = 300;
  for (const c of colliders) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, c.minX, 0, c.minZ, c.maxX, c.maxY, c.maxZ);
    if (t >= 0 && t < wallT) wallT = t;
  }

  // En yakın oyuncu isabeti (duvardan önce olmalı)
  let victim = null, victimT = wallT;
  for (const q of room.players.values()) {
    if (q === p || q.dead) continue;
    const t = rayAABB(ox, oy, oz, dx, dy, dz,
      q.x - 0.4, 0, q.z - 0.4, q.x + 0.4, 1.8, q.z + 0.4);
    if (t >= 0 && t < victimT) { victimT = t; victim = q; }
  }

  const endT = victim ? victimT : Math.min(wallT, 150);
  const shotEvt = {
    id: p.id,
    ox, oy: oy - 0.15, oz,
    ex: ox + dx * endT, ey: oy + dy * endT, ez: oz + dz * endT
  };
  // Atışı atan hariç odadaki herkese görsel iz gönder
  io.to(room.id).except(p.id).emit('shot', shotEvt);

  if (victim) {
    const hitY = oy + dy * victimT;
    const dmg = hitY > 1.35 ? HEAD_DMG : BODY_DMG;
    victim.hp -= dmg;
    victim.sinceHit = 0;
    io.to(victim.id).emit('dmg', { hp: Math.max(0, victim.hp) });
    const kill = victim.hp <= 0;
    io.to(p.id).emit('hitConfirm', { kill });
    if (kill) {
      victim.dead = true;
      victim.respawnT = RESPAWN_S;
      victim.deaths++;
      p.kills++;
      io.to(victim.id).emit('die', { by: p.name });
    }
  }
}

// ---------------------------------------------------------------------
// BAĞLANTI
// ---------------------------------------------------------------------
io.on('connection', (socket) => {
  let room = null;
  let player = null;

  socket.on('join', (d) => {
    if (player) return;
    const name = String((d && d.name) || 'Asker').slice(0, 14).replace(/[<>]/g, '');
    room = findRoom();
    player = makePlayer(socket.id, name);
    room.players.set(socket.id, player);
    socket.join(room.id);
    socket.emit('init', { id: socket.id, room: room.id });
    syncBots(room);
    console.log(`[+] ${name} → ${room.id} (${humanCount(room)} insan / ${room.players.size} toplam)`);
  });

  socket.on('in', (d) => {
    if (!player || !d) return;
    // Girdi temizliği: sayı olmayan / aşırı değerler reddedilir
    const wx = Number(d.wx), wz = Number(d.wz), yw = Number(d.yaw);
    if (!isFinite(wx) || !isFinite(wz) || !isFinite(yw)) return;
    const len = Math.hypot(wx, wz);
    const s = len > 1 ? 1 / len : 1;
    player.input.wx = wx * s;
    player.input.wz = wz * s;
    player.input.sp = !!d.sp;
    player.input.yaw = yw;
  });

  socket.on('fire', (d) => {
    if (!player || player.dead || !room || !d) return;
    let pitch = Number(d.pitch);
    if (!isFinite(pitch)) return;
    pitch = Math.max(-1.52, Math.min(1.52, pitch));
    const yw = Number(d.yaw);
    if (isFinite(yw)) player.yaw = yw;
    serverFire(room, player, pitch);
  });

  socket.on('disconnect', () => {
    if (room && player) {
      room.players.delete(socket.id);
      io.to(room.id).emit('left', { id: socket.id });
      console.log(`[-] ${player.name} ayrıldı (${humanCount(room)} insan kaldı)`);
      if (humanCount(room) === 0) rooms.delete(room.id);   // insansız oda kapanır
      else syncBots(room);
    }
  });
});

// ---------------------------------------------------------------------
// SABİT TICK — 20 Hz: hareket + yenilenme + respawn + snapshot
// ---------------------------------------------------------------------
setInterval(() => {
  for (const room of rooms.values()) {
    if (humanCount(room) === 0) { rooms.delete(room.id); continue; }

    // Bot zekası: girdi üretir, sonra herkesle aynı hareket kodundan geçer
    for (const p of room.players.values()) {
      if (p.isBot && !p.dead) botAI(p, room, TICK_DT);
    }

    for (const p of room.players.values()) {
      // Respawn
      if (p.dead) {
        p.respawnT -= TICK_DT;
        if (p.respawnT <= 0) {
          const sp = randomSpawn();
          p.x = sp[0]; p.z = sp[1];
          p.vx = 0; p.vz = 0;
          p.hp = 100; p.dead = false;
        }
        continue;
      }

      // Hareket — hız sabitleri SUNUCUDA (speed hack imkansız)
      p.yaw = p.input.yaw;
      const speed = p.input.sp ? RUN_SPEED : WALK_SPEED;
      const tx = p.input.wx * speed, tz = p.input.wz * speed;
      const k = Math.min(1, TICK_DT * ACCEL);
      p.vx += (tx - p.vx) * k;
      p.vz += (tz - p.vz) * k;

      const stuck = collide(p.x, p.z);
      const nx = p.x + p.vx * TICK_DT;
      if (stuck || !collide(nx, p.z)) p.x = nx;
      const nz = p.z + p.vz * TICK_DT;
      if (stuck || !collide(p.x, nz)) p.z = nz;
      p.x = Math.max(-48, Math.min(48, p.x));
      p.z = Math.max(-43, Math.min(43, p.z));

      // Can yenilenme
      p.sinceHit += TICK_DT;
      if (p.sinceHit > REGEN_DELAY_S && p.hp < 100) {
        p.hp = Math.min(100, p.hp + REGEN_RATE * TICK_DT);
      }
    }

    // Snapshot yayını
    const snap = {
      t: Date.now(),
      p: []
    };
    for (const p of room.players.values()) {
      snap.p.push({
        id: p.id, n: p.name,
        x: Math.round(p.x * 100) / 100,
        z: Math.round(p.z * 100) / 100,
        yaw: Math.round(p.yaw * 1000) / 1000,
        hp: Math.round(p.hp),
        k: p.kills, d: p.deaths,
        dead: p.dead ? 1 : 0
      });
    }
    io.to(room.id).emit('snap', snap);
  }
}, TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`ASTRA FRONTIER sunucusu çalışıyor → http://localhost:${PORT}`);
});
