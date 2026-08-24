import {
  applyMove,
  legalMoves,
  rollDice
} from "./game.js";

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runAiTurn(state, io, roomCode) {
  if (state.status !== "playing") return;

  const ai = state.players[state.turnIndex];

  if (!ai?.userId?.startsWith("ai:")) {
    return;
  }

  // Small delay so the player can see that it is the AI's turn.
  await wait(700);

  if (state.status !== "playing") return;

  // Roll.
  try {
    rollDice(state, ai.userId);
  } catch {
    return;
  }

  // Show the dice result immediately.
  io.to(roomCode).emit(
    "game:state",
    JSON.parse(JSON.stringify(state))
  );

  /*
    If there was no legal move, rollDice already advanced
    the turn unless the AI rolled a 6.
  */
  const moves = legalMoves(state);

  if (!moves.length) {
    await wait(500);

    io.to(roomCode).emit(
      "game:state",
      JSON.parse(JSON.stringify(state))
    );

    // If it is still AI's turn, run AI again.
    if (
      state.status === "playing" &&
      state.players[state.turnIndex]?.userId.startsWith("ai:")
    ) {
      setTimeout(
        () => runAiTurn(state, io, roomCode),
        400
      );
    }

    return;
  }

  await wait(800);

  /*
    Basic AI strategy:
    1. Prefer a piece that can finish.
    2. Prefer a piece already on the track.
    3. Prefer entering a new piece with a 6.
  */
  const ordered = [...moves].sort((a, b) => {
    const pa = ai.tokens[a];
    const pb = ai.tokens[b];

    const score = position => {
      if (position === -1) return 100;
      if (position >= 52) return 300 + position;
      return 200 + position;
    };

    return score(pb) - score(pa);
  });

  try {
    applyMove(state, ai.userId, ordered[0]);
  } catch {
    return;
  }

  io.to(roomCode).emit(
    "game:state",
    JSON.parse(JSON.stringify(state))
  );

  /*
    A six gives the AI another turn.
  */
  if (
    state.status === "playing" &&
    state.players[state.turnIndex]?.userId.startsWith("ai:")
  ) {
    setTimeout(
      () => runAiTurn(state, io, roomCode),
      600
    );
  }
}
