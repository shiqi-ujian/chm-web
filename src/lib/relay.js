'use strict';
// relay.js — combatmap 在线房间的「服务器权威」hub（服务器侧）。
//
// 架构：服务器是房间的唯一权威。它持有 room.state（不透明地图对象）+ room.perms（权限），
//   - DM 通过「sync」发布/更新权威全量状态（初始建图、载入/重置地图、及 DM 侧地形/迷雾等结构改动）；
//   - 一切高频实时改动（token / 玩家绘制）走**增量**，服务器按权限校验后应用到自己的 state 并广播；
//   - 新加入/重连成员由服务器下发 `model`（权威全量状态），不依赖 DM 正在广播；
//   - 玩家只能改「自己拥有」的 token、只能增删改「自己画」的 shape/line；地形/迷雾/DM层仅 DM。
//
// 协议（JSON 文本帧）：
//   client→server  { type:'join', room, role, name, id }
//   server→client  { type:'joined', id, room }
//   server→client  { type:'model', data }          // 服务器权威全量状态（加入/重连时下发）
//   server→client  { type:'roster', members }       // 成员名单
//   server→client  { type:'settings', perms }       // GM 权限（DM 下发）
//   client→server  { type:'sync', data }            // DM 发布权威全量状态
//   client→server  { type:'leave' } / { type:'ping' } → pong
//   增量：tokenEdit/tokenPlace/tokenDelete/shapeDraw/shapeEdit/shapeDelete/
//         lineDraw/lineEdit/lineDelete/fogEdit/cellEdit（服务器应用并广播给其它成员）
const { WebSocketServer } = require('ws');

function sanitizeRoom(s) {
  s = String(s || '').trim().toLowerCase();
  s = s.replace(/[^a-z0-9-]/g, '');
  return s.slice(0, 48);
}
function genId() {
  try { return require('crypto').randomBytes(6).toString('hex'); } catch (e) { return 'n' + Math.random().toString(36).slice(2, 10); }
}
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

// —— 增量字段白名单（与客户端一致）——
const TOKEN_FIELDS = new Set(['x','y','w','h','rotation','name','kind','icon','color','hp','maxHp','tempHp','ac','speed','notes','status','imgData','img','layer','sightRadius','visionSource','visible']);
const SHAPE_FIELDS = new Set(['x','y','w','h','length','spread','angle','fill','fillAlpha','stroke','strokeWidth','dash','name','layer']);
const LINE_FIELDS = new Set(['x1','y1','x2','y2','color','width','dash','name','layer']);
const DEFAULT_PERMS = { canMove: true, canPlace: true, canEdit: true, canDelete: true, canDraw: true, canErase: true };

