import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || window.location.origin;

function api(path, options = {}) {
  const token = localStorage.getItem("ludo_token");
  return fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...options
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Request failed");
    return data;
  });
}

function Auth({ onLogin }) {
  const [signup, setSignup] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault(); setError("");
    try {
      const data = await api(signup ? "/api/auth/signup" : "/api/auth/login", { method: "POST", body: JSON.stringify(form) });
      localStorage.setItem("ludo_token", data.token);
      onLogin(data.user);
    } catch (e) { setError(e.message); }
  }

  return <div className="auth-shell">
    <div className="auth-card">
      <div className="logo">🎲 LUDO</div>
      <h1>{signup ? "Create your account" : "Welcome back"}</h1>
      <p className="muted">Play Ludo online with friends or challenge the computer.</p>
      <form onSubmit={submit}>
        {signup && <input placeholder="Username" value={form.username} onChange={e => setForm({...form, username:e.target.value})} />}
        <input type="email" placeholder="Email" value={form.email} onChange={e => setForm({...form, email:e.target.value})} required />
        <input type="password" placeholder="Password" value={form.password} onChange={e => setForm({...form, password:e.target.value})} required />
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit">{signup ? "Sign up" : "Log in"}</button>
      </form>
      <button className="link" onClick={() => { setSignup(!signup); setError(""); }}>
        {signup ? "Already have an account? Log in" : "Need an account? Sign up"}
      </button>
    </div>
  </div>;
}

function Dashboard({ user, onLogout, onRoom }) {
  const [room, setRoom] = useState("");
  const [error, setError] = useState("");

  async function create(mode) {
    try {
      setError("");
      onRoom({ creating: true, mode });
    } catch (e) { setError(e.message); }
  }

  return <main className="dashboard">
    <header className="topbar"><div className="logo">🎲 LUDO</div><div>Hi, <b>{user.username}</b> <button className="ghost" onClick={onLogout}>Log out</button></div></header>
    <section className="hero"><h1>Choose how you want to play</h1><p className="muted">Fast, real-time games with room codes.</p></section>
    <div className="mode-grid">
      <button className="mode-card" onClick={() => create("2p")}><span>👥</span><h2>2 Players</h2><p>Play head-to-head with another person.</p></button>
      <button className="mode-card" onClick={() => create("4p")}><span>👨‍👩‍👧‍👦</span><h2>4 Players</h2><p>Create a room for a full Ludo match.</p></button>
      <button className="mode-card" onClick={() => create("ai")}><span>🤖</span><h2>Vs Computer</h2><p>Practice against a basic AI opponent.</p></button>
    </div>
    <section className="join-card">
      <h2>Join a room</h2>
      <div className="join-row"><input value={room} onChange={e => setRoom(e.target.value.toUpperCase())} maxLength={6} placeholder="ROOM CODE" /><button className="primary" onClick={() => onRoom({ joining:true, roomCode:room })}>Join</button></div>
      {error && <div className="error">{error}</div>}
    </section>
  </main>;
}

const colorMap = { red:"#ef4444", green:"#22c55e", yellow:"#eab308", blue:"#3b82f6" };

function Board({ state, userId, onMove }) {
  const current = state.players[state.turnIndex];
  const canSelect = current?.userId === userId && state.rolled && state.dice;
  const coords = [
    [10,10],[30,10],[50,10],[70,10],
    [10,30],[30,30],[50,30],[70,30],
    [10,50],[30,50],[50,50],[70,50],
    [10,70],[30,70],[50,70],[70,70]
  ];
  return <div className="board">
    <div className="board-center">🏠</div>
    {state.players.map(p => <div key={p.userId} className="yard" style={{borderColor:colorMap[p.color]}}>
      <div className="yard-title" style={{color:colorMap[p.color]}}>{p.username}</div>
      <div className="tokens">{p.tokens.map((t,i) => {
        const [x,y] = coords[(i + (t < 0 ? 0 : Math.min(t,15))) % coords.length];
        const selected = canSelect && p.userId === userId;
        return <button key={i} className="token" disabled={!selected} onClick={() => onMove(i)}
          style={{background:colorMap[p.color], left:`${x}%`, top:`${y}%`}}>{i+1}</button>;
      })}</div>
    </div>)}
    <div className="track-hint">Classic 52-space track • Safe spaces protected</div>
  </div>;
}

