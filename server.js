const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

let users = new Set();

io.on('connection', (socket) => {
  console.log('User connected');
  
  socket.on('join', (username) => {
    users.add(username);
    socket.username = username;
    io.emit('userList', Array.from(users));
    io.emit('message', { user: 'System', text: `${username} joined` });
  });

  socket.on('message', (msg) => {
    io.emit('message', { user: socket.username, text: msg });
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      users.delete(socket.username);
      io.emit('userList', Array.from(users));
      io.emit('message', { user: 'System', text: `${socket.username} left` });
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
