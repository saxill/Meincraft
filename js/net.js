import { SEED } from './config.js';

// Online co-op over WebRTC data channels. PeerJS's free public broker is only
// used to introduce peers; gameplay traffic flows directly between browsers,
// so this works from a static host like GitHub Pages.
//
// Topology: the host is the hub. Clients send edits/positions to the host,
// which applies them and relays to everyone else. On join, the host sends its
// full edit list and clock so all players share one world.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const roomId = code => 'mineclone-' + SEED + '-' + code;

function randomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function createNet(h) {
  // h: { name, getTime, getEdits, onStatus, onInit, onEdit, onPos,
  //      onJoin, onLeave, onTime, onHostLost }
  const net = { active: false, hosting: false, code: null };
  let peer = null;
  const conns = new Map(); // host: peerId -> {conn, name}; client: 'host' -> {conn}

  function broadcast(msg, exceptId) {
    for (const [id, c] of conns) {
      if (id !== exceptId && c.conn.open) c.conn.send(msg);
    }
  }

  function toHost(msg) {
    const c = conns.get('host');
    if (c && c.conn.open) c.conn.send(msg);
  }

  function hostHandle(conn) {
    conn.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        const name = String(msg.name || 'player').slice(0, 16);
        // 1) PASSWORD GATE — reject before a single byte of world data is sent.
        //    (hello travels over the WebRTC data channel, which is DTLS-
        //    encrypted, so the password isn't exposed on the wire.)
        const pass = h.getPassword ? String(h.getPassword() || '') : '';
        if (pass && String(msg.pass || '') !== pass) {
          try { conn.send({ t: 'denied', reason: 'wrong password' }); } catch (e) {}
          setTimeout(() => { try { conn.close(); } catch (e) {} }, 250);
          return;
        }
        // 2) HOST APPROVAL — the joiner is admitted (and the world is sent)
        //    ONLY after the host explicitly allows the request. Until then
        //    they get nothing, and any edit/pos they send is ignored.
        const admit = () => {
          if (conns.has(conn.peer)) return;
          const others = [...conns].map(([id, c]) => ({ id, name: c.name }));
          others.push({ id: 'host', name: h.name() });
          conns.set(conn.peer, { conn, name });
          conn.send({ t: 'init', edits: h.getEdits(), time: h.getTime(), players: others });
          broadcast({ t: 'join', id: conn.peer, name }, conn.peer);
          h.onJoin(conn.peer, name);
        };
        const reject = () => {
          try { conn.send({ t: 'denied', reason: 'host denied the request' }); } catch (e) {}
          setTimeout(() => { try { conn.close(); } catch (e) {} }, 250);
        };
        if (h.approveJoin) h.approveJoin(name, conn.peer, ok => (ok ? admit() : reject()));
        else admit();
      } else if (msg.t === 'edit') {
        if (!conns.has(conn.peer)) return;   // un-admitted peer: ignore
        h.onEdit(msg);
        broadcast(msg, conn.peer);
      } else if (msg.t === 'pos') {
        if (!conns.has(conn.peer)) return;   // un-admitted peer: ignore
        const p = { t: 'pos', id: conn.peer, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw };
        h.onPos(p);
        broadcast(p, conn.peer);
      }
    });
    const drop = () => {
      if (!conns.delete(conn.peer)) return;
      broadcast({ t: 'leave', id: conn.peer });
      h.onLeave(conn.peer);
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  net.host = function (customCode) {
    if (peer) return;
    // Optional fixed room id (3–5 chars) so it can be "your" room every time;
    // otherwise a random code.
    const clean = String(customCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    const code = clean.length >= 3 ? clean : randomCode();
    h.onStatus('starting room…');
    peer = new Peer(roomId(code));
    peer.on('open', () => {
      net.active = true;
      net.hosting = true;
      net.code = code;
      h.onStatus('hosting room ' + code + ' — share the code with friends');
    });
    peer.on('connection', conn => conn.on('open', () => hostHandle(conn)));
    peer.on('error', err => {
      if (err.type === 'unavailable-id') { // code collision: roll a new one
        peer.destroy();
        peer = null;
        net.host();
      } else {
        h.onStatus('network error: ' + err.type);
      }
    });
  };

  net.join = function (code, password) {
    if (peer) return;
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (code.length < 3) { h.onStatus('enter the room code'); return; }
    const pass = String(password || '');
    h.onStatus('connecting to ' + code + '…');
    peer = new Peer();
    peer.on('error', err => {
      if (!net.active) h.onStatus('could not join: ' + err.type);
    });
    peer.on('open', () => {
      const conn = peer.connect(roomId(code), { reliable: true });
      conn.on('open', () => {
        conns.set('host', { conn, name: 'host' });
        conn.send({ t: 'hello', name: h.name(), pass });
        h.onStatus('waiting for the host to let you in…');
      });
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'denied') {
          try { peer.destroy(); } catch (e) {}
          peer = null;
          net.active = false;
          if (h.onDenied) h.onDenied(msg.reason || 'denied');
          return;
        }
        if (msg.t === 'init') {
          net.active = true;
          net.code = code;
          h.onInit(msg);
          h.onStatus('joined room ' + code);
        } else if (msg.t === 'edit') h.onEdit(msg);
        else if (msg.t === 'pos') h.onPos(msg);
        else if (msg.t === 'join') h.onJoin(msg.id, msg.name);
        else if (msg.t === 'leave') h.onLeave(msg.id);
        else if (msg.t === 'time') h.onTime(msg.time);
      });
      conn.on('close', () => {
        if (!net.active) return;
        net.active = false;
        h.onHostLost();
      });
    });
  };

  net.sendEdit = function (x, y, z, id) {
    if (!net.active) return;
    const msg = { t: 'edit', x, y, z, id };
    if (net.hosting) broadcast(msg);
    else toHost(msg);
  };

  net.sendPos = function (x, y, z, yaw) {
    if (!net.active) return;
    if (net.hosting) broadcast({ t: 'pos', id: 'host', x, y, z, yaw });
    else toHost({ t: 'pos', x, y, z, yaw });
  };

  // Keep everyone's day/night clock in sync
  setInterval(() => {
    if (net.hosting) broadcast({ t: 'time', time: h.getTime() });
  }, 10000);

  return net;
}
