'use strict';
// relay.js — combatmap 在线房间的中继 hub（服务器侧）。
// 角色：房间成员管理 + 消息广播 + 缓存 DM 权威快照（供新加入/重连恢复）。
// WebSocket 挂在既有 http server 的 /ws 路径上（走 443/WSS，Caddy 直接反代，
// 无需额外开 TURN/NAT 端口）。不依赖公共信令，跨网络稳定。
//
// 协议（JSON 文本帧）：
//   client→server  { type:'join', room, role:'dm'|'player', name }
//   server→client  { type:'joined', id, room }          // 加入成功，返回本端 id
//   server→client  { type:'roster', members:[{id,name,role}] }
//   server→client  { type:'snapshot', data }            // 新加入/重连时补发 DM 权威快照
//   client→server  { type:'leave' }
//   client→server  { type:'ping' } → server→client { type:'pong', ts }
//   其它任意消息（如 { type:'snapshot', data }）→ 广播给房间内其它成员
const { WebSocketServer } = require('ws');

function sanitizeRoom(s) {
  s = String(s || '').trim().toLowerCase();
  s = s.replace(/[^a-z0-9-]/g, '');
  return s.slice(0, 48);
}

function genId() {
  let id = '';
  try { id = require('crypto').randomBytes(6).toString('hex'); } catch (e) { id = 'n' + Math.random().toString(36).slice(2, 10); }
  return id;
}

function createRelay(httpServer, opts = {}) {
  const path = opts.path || '/ws';
  const wss = new WebSocketServer({ server: httpServer, path });
  // roomId -> { members: Map<ws, member>, lastSnapshot: any|null }
  const rooms = new Map();

  function roomStream(room) {
    let r = rooms.get(room);
    if (!r) { r = { members: new Map(), lastSnapshot: null }; rooms.set(room, r); }
    return r;
  }
  function roster(room) {
    const r = rooms.get(room);
    if (!r) return [];
    return Array.from(r.members.values()).map((m) => ({ id: m.id, name: m.name, role: m.role }));
  }
  function send(ws, msg) {
    if (ws && ws.readyState === ws.OPEN) { try { ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ } }
  }
  function broadcast(room, msg, excludeWs) {
    const r = rooms.get(room);
    if (!r) return;
    const data = JSON.stringify(msg);
    for (const ws of r.members.keys()) {
      if (ws === excludeWs) continue;
      if (ws.readyState === ws.OPEN) { try { ws.send(data); } catch (e) { /* ignore */ } }
    }
  }
  function leave(ws) {
    const room = ws._room;
    const r = (room && rooms.get(room)) || null;
    if (r && ws._member && r.members.has(ws)) {
      r.members.delete(ws);
      ws._room = null;
      ws._member = null;
      broadcast(room, { type: 'roster', members: roster(room) });
      if (r.members.size === 0) rooms.delete(room);
    }
  }

  wss.on('connection', (ws) => {
    ws.on('error', (e) => { try { ws.close(); } catch (_) { /* ignore */ } });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!msg || !msg.type) return;

      if (msg.type === 'join') {
        const room = sanitizeRoom(msg.room);
        if (!room) { send(ws, { type: 'error', error: '房间名不能为空' }); return; }
        const r = roomStream(room);
        const member = {
          id: genId(),
          name: String(msg.name || '').slice(0, 16),
          role: msg.role === 'dm' ? 'dm' : 'player',
        };
        leave(ws); // 若已加入其它房间，先退出
        ws._room = room;
        ws._member = member;
        r.members.set(ws, member);
        send(ws, { type: 'joined', id: member.id, room });
        // 新加入者立即拿到 DM 权威快照（若有），避免干等 DM 重发
        if (r.lastSnapshot) send(ws, { type: 'snapshot', data: r.lastSnapshot });
        broadcast(room, { type: 'roster', members: roster(room) });
        return;
      }

      if (msg.type === 'leave') { leave(ws); return; }
      if (msg.type === 'ping') { send(ws, { type: 'pong', ts: Date.now() }); return; }

      // 其它消息（snapshot 等）：广播给房间内其它成员；DM 的 snapshot 缓存为权威快照
      const room = ws._room;
      const r = (room && rooms.get(room)) || null;
      if (!r) return;
      if (msg.type === 'snapshot' && msg.data && ws._member && ws._member.role === 'dm') {
        r.lastSnapshot = msg.data;
      }
      broadcast(room, msg, ws);
    });
    ws.on('close', () => leave(ws));
  });

  return { wss, rooms };
}

module.exports = { createRelay };
