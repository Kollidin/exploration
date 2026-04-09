import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, 'dist'))); // Serve Vite build output
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  socket.on('joinMode', (data) => {
    const gameType = typeof data === 'string' ? data : data.mode;
    const serverCode = typeof data === 'string' ? '' : (data.serverCode || '');
    const roomKey = serverCode ? `${gameType}-${serverCode}` : gameType;

    socket.join(roomKey);
    socket.gameType = gameType;
    socket.roomKey = roomKey;

    if (!rooms[roomKey]) {
        rooms[roomKey] = { players: {}, itPlayer: null, tagCooldown: 0, seed: Math.floor(Math.random() * 1000000) };
    }
    
    rooms[roomKey].players[socket.id] = { id: socket.id, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, score: 0, status: 'alive' };
    
    if (gameType === 'tag' && !rooms[roomKey].itPlayer) {
        rooms[roomKey].itPlayer = socket.id;
    }

    socket.emit('roomInit', { seed: rooms[roomKey].seed });
    socket.emit('currentPlayers', rooms[roomKey].players);
    socket.to(roomKey).emit('playerConnected', rooms[roomKey].players[socket.id]);
    
    if (gameType === 'tag') {
        io.to(roomKey).emit('newIt', rooms[roomKey].itPlayer);
    }
  });

  socket.on('playerMovement', (movementData) => {
    const gameType = socket.gameType;
    const roomKey = socket.roomKey;
    if (roomKey && rooms[roomKey] && rooms[roomKey].players[socket.id]) {
        if (rooms[roomKey].players[socket.id].status === 'eliminated') return;
        
        rooms[roomKey].players[socket.id].position = movementData.position;
        rooms[roomKey].players[socket.id].rotation = movementData.rotation;
        socket.to(roomKey).volatile.emit('playerMoved', rooms[roomKey].players[socket.id]);
        
        if (gameType === 'tag') {
            const now = Date.now();
            if (socket.id === rooms[roomKey].itPlayer && now - rooms[roomKey].tagCooldown > 2000) {
                for (let otherId in rooms[roomKey].players) {
                    if (otherId !== socket.id && rooms[roomKey].players[otherId].status !== 'eliminated') {
                        const p1 = movementData.position;
                        const p2 = rooms[roomKey].players[otherId].position;
                        const dx = p1.x - p2.x;
                        const dy = p1.y - p2.y;
                        const dz = p1.z - p2.z;
                        if (dx*dx + dy*dy + dz*dz < 4) {
                            rooms[roomKey].itPlayer = otherId;
                            rooms[roomKey].tagCooldown = now;
                            io.to(roomKey).emit('newIt', otherId);
                            break;
                        }
                    }
                }
            }
        }
    }
  });

  socket.on('becomeIt', () => {
      const gameType = socket.gameType;
      const roomKey = socket.roomKey;
      if (gameType === 'tag' && rooms[roomKey]) {
          rooms[roomKey].itPlayer = socket.id;
          rooms[roomKey].tagCooldown = Date.now();
          io.to(roomKey).emit('newIt', socket.id);
      }
  });

  socket.on('shootPaintball', (data) => {
     const roomKey = socket.roomKey;
     if (roomKey && rooms[roomKey]) {
         const p = rooms[roomKey].players[socket.id];
         if (p && p.status !== 'eliminated') {
             socket.to(roomKey).emit('spawnPaintball', data);
         }
     }
  });
  
  socket.on('registerHit', (hitPlayerId) => {
     const gameType = socket.gameType;
     const roomKey = socket.roomKey;
     if (rooms[roomKey] && rooms[roomKey].players[hitPlayerId]) {
         const hitPlayer = rooms[roomKey].players[hitPlayerId];
         const shooter = rooms[roomKey].players[socket.id];
         
         if (gameType === 'paintball') {
             if (shooter) shooter.score = (shooter.score || 0) + 1;
             broadcastScores(roomKey);
             io.to(roomKey).emit('playerHit', hitPlayerId);
         } else if (gameType === 'dodgeball') {
             if (hitPlayer.status === 'alive') {
                 hitPlayer.status = 'eliminated';
                 if (shooter) shooter.score = (shooter.score || 0) + 1;
                 
                 io.to(roomKey).emit('playerEliminated', hitPlayerId);
                 broadcastScores(roomKey);
                 
                 // Check if 1 or 0 players left
                 const alivePlayers = Object.values(rooms[roomKey].players).filter(p => p.status === 'alive');
                 if (alivePlayers.length <= 1 && Object.keys(rooms[roomKey].players).length > 1) {
                     io.to(roomKey).emit('roundOver', alivePlayers.length === 1 ? alivePlayers[0].id : null);
                     
                     setTimeout(() => {
                         if (rooms[roomKey]) {
                             for (let id in rooms[roomKey].players) {
                                 rooms[roomKey].players[id].status = 'alive';
                             }
                             io.to(roomKey).emit('roundStart');
                         }
                     }, 5000);
                 }
             }
         }
     }
  });

  function broadcastScores(roomKey) {
      if (!rooms[roomKey]) return;
      const scores = {};
      for (let id in rooms[roomKey].players) {
          scores[id] = rooms[roomKey].players[id].score || 0;
      }
      io.to(roomKey).emit('scoreUpdate', scores);
  }

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    const gameType = socket.gameType;
    const roomKey = socket.roomKey;
    if (roomKey && rooms[roomKey]) {
        delete rooms[roomKey].players[socket.id];
        io.to(roomKey).emit('playerDisconnected', socket.id);
        
        const remainingPlayers = Object.keys(rooms[roomKey].players);
        if (remainingPlayers.length === 0) {
            delete rooms[roomKey];
            return;
        }
        
        if (gameType === 'tag' && rooms[roomKey].itPlayer === socket.id) {
            if (remainingPlayers.length > 0) {
                rooms[roomKey].itPlayer = remainingPlayers[0];
                io.to(roomKey).emit('newIt', rooms[roomKey].itPlayer);
            } else {
                rooms[roomKey].itPlayer = null;
            }
        }
        
        if (gameType === 'dodgeball') {
            const alivePlayers = Object.values(rooms[roomKey].players).filter(p => p.status === 'alive');
            if (alivePlayers.length <= 1 && Object.keys(rooms[roomKey].players).length > 1) {
                 io.to(roomKey).emit('roundOver', alivePlayers.length === 1 ? alivePlayers[0].id : null);
                 
                 setTimeout(() => {
                     if (rooms[roomKey]) {
                         for (let id in rooms[roomKey].players) {
                             rooms[roomKey].players[id].status = 'alive';
                         }
                         io.to(roomKey).emit('roundStart');
                     }
                 }, 5000);
            }
        }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Socket.IO Server is running on port ${PORT}`);
});