function Game({ user, roomCode, onExit }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [socket] = useState(() => io(API, { auth: { token: localStorage.getItem("ludo_token") }, transports:["websocket","polling"] }));

  useEffect(() => {
    socket.on("game:state", setState);
    socket.emit("room:state", { roomCode }, r => {
      if (r?.ok) setState(r.state); else setError(r?.error || "Room unavailable");
    });
    socket.on("connect_error", e => setError(e.message));
    return () => socket.disconnect();
  }, [socket, roomCode]);

  function action(event, payload) {
    setError("");
    socket.emit(event, payload, r => { if (!r?.ok) setError(r?.error || "Action failed"); });
  }

  const me = state?.players?.find(p => p.userId === user.id);
  const current = state?.players?.[state?.turnIndex];
  const myTurn = current?.userId === user.id;

  if (!state) return <div className="loading">Connecting to room <b>{roomCode}</b>…</div>;

  return <main className="game-page">
    <header className="game-top"><button className="ghost" onClick={onExit}>← Leave</button><b>Room {roomCode}</b><span>{state.status === "waiting" ? "Waiting for players…" : state.status === "finished" ? "Game over" : `${current?.username}'s turn`}</span></header>
    {state.status === "waiting" && <div className="waiting"><h2>Share room code: <strong>{roomCode}</strong></h2><p>{state.players.length}/{state.playerCount} players joined.</p></div>}
    {state.status === "finished" && <div className="winner">🏆 Winner: <b>{state.players.find(p=>p.userId===state.winner)?.username}</b></div>}
    <div className="game-layout">
      <section><Board state={state} userId={user.id} onMove={i => action("game:move",{roomCode,tokenIndex:i})}/></section>
      <aside className="side-panel">
        <div className="dice">{state.dice || "—"}</div>
        <button className="primary dice-btn" disabled={!myTurn || state.rolled || state.status !== "playing"} onClick={() => action("game:roll",{roomCode})}>🎲 Roll Dice</button>
        <p className="turn">{myTurn ? "Your turn" : `${current?.username}'s turn`}</p>
        <div className="players-list">{state.players.map(p => <div className="player-row" key={p.userId}><span className="dot" style={{background:colorMap[p.color]}} />{p.username}{p.userId===user.id?" (you)":""}</div>)}</div>
        {error && <div className="error">{error}</div>}
        <small className="muted">Rolling and moves are validated on the server.</small>
      </aside>
    </div>
  </main>;
}

function App() {
  const [user, setUser] = useState(null);
  const [room, setRoom] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("ludo_token");
    if (token) api("/api/me").then(d => setUser(d.user)).catch(() => localStorage.removeItem("ludo_token"));
  }, []);

  if (!user) return <Auth onLogin={setUser}/>;
  if (room) return <Game user={user} roomCode={room.roomCode} onExit={() => setRoom(null)}/>;
  return <Dashboard user={user} onLogout={() => { localStorage.removeItem("ludo_token"); setUser(null); }} onRoom={async action => {
    try {
      if (action.creating) {
        const socket = io(API, { auth:{token:localStorage.getItem("ludo_token")} });
        socket.emit("room:create", {mode:action.mode}, r => { socket.disconnect(); if (r?.ok) setRoom({roomCode:r.roomCode}); else alert(r?.error); });
      } else {
        const socket = io(API, { auth:{token:localStorage.getItem("ludo_token")} });
        socket.emit("room:join", {roomCode:action.roomCode}, r => { socket.disconnect(); if (r?.ok) setRoom({roomCode:r.roomCode}); else alert(r?.error); });
      }
    } catch(e) { alert(e.message); }
  }}/>;
}

createRoot(document.getElementById("root")).render(<App />);