function createRelay(httpServer, opts = {}) {
  const path = opts.path || '/ws';
  const wss = new WebSocketServer({ server: httpServer, path });
  const rooms = new Map(); // roomId -> { members: Map<ws,{id,name,role}>, state, perms }

  function roomStream(room) {
    let r = rooms.get(room);
    if (!r) { r = { members: new Map(), state: null, perms: { ...DEFAULT_PERMS } }; rooms.set(room, r); }
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
      ws._room = null; ws._member = null;
      broadcast(room, { type: 'roster', members: roster(room) });
      if (r.members.size === 0) rooms.delete(room);
    }
  }

  /** 把一个增量应用进授权 state；返回 true=应用成功(需广播)，false=拒绝 */
  function applyDelta(state, msg, role, memberId) {
    const isPlayer = role === 'player';
    switch (msg.type) {
      case 'tokenEdit': {
        const tk = (state.tokens || []).find((t) => t.id === msg.id);
        if (!tk) return false;
        if (isPlayer) { if (msg.owner !== memberId || tk.ownerId !== memberId) return false; } // 只能改自己拥有的
        for (const k in (msg.patch || {})) if (TOKEN_FIELDS.has(k)) tk[k] = msg.patch[k];
        return true;
      }
      case 'tokenPlace': {
        if (!state.tokens) state.tokens = [];
        if (isPlayer && msg.owner !== memberId) return false; // 玩家只能放置/归属自己的
        const tk = clone(msg.token) || {};
        tk.ownerId = (isPlayer ? memberId : (msg.owner || tk.ownerId || ''));
        if (!state.tokens.some((t) => t.id === tk.id)) state.tokens.push(tk);
        return true;
      }
      case 'tokenDelete': {
        const tk = (state.tokens || []).find((t) => t.id === msg.id);
        if (!tk) return false;
        if (isPlayer) { if (msg.owner !== memberId || tk.ownerId !== memberId) return false; } // 只能删自己拥有的
        const idx = state.tokens.findIndex((t) => t.id === msg.id);
        if (idx >= 0) state.tokens.splice(idx, 1);
        return true;
      }
      case 'shapeDraw': {
        if (!state.shapes) state.shapes = [];
        const s = clone(msg.shape) || {};
        s.author = (isPlayer ? memberId : (msg.author || s.author || ''));
        if (!state.shapes.some((x) => x.id === s.id)) state.shapes.push(s);
        return true;
      }
      case 'shapeEdit': {
        const s = (state.shapes || []).find((x) => x.id === msg.id);
        if (!s) return false;
        if (isPlayer) { if (msg.author !== memberId || s.author !== memberId) return false; } // 只能改自己画的
        for (const k in (msg.patch || {})) if (SHAPE_FIELDS.has(k)) s[k] = msg.patch[k];
        return true;
      }
      case 'shapeDelete': {
        const s = (state.shapes || []).find((x) => x.id === msg.id);
        if (!s) return false;
        if (isPlayer) { if (msg.author !== memberId || s.author !== memberId) return false; } // 只能删自己画的
        const idx = state.shapes.findIndex((x) => x.id === msg.id);
        if (idx >= 0) state.shapes.splice(idx, 1);
        return true;
      }
      case 'lineDraw': {
        if (!state.freeLines) state.freeLines = [];
        const l = clone(msg.line) || {};
        l.author = (isPlayer ? memberId : (msg.author || l.author || ''));
        if (!state.freeLines.some((x) => x.id === l.id)) state.freeLines.push(l);
        return true;
      }
      case 'lineEdit': {
        const l = (state.freeLines || []).find((x) => x.id === msg.id);
        if (!l) return false;
        if (isPlayer) { if (msg.author !== memberId || l.author !== memberId) return false; } // 只能改自己画的
        for (const k in (msg.patch || {})) if (LINE_FIELDS.has(k)) l[k] = msg.patch[k];
        return true;
      }
      case 'lineDelete': {
        const l = (state.freeLines || []).find((x) => x.id === msg.id);
        if (!l) return false;
        if (isPlayer) { if (msg.author !== memberId || l.author !== memberId) return false; } // 只能删自己画的
        const idx = state.freeLines.findIndex((x) => x.id === msg.id);
        if (idx >= 0) state.freeLines.splice(idx, 1);
        return true;
      }
      case 'fogEdit': { // 只有 DM
        if (isPlayer) return false;
        if (!state.fog) state.fog = {};
        // 值 falsy ⇒ 揭示（删除该格战雾）；truthy ⇒ 遮蔽
        for (const k in (msg.cells || {})) { if (msg.cells[k]) state.fog[k] = 1; else delete state.fog[k]; }
        return true;
      }
      case 'cellEdit': { // 只有 DM
        if (isPlayer) return false;
        if (!state.combatData) state.combatData = {};
        const key = String(msg.q) + ',' + String(msg.r);
        const cur = state.combatData[key] || {};
        for (const k in (msg.patch || {})) cur[k] = msg.patch[k];
        state.combatData[key] = cur;
        return true;
      }
      default: return false;
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
        let memberId = '';
        if (typeof msg.id === 'string') {
          const rawId = msg.id.trim().toLowerCase();
          if (/^[a-z0-9-]{1,32}$/.test(rawId)) {
            memberId = rawId;
            const used = new Set(Array.from(r.members.values()).map((m) => m.id));
            if (used.has(memberId)) memberId = memberId.slice(0, 24) + '-' + genId().slice(0, 4);
          }
        }
        if (!memberId) memberId = genId();
        const member = { id: memberId, name: String(msg.name || '').slice(0, 16), role: msg.role === 'dm' ? 'dm' : 'player' };
        leave(ws);
        ws._room = room; ws._member = member;
        r.members.set(ws, member);
        send(ws, { type: 'joined', id: member.id, room });
        // 权威状态 + 权限下发（服务器持有，不依赖 DM 正在广播）
        if (r.state) send(ws, { type: 'model', data: clone(r.state) });
        send(ws, { type: 'settings', perms: { ...r.perms } });
        broadcast(room, { type: 'roster', members: roster(room) });
        return;
      }

      if (msg.type === 'leave') { leave(ws); return; }
      if (msg.type === 'ping') { send(ws, { type: 'pong', ts: Date.now() }); return; }

      // —— 权威状态 / 增量 ——
      const room = ws._room;
      const r = (room && rooms.get(room)) || null;
      if (!r) return;
      const role = ws._member ? ws._member.role : 'player';

      if (msg.type === 'sync') {
        // 仅 DM 可发布权威全量
        if (role !== 'dm') return;
        r.state = clone(msg.data) || {};
        if (!r.state.tokens) r.state.tokens = [];
        if (!r.state.shapes) r.state.shapes = [];
        if (!r.state.freeLines) r.state.freeLines = [];
        broadcast(room, { type: 'model', data: clone(r.state) }, ws);
        return;
      }
      if (msg.type === 'settings') {
        if (role !== 'dm') return;
        r.perms = Object.assign({ ...DEFAULT_PERMS }, msg.perms || {});
        broadcast(room, { type: 'settings', perms: { ...r.perms } }, ws);
        return;
      }

      // 增量：应用到权威 state，成功后广播给其它成员
      if (!r.state) r.state = { tokens: [], shapes: [], freeLines: [] }; // 尚无状态时先给空壳
      const ok = applyDelta(r.state, msg, role, ws._member ? ws._member.id : '');
      if (ok) broadcast(room, msg, ws);
    });
    ws.on('close', () => leave(ws));
  });

  return { wss, rooms };
}

module.exports = { createRelay };
