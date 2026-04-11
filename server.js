const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const Database = require('better-sqlite3');
const path = require('path');

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Initialize SQLite database
const dbPath = path.join(__dirname, 'chat.db');
const db = new Database(dbPath);

console.log(`Database location: ${dbPath}`);

// Create messages table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

let users = new Set();

io.on('connection', (socket) => {
  console.log('User connected');
  
  socket.on('join', (username) => {
    users.add(username);
    socket.username = username;
    
    // Send chat history (last 100 messages)
    const history = db.prepare(`
      SELECT username, message, timestamp 
      FROM messages 
      ORDER BY id DESC 
      LIMIT 100
    `).all().reverse();
    
    socket.emit('history', history.map(row => ({
      user: row.username,
      text: row.message,
      timestamp: row.timestamp
    })));
    
    io.emit('userList', Array.from(users));
    
    // Save join message
    const stmt = db.prepare('INSERT INTO messages (username, message) VALUES (?, ?)');
    stmt.run('System', `${username} joined`);
    
    io.emit('message', { 
      user: 'System', 
      text: `${username} joined`,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('message', (msg) => {
    const messageData = {
      user: socket.username,
      text: msg,
      timestamp: new Date().toISOString()
    };
    
    // Save to database
    const stmt = db.prepare('INSERT INTO messages (username, message) VALUES (?, ?)');
    stmt.run(socket.username, msg);
    
    io.emit('message', messageData);
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      users.delete(socket.username);
      io.emit('userList', Array.from(users));
      
      // Save leave message
      const stmt = db.prepare('INSERT INTO messages (username, message) VALUES (?, ?)');
      stmt.run('System', `${socket.username} left`);
      
      io.emit('message', {
        user: 'System',
        text: `${socket.username} left`,
        timestamp: new Date().toISOString()
      });
    }
  });
});

// Middleware to check API key
function requireApiKey(req, res, next) {
  const apiKey = req.query.key || req.headers['x-api-key'];
  const validKey = process.env.API_KEY || 'your-secret-key-here';
  
  if (apiKey === validKey) {
    next(); // Allow access
  } else {
    res.status(403).json({ error: 'Forbidden: Invalid API key' });
  }
}

// Protected export endpoints
app.get('/export/json', requireApiKey, (req, res) => {
  const messages = db.prepare('SELECT * FROM messages ORDER BY id ASC').all();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=chat-export.json');
  res.json(messages);
});

app.get('/export/csv', requireApiKey, (req, res) => {
  const messages = db.prepare('SELECT * FROM messages ORDER BY id ASC').all();
  const csv = [
    'ID,Username,Message,Timestamp',
    ...messages.map(m => 
      `${m.id},"${m.username}","${m.message.replace(/"/g, '""')}","${m.timestamp}"`
    )
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=chat-export.csv');
  res.send(csv);
});

app.get('/stats', requireApiKey, (req, res) => {
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get();
  const uniqueUsers = db.prepare('SELECT COUNT(DISTINCT username) as count FROM messages WHERE username != "System"').get();
  
  res.json({
    totalMessages: totalMessages.count,
    uniqueUsers: uniqueUsers.count,
    exportUrls: {
      json: '/export/json?key=YOUR_KEY',
      csv: '/export/csv?key=YOUR_KEY'
    }
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));