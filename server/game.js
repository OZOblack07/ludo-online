export const COLORS = ["red", "green", "yellow", "blue"];

export function makePlayer(userId, username, color) {
  return {
    userId,
    username,
    color,
    tokens: [-1, -1, -1, -1],
    finished: false
  };
}

export function createGameState({ creatorId, username, mode }) {
  const playerCount = mode === "4p" ? 4 : 2;
  const players = [makePlayer(creatorId, username, COLORS[0])];
  return {
    version: 1,
    mode,
    playerCount,
    status: "waiting",
    players,
    turnIndex: 0,
    dice: null,
    rolled: false,
    winner: null,
    lastAction: null,
    createdAt: Date.now()
  };
}

/*
  Board representation:
  - -1 = token in home
  - 0..51 = shared circular track position relative to red start
  - 52..57 = player's private home stretch
  - 58 = finished
*/
const START = { red: 0, green: 13, yellow: 26, blue: 39 };

function absoluteTrack(color, position) {
  return (START[color] + position) % 52;
}

export function safeTrackPositions() {
  return new Set([0, 8, 13, 21, 26, 34, 39, 47]);
}

export function canMoveToken(player, tokenIndex, dice) {
  const p = player.tokens[tokenIndex];
  if (dice < 1 || dice > 6) return false;
  if (p === 58) return false;
  if (p === -1) return dice === 6;
  return p + dice <= 58;
}

export function legalMoves(state) {
  const player = state.players[state.turnIndex];
  if (!player || !state.rolled || !state.dice) return [];
  return player.tokens
    .map((_, i) => i)
    .filter(i => canMoveToken(player, i, state.dice));
}

function capture(state, movingPlayer, newPos) {
  if (newPos < 0 || newPos > 51) return;
  const abs = absoluteTrack(movingPlayer.color, newPos);
  if (safeTrackPositions().has(abs)) return;

  for (const opponent of state.players) {
    if (opponent === movingPlayer) continue;
    opponent.tokens = opponent.tokens.map(pos => {
      if (pos >= 0 && pos <= 51 && absoluteTrack(opponent.color, pos) === abs) {
        return -1;
      }
      return pos;
    });
  }
}

export function applyMove(state, userId, tokenIndex) {
  if (state.status !== "playing") throw new Error("Game is not active");
  const player = state.players[state.turnIndex];
  if (!player || player.userId !== userId) throw new Error("Not your turn");
  if (!state.rolled || !state.dice) throw new Error("Roll the dice first");
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) throw new Error("Invalid token");
  if (!canMoveToken(player, tokenIndex, state.dice)) throw new Error("Illegal move");

  const dice = state.dice;
  let next = player.tokens[tokenIndex];
  if (next === -1 && dice === 6) next = 0;
  else next += dice;

  player.tokens[tokenIndex] = next;
  capture(state, player, next);

  if (player.tokens.every(x => x === 58)) {
    player.finished = true;
    state.status = "finished";
    state.winner = player.userId;
  }

  const extraTurn = dice === 6;
  state.dice = null;
  state.rolled = false;
  state.lastAction = { type: "move", username: player.username, tokenIndex, dice, at: Date.now() };

  if (state.status === "playing" && !extraTurn) {
    state.turnIndex = (state.turnIndex + 1) % state.players.length;
  }
  return state;
}

export function rollDice(state, userId) {
  if (state.status !== "playing") throw new Error("Game is not active");
  const player = state.players[state.turnIndex];
  if (!player || player.userId !== userId) throw new Error("Not your turn");
  if (state.rolled) throw new Error("You already rolled");

  state.dice = Math.floor(Math.random() * 6) + 1;
  state.rolled = true;
  state.lastAction = { type: "roll", username: player.username, dice: state.dice, at: Date.now() };

  const moves = legalMoves(state);
  if (moves.length === 0) {
    const rolled = state.dice;
    state.dice = null;
    state.rolled = false;
    if (rolled !== 6) state.turnIndex = (state.turnIndex + 1) % state.players.length;
    state.lastAction = { type: "no-move", username: player.username, dice: rolled, at: Date.now() };
  }
  return state;
}

export function addPlayer(state, userId, username) {
  if (state.status !== "waiting") throw new Error("Game has already started");
  if (state.players.some(p => p.userId === userId)) return state;
  if (state.players.length >= state.playerCount) throw new Error("Room is full");
  state.players.push(makePlayer(userId, username, COLORS[state.players.length]));
  if (state.players.length === state.playerCount) {
    state.status = "playing";
    state.turnIndex = 0;
  }
  return state;
}

export function publicState(state) {
  return JSON.parse(JSON.stringify(state));
}
