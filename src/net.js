// ---------------------------------------------------------------------------
// net.js — serverless peer-to-peer transport (Trystero / WebRTC).
//
// This module is loaded LAZILY (dynamic import) only when a player chooses
// "Play with Friends", so single-player never depends on it or on the network.
// There is no server: peers connect browser-to-browser; free public relays are
// used only for the initial handshake. See plan: free, host-authoritative co-op.
// ---------------------------------------------------------------------------
// NOTE: the old `trystero` package was renamed to `@trystero-p2p`; the old
// path is now an empty deprecation stub (exports nothing), so we use the new one.
import { joinRoom, selfId } from 'https://esm.sh/@trystero-p2p/torrent@0.25.2';

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

    // @trystero-p2p makeAction returns { send, onMessage, onReceiveProgress }, where
    // onMessage is an ASSIGNABLE accessor (action.onMessage = handler), not a call.
    const st = room.makeAction('st');   // per-player transform/cosmetics
    const wd = room.makeAction('wd');    // host world snapshot (NPCs/boss)
    const ev = room.makeAction('ev');    // discrete events (combat etc.)
    _send = { st: st.send, wd: wd.send, ev: ev.send };

    // Key player state by the sender's OWN id stamped into the payload (_id), not by
    // the transport's `peer` arg — that arg isn't a stable per-sender key here, which
    // otherwise makes every message look like a new player (avatars pile up forever).
    st.onMessage = (data, peer) => {
      const id = (data && data._id) || peer;
      if (data) data._t = performance.now();
      _lastState.set(id, data);
      _cbs.player(id, data);
    };
    wd.onMessage = (data, peer) => _cbs.world(peer, data);
    ev.onMessage = (data, peer) => _cbs.event(peer, data);

    room.onPeerJoin = (id) => { _peers.add(id); recomputeHost(); _cbs.peerjoin(id); };
    room.onPeerLeave = (id) => { _peers.delete(id); _lastState.delete(id); recomputeHost(); _cbs.peerleave(id); };

    recomputeHost();
    this.connected = true;
  },

  // each peer broadcasts its own player state (transform + cosmetics), stamped
  // with our stable id so receivers can key by sender reliably
  sendPlayer(data) { if (_send.st) _send.st({ ...data, _id: selfId }); },

  // drop players we haven't heard from in `maxAge` ms (left / timed out).
  // returns the removed ids so callers can tear down their avatars.
  prunePlayers(maxAge = 3000) {
    const now = performance.now(); const gone = [];
    for (const [id, d] of _lastState) if (now - (d._t || 0) > maxAge) { _lastState.delete(id); gone.push(id); }
    return gone;
  },
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
