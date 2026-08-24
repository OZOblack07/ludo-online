export const COLORS = ["red", "green", "yellow", "blue"];

const START = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39
};

export function makePlayer(userId, username, color) {
  return {
    userId,
    username,
    color,
    tokens: [-1, -1, -1, -1],
    finished: false
  };
}

/*
  4 color seats are always used.

  4-player:
    Player 1 = red
    Player 2 = green
    Player 3 = yellow
    Player 4 = blue

  2-player:
    Player 1 = red + yellow
    Player 2 = green + blue

  AI:
    Human = red + yellow
    Computer = green + blue
*/

export function createGameState({ creatorId, username, mode }) {
  const state = {
    version: 2,
    mode,
    playerCount: 4,
    requiredHumans: mode === "4p" ? 4 : mode === "2p" ? 2 : 1,
    status: "waiting",
    players: [],
    turnIndex: 0,
    dice: null,
    rolled: false,
    winner: null,
    lastAction: null,
    createdAt: Date.now()
  };

  if (mode === "4p") {
    state.players.push(makePlayer(creatorId, username, "red"));
  } else {
    // Two colors belong to the first player.
    state.players.push(makePlayer(creatorId, username, "red"));
    state.players.push(makePlayer(creatorId, username, "yellow"));
  }

  if (mode === "ai") {
    state.players.push(makePlayer("ai:computer", "Computer", "green"));
    state.players.push(makePlayer("ai:computer", "Computer", "blue"));
    state.status = "playing";
  }

  return state;
}

export function safeTrackPositions() {
  return new Set([0, 8, 13, 21, 26, 34, 39, 47]);
}

function absoluteTrack(color, position) {
  return (START[color] + position) % 52;
}

export function canMoveToken(player, tokenIndex, dice) {
  if (!player) return false;
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) {
    return false;
  }

  const position = player.tokens[tokenIndex];

  if (dice < 1 || dice > 6) return false;
  if (position === 58) return false;

  // A piece leaves home only with a 6.
  if (position === -1) {
    return dice === 6;
  }

  return position + dice <= 58;
}

export function legalMoves(state) {
  const player = state.players[state.turnIndex];

  if (!player || !state.rolled || !state.dice) {
    return [];
  }

  return player.tokens
    .map((_, index) => index)
    .filter(index => canMoveToken(player, index, state.dice));
}

function capture(state, movingPlayer, newPosition) {
  if (newPosition < 0 || newPosition > 51) return;

  const absolute = absoluteTrack(
    movingPlayer.color,
    newPosition
  );

  if (safeTrackPositions().has(absolute)) return;

  for (const opponent of state.players) {
    if (opponent.userId === movingPlayer.userId) continue;

    opponent.tokens = opponent.tokens.map(position => {
      if (
        position >= 0 &&
        position <= 51 &&
        absoluteTrack(opponent.color, position) === absolute
      ) {
        return -1;
      }

      return position;
    });
  }
}

export function rollDice(state, userId) {
  if (state.status !== "playing") {
    throw new Error("Game is not active");
  }

  const player = state.players[state.turnIndex];

  if (!player || player.userId !== userId) {
    throw new Error("Not your turn");
  }

  if (state.rolled) {
    throw new Error("You already rolled");
  }

  const dice = Math.floor(Math.random() * 6) + 1;

  state.dice = dice;
  state.rolled = true;

  state.lastAction = {
    type: "roll",
    username: player.username,
    color: player.color,
    dice,
    at: Date.now()
  };

  /*
    IMPORTANT:
    Keep the dice visible when there is a legal move.
    If there is no move, automatically advance the turn.
  */
  const moves = legalMoves(state);

  if (moves.length === 0) {
    state.rolled = false;

    const rolled = state.dice;

    state.dice = null;

    if (rolled !== 6) {
      state.turnIndex =
        (state.turnIndex + 1) % state.players.length;
    }

    state.lastAction = {
      type: "no-move",
      username: player.username,
      color: player.color,
      dice: rolled,
      at: Date.now()
    };
  }

  return state;
}

export function applyMove(state, userId, tokenIndex) {
  if (state.status !== "playing") {
    throw new Error("Game is not active");
  }

  const player = state.players[state.turnIndex];

  if (!player || player.userId !== userId) {
    throw new Error("Not your turn");
  }

  if (!state.rolled || !state.dice) {
    throw new Error("Roll the dice first");
  }

  if (
    !Number.isInteger(tokenIndex) ||
    tokenIndex < 0 ||
    tokenIndex > 3
  ) {
    throw new Error("Invalid token");
  }

  if (!canMoveToken(player, tokenIndex, state.dice)) {
    throw new Error("Illegal move");
  }

  const dice = state.dice;

  let next = player.tokens[tokenIndex];

  if (next === -1) {
    next = 0;
  } else {
    next += dice;
  }

  player.tokens[tokenIndex] = next;

  capture(state, player, next);

  if (player.tokens.every(position => position === 58)) {
    player.finished = true;
    state.status = "finished";
    state.winner = player.userId;
  }

  const extraTurn = dice === 6;

  state.lastAction = {
    type: "move",
    username: player.username,
    color: player.color,
    tokenIndex,
    dice,
    position: next,
    at: Date.now()
  };

  state.dice = null;
  state.rolled = false;

  if (state.status === "playing" && !extraTurn) {
    state.turnIndex =
      (state.turnIndex + 1) % state.players.length;
  }

  return state;
}

export function addPlayer(state, userId, username) {
  if (state.status !== "waiting") {
    throw new Error("Game has already started");
  }

  const alreadyJoined = state.players.some(
    player => player.userId === userId
  );

  if (alreadyJoined) {
    return state;
  }

  if (state.mode === "4p") {
    if (state.players.length >= 4) {
      throw new Error("Room is full");
    }

    const color = COLORS[state.players.length];

    state.players.push(
      makePlayer(userId, username, color)
    );
  } else {
    /*
      Two-player mode.

      First player already owns:
        red + yellow

      Second player receives:
        green + blue
    */

    if (state.players.length >= 4) {
      throw new Error("Room is full");
    }

    state.players.push(
      makePlayer(userId, username, "green")
    );

    state.players.push(
      makePlayer(userId, username, "blue")
    );
  }

  const humans = new Set(
    state.players
      .filter(player => !player.userId.startsWith("ai:"))
      .map(player => player.userId)
  );

  if (humans.size >= state.requiredHumans) {
    state.status = "playing";
    state.turnIndex = 0;
  }

  return state;
}

export function publicState(state) {
  return JSON.parse(JSON.stringify(state));
}
