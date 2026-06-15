// ---------------------------------------------------------------------------
// net.js — serverless peer-to-peer transport (Trystero / WebRTC).
//
// This module is loaded LAZILY (dynamic import) only when a player chooses
// "Play with Friends", so single-player never depends on it or on the network.
// There is no server: peers connect browser-to-browser; free public relays are
// used only for the initial handshake. See plan: free, host-authoritative co-op.
// ---------------------------------------------------------------------------
import { joinRoom, selfId } from 'https://esm.sh/trystero/torrent';

const APP_ID = 'stickbash_coop_v1';

let room = null;
let _host = false;
const _peers = new Set();
let _send = { st: null, wd: null, ev: null };
const _cbs = { player: () => {}, world: () => {}, event: () => {}, peerjoin: () => {}, peerleave: () => {}, host: () => {} };
const _lastState = new Map();   // peerId -> last player state we received

function sortedIds() { return [selfId, ..._peers].sort(); }

function recomputeHost() {
  const ids = sortedIds();
  const was = _host;
  _host = ids.length > 0 && ids[0] === selfId;
  if (was !== _host) _cbs.host(_host);
}

export const net = {
  connected: false,
  roomId: null,

  get isHost() { return _host; },
  get selfId() { return selfId; },
  get peers() { return [..._peers]; },
  get hostId() { return sortedIds()[0]; },
  get playerStates() { return _lastState; },

  connect(roomId) {
    if (room) return;
    this.roomId = roomId;
    room = joinRoom({ appId: APP_ID }, roomId);

    const [sendSt, getSt] = room.makeAction('st');   // per-player transform/cosmetics
    const [sendWd, getWd] = room.makeAction('wd');    // host world snapshot (NPCs/boss)
    const [sendEv, getEv] = room.makeAction('ev');    // discrete events (combat etc.)
    _send = { st: sendSt, wd: sendWd, ev: sendEv };

    getSt((data, peer) => { _lastState.set(peer, data); _cbs.player(peer, data); });
    getWd((data, peer) => _cbs.world(peer, data));
    getEv((data, peer) => _cbs.event(peer, data));

    room.onPeerJoin((id) => { _peers.add(id); recomputeHost(); _cbs.peerjoin(id); });
    room.onPeerLeave((id) => { _peers.delete(id); _lastState.delete(id); recomputeHost(); _cbs.peerleave(id); });

    recomputeHost();
    this.connected = true;
  },

  // each peer broadcasts its own player state (transform + cosmetics)
  sendPlayer(data) { if (_send.st) _send.st(data); },
  // host broadcasts the authoritative world snapshot
  sendWorld(data) { if (_send.wd) _send.wd(data); },
  // discrete event; `target` (a peerId or array) optional — omit to broadcast
  event(type, payload, target) {
    if (!_send.ev) return;
    const msg = { t: type, ...(payload || {}) };
    if (target) _send.ev(msg, target); else _send.ev(msg);
  },

  on(evt, cb) { if (evt in _cbs) _cbs[evt] = cb; },

  leave() {
    if (!room) return;
    try { room.leave(); } catch { /* ignore */ }
    room = null;
    this.connected = false;
    this.roomId = null;
    _peers.clear();
    _lastState.clear();
    _host = false;
  },
};
