import "dotenv/config";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { Server } from "socket.io";

import { prisma } from "./db.js";
import { signToken, verifyToken, authRequired } from "./auth.js";
import {
  createGameState,
  addPlayer,
  rollDice,
  applyMove,
  publicState,
} from "./game.js";
import { runAiTurn } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);

const port = Number(process.env.PORT || 10000);
const clientUrl =
  process.env.CLIENT_URL || "http://localhost:5173";

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  })
);

app.use(express.json({ limit: "100kb" }));

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    service: "ludo-online",
  });
});

/* =========================================================
   AUTH
========================================================= */

app.post("/api/auth/signup", async (req, res) => {
  try {
    const username = String(req.body.username || "")
      .trim();

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({
        error:
          "Username must be 3-20 letters, numbers or underscores.",
      });
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({
        error: "Enter a valid email.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters.",
      });
    }

    const exists = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email },
        ],
      },
    });

    if (exists) {
      return res.status(409).json({
        error: "Username or email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
      },
    });

    res.status(201).json({
      token: signToken(user),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("SIGNUP ERROR:", error);

    res.status(500).json({
      error: "Could not create account.",
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (
      !user ||
      !(await bcrypt.compare(
        password,
        user.passwordHash
      ))
    ) {
      return res.status(401).json({
        error: "Invalid email or password.",
      });
    }

    res.json({
      token: signToken(user),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      error: "Login failed.",
    });
  }
});

app.get(
  "/api/me",
  authRequired,
  async (req, res) => {
    try {
      const user =
        await prisma.user.findUnique({
          where: {
            id: req.auth.sub,
          },
          select: {
            id: true,
            username: true,
            email: true,
          },
        });

      if (!user) {
        return res.status(404).json({
          error: "User not found.",
        });
      }

      res.json({ user });
    } catch (error) {
      console.error("ME ERROR:", error);

      res.status(500).json({
        error: "Could not load user.",
      });
    }
  }
);

/* =========================================================
   ROOMS
========================================================= */

const rooms = new Map();

function randomCode() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code = "";

  for (let i = 0; i < 6; i++) {
    code +=
      chars[
        Math.floor(
          Math.random() * chars.length
        )
      ];
  }

  return code;
}

async function saveRoom(room) {
  await prisma.game.update({
    where: {
      id: room.dbId,
    },
    data: {
      state: room.state,
      status: room.state.status,
    },
  });
}

async function getRoom(code) {
  if (rooms.has(code)) {
    return rooms.get(code);
  }

  const game =
    await prisma.game.findUnique({
      where: {
        roomCode: code,
      },
    });

  if (!game) {
    return null;
  }

  const room = {
    dbId: game.id,
    state: game.state,
  };

  rooms.set(code, room);

  return room;
}

/* =========================================================
   SOCKET.IO
========================================================= */

const io = new Server(server, {
  cors: {
    origin: clientUrl,
    credentials: true,
  },
  transports: [
    "websocket",
    "polling",
  ],
});

/* =========================================================
   SOCKET AUTH
========================================================= */

io.use((socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token;

    if (!token) {
      return next(
        new Error("Authentication required")
      );
    }

    socket.user = verifyToken(token);

    next();
  } catch {
    next(
      new Error(
        "Invalid authentication token"
      )
    );
  }
});

/* =========================================================
   SOCKET CONNECTION
========================================================= */

