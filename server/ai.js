import { applyMove, legalMoves, rollDice } from "./game.js";

export async function runAiTurn(state, io, roomCode) {
  const ai = state.players[state.turnIndex];
  if (!ai?.userId.startsWith("ai:")) return;

  await new Promise(r => setTimeout(r, 650));
  rollDice(state, ai.userId);
  io.to(roomCode).emit("game:state", state);

  if (state.status !== "playing") return;
  const moves = legalMoves(state);
  if (!moves.length) return;

  await new Promise(r => setTimeout(r, 650));

  // Basic strategy: prefer captures, then finishing tokens, then entering from home.
  const ordered = [...moves].sort((a, b) => {
    const ta = ai.tokens[a], tb = ai.tokens[b];
    const score = p => p === -1 ? 80 : p + 100;
    return score(tb) - score(ta);
  });

  applyMove(state, ai.userId, ordered[0]);
  io.to(roomCode).emit("game:state", state);
}