io.on("connection", (socket) => {
  console.log(
    "Socket connected:",
    socket.user.sub
  );

  /* =======================================================
     CREATE ROOM
  ======================================================= */

  socket.on(
    "room:create",
    async ({ mode }, ack = () => {}) => {
      try {
        if (
          !["2p", "4p", "ai"].includes(mode)
        ) {
          throw new Error(
            "Invalid game mode."
          );
        }

        const user =
          await prisma.user.findUnique({
            where: {
              id: socket.user.sub,
            },
          });

        if (!user) {
          throw new Error(
            "User not found."
          );
        }

        const roomCode = randomCode();

        /*
          For AI mode the actual game has:
          Human = red
          Computer = green
        */

        const gameMode =
          mode === "ai"
            ? "2p"
            : mode;

        const state =
          createGameState({
            creatorId: user.id,
            username: user.username,
            mode: gameMode,
          });

        /* =================================================
           ADD COMPUTER PLAYER
        ================================================= */

        if (mode === "ai") {
          state.players.push({
            userId: "ai:computer",
            username: "Computer",
            color: "green",
            tokens: [
              -1,
              -1,
              -1,
              -1,
            ],
            finished: false,
          });

          state.playerCount = 2;
          state.status = "playing";
          state.turnIndex = 0;
        }

        /* =================================================
           SAVE GAME
        ================================================= */

        const game =
          await prisma.game.create({
            data: {
              roomCode,
              mode,
              state,
              creatorId: user.id,
            },
          });

        const room = {
          dbId: game.id,
          state,
        };

        rooms.set(
          roomCode,
          room
        );

        socket.join(roomCode);

        ack({
          ok: true,
          roomCode,
          state: publicState(state),
        });

        io.to(roomCode).emit(
          "game:state",
          publicState(state)
        );

        /* =================================================
           START AI
        ================================================= */

        if (mode === "ai") {
          setTimeout(() => {
            runAiTurn(
              state,
              io,
              roomCode
            ).catch((error) => {
              console.error(
                "AI ERROR:",
                error
              );
            });
          }, 1000);
        }
      } catch (error) {
        console.error(
          "CREATE ROOM ERROR:",
          error
        );

        ack({
          ok: false,
          error: error.message,
        });
      }
    }
  );

  /* =======================================================
     JOIN ROOM
  ======================================================= */

  socket.on(
    "room:join",
    async ({ roomCode }, ack = () => {}) => {
      try {
        const code = String(
          roomCode || ""
        )
          .trim()
          .toUpperCase();

        const room =
          await getRoom(code);

        if (!room) {
          throw new Error(
            "Room not found."
          );
        }

        const user =
          await prisma.user.findUnique({
            where: {
              id: socket.user.sub,
            },
          });

        if (!user) {
          throw new Error(
            "User not found."
          );
        }

        addPlayer(
          room.state,
          user.id,
          user.username
        );

        await saveRoom(room);

        socket.join(code);

        io.to(code).emit(
          "game:state",
          publicState(room.state)
        );

        ack({
          ok: true,
          roomCode: code,
          state: publicState(
            room.state
          ),
        });
      } catch (error) {
        console.error(
          "JOIN ERROR:",
          error
        );

        ack({
          ok: false,
          error: error.message,
        });
      }
    }
  );

  /* =======================================================
     ROLL DICE
  ======================================================= */

  socket.on(
    "game:roll",
    async ({ roomCode }, ack = () => {}) => {
      try {
        const code = String(
          roomCode || ""
        )
          .trim()
          .toUpperCase();

        const room =
          await getRoom(code);

        if (!room) {
          throw new Error(
            "Room not found."
          );
        }

        /*
          Only the current player can roll.
          The server generates the number.
        */

        rollDice(
          room.state,
          socket.user.sub
        );

        await saveRoom(room);

        /*
          Immediately send the new dice
          number to every player.
        */

        io.to(code).emit(
          "game:state",
          publicState(room.state)
        );

        ack({
          ok: true,
          dice: room.state.dice,
        });

        /*
          If the roll caused the turn to
          advance to the AI, start AI.
        */

        if (
          room.state.status ===
            "playing" &&
          room.state.players[
            room.state.turnIndex
          ]?.userId.startsWith("ai:")
        ) {
          setTimeout(() => {
            runAiTurn(
              room.state,
              io,
              code
            ).catch((error) => {
              console.error(
                "AI ERROR:",
                error
              );
            });
          }, 700);
        }
      } catch (error) {
        console.error(
          "ROLL ERROR:",
          error
        );

        ack({
          ok: false,
          error: error.message,
        });
      }
    }
  );

  /* =======================================================
     MOVE PIECE
  ======================================================= */

  socket.on(
    "game:move",
    async (
      { roomCode, tokenIndex },
      ack = () => {}
    ) => {
      try {
        const code = String(
          roomCode || ""
        )
          .trim()
          .toUpperCase();

        const room =
          await getRoom(code);

        if (!room) {
          throw new Error(
            "Room not found."
          );
        }

        applyMove(
          room.state,
          socket.user.sub,
          Number(tokenIndex)
        );

        await saveRoom(room);

        /*
          Send updated board to everyone.
        */

        io.to(code).emit(
          "game:state",
          publicState(room.state)
        );

        ack({
          ok: true,
        });

        /*
          If it is now the AI's turn,
          automatically start the AI.
        */

        if (
          room.state.status ===
            "playing" &&
          room.state.players[
            room.state.turnIndex
          ]?.userId.startsWith("ai:")
        ) {
          setTimeout(() => {
            runAiTurn(
              room.state,
              io,
              code
            ).catch((error) => {
              console.error(
                "AI ERROR:",
                error
              );
            });
          }, 700);
        }
      } catch (error) {
        console.error(
          "MOVE ERROR:",
          error
        );

        ack({
          ok: false,
          error: error.message,
        });
      }
    }
  );

  /* =======================================================
     GET CURRENT ROOM STATE
  ======================================================= */

  socket.on(
    "room:state",
    async (
      { roomCode },
      ack = () => {}
    ) => {
      try {
        const code = String(
          roomCode || ""
        )
          .trim()
          .toUpperCase();

        const room =
          await getRoom(code);

        if (!room) {
          return ack({
            ok: false,
            error: "Room not found.",
          });
        }

        socket.join(code);

        const state =
          publicState(room.state);

        ack({
          ok: true,
          state,
        });

        socket.emit(
          "game:state",
          state
        );
      } catch (error) {
        console.error(
          "ROOM STATE ERROR:",
          error
        );

        ack({
          ok: false,
          error: error.message,
        });
      }
    }
  );

  socket.on("disconnect", () => {
    console.log(
      "Socket disconnected:",
      socket.user.sub
    );
  });
});

/* =========================================================
   SERVE REACT BUILD
========================================================= */

const dist = path.resolve(
  __dirname,
  "../client/dist"
);

app.use(
  express.static(dist)
);

app.get(
  "/{*splat}",
  (req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path === "/health"
    ) {
      return next();
    }

    res.sendFile(
      path.join(
        dist,
        "index.html"
      )
    );
  }
);

/* =========================================================
   START SERVER
========================================================= */

server.listen(
  port,
  "0.0.0.0",
  () => {
    console.log(
      `Ludo server listening on ${port}`
    );
  }
);

/* =========================================================
   SHUTDOWN
========================================================= */

process.on(
  "SIGTERM",
  async () => {
    await prisma.$disconnect();
    process.exit(0);
  }
);