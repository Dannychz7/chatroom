const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const Database = require('better-sqlite3');
const path = require('path');
const Sentiment = require('sentiment');
const { spawnSync } = require('child_process');

const sentimentAnalyzer = new Sentiment();

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Initialize SQLite database
const dbPath = path.join(__dirname, 'food-ItalianChineseGreek.db');
const db = new Database(dbPath);

console.log(`Database location: ${dbPath}`);

// ── Parse DB filename for topic and alternatives ──────────────────────────
// Convention: <topic>-<Option1><Option2><Option3>.db  (options in CamelCase)
// e.g. electriccars-TeslaRivianFord.db → topic='electriccars', options=['Tesla','Rivian','Ford']
const dbBasename = path.basename(dbPath, '.db');
const dashIdx    = dbBasename.indexOf('-');
const RAW_TOPIC  = dashIdx !== -1 ? dbBasename.slice(0, dashIdx) : dbBasename;
const rawOptions = dashIdx !== -1 ? dbBasename.slice(dashIdx + 1) : '';

function splitCamelCase(str) {
  return str.match(/[A-Z][a-z0-9]*/g) || (str ? [str] : []);
}

const TOPIC   = RAW_TOPIC;
const OPTIONS = splitCamelCase(rawOptions); // ['Tesla', 'Rivian', 'Ford']
const OPTION_COLORS = ['#5b9cf6', '#a78bfa', '#f6875b', '#5bf6a0', '#f6c05b', '#f65bb5'];

console.log(`Topic: ${TOPIC}, Options: ${OPTIONS.join(', ')}`);
// ─────────────────────────────────────────────────────────────────────────

// Create messages table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    room_id TEXT NOT NULL DEFAULT 'general',
    replying_to INTEGER REFERENCES messages(id),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migrate existing DB: add columns if they don't exist yet
try { db.exec(`ALTER TABLE messages ADD COLUMN room_id TEXT NOT NULL DEFAULT 'general'`); } catch (e) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN replying_to INTEGER REFERENCES messages(id)`); } catch (e) {}

// Cache LLM-extracted aspects per message so the LLM is only called once per message
db.exec(`CREATE TABLE IF NOT EXISTS message_aspects (
  message_id INTEGER PRIMARY KEY,
  aspects    TEXT NOT NULL DEFAULT '[]'
)`);

function getLLMAspects(messageId, messageText) {
  const cached = db.prepare('SELECT aspects FROM message_aspects WHERE message_id = ?').get(messageId);
  if (cached) {
    console.log(`[aspects] msg ${messageId} → cache hit:`, JSON.parse(cached.aspects));
    return JSON.parse(cached.aspects);
  }

  console.log(`[aspects] msg ${messageId} → calling LLM: "${messageText.substring(0, 60)}..."`);
  const result = spawnSync('python3', ['extract.py', messageText], { encoding: 'utf8' });
  if (result.error) { console.error('❌ Python error:', result.error); return []; }
  if (result.stderr) console.warn('⚠️ Python:', result.stderr.trim());

  let aspects = [];
  try { aspects = JSON.parse(result.stdout.trim() || '[]'); } catch { aspects = []; }

  console.log(`[aspects] msg ${messageId} → LLM returned:`, aspects);
  db.prepare('INSERT OR IGNORE INTO message_aspects (message_id, aspects) VALUES (?, ?)').run(messageId, JSON.stringify(aspects));
  return aspects;
}

// room -> Set of usernames
const roomUsers = new Map();

function getRoomUsers(room) {
  if (!roomUsers.has(room)) roomUsers.set(room, new Set());
  return roomUsers.get(room);
}

io.on('connection', (socket) => {
  console.log('User connected');

  socket.on('join', ({ username, room }) => {
    room = room || getDefaultRoom();
    socket.username = username;
    socket.room = room;
    socket.join(room);

    getRoomUsers(room).add(username);

    // Send chat history for this room (last 100 messages, with reply context)
    const history = db.prepare(`
      SELECT m.id, m.username, m.message, m.room_id, m.replying_to, m.timestamp,
             r.username AS reply_user, r.message AS reply_text
      FROM messages m
      LEFT JOIN messages r ON m.replying_to = r.id
      WHERE m.room_id = ? OR m.room_id LIKE (? || '-%')
      ORDER BY m.id DESC
      LIMIT 100
    `).all(room, room).reverse();

    socket.emit('history', history.map(row => ({
      id: row.id,
      user: row.username,
      text: row.message,
      room: row.room_id,
      replying_to: row.replying_to || null,
      reply_user: row.reply_user || null,
      reply_text: row.reply_text || null,
      timestamp: row.timestamp
    })));

    io.to(room).emit('userList', Array.from(getRoomUsers(room)));

    // Save join message
    db.prepare('INSERT INTO messages (username, message, room_id) VALUES (?, ?, ?)').run('System', `${username} joined`, room);

    io.to(room).emit('message', {
      id: null,
      user: 'System',
      text: `${username} joined`,
      room,
      replying_to: null,
      reply_user: null,
      reply_text: null,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('message', ({ text, replying_to }) => {
    if (!socket.username || !socket.room) return;

    const replyId = replying_to || null;

    const stmt = db.prepare('INSERT INTO messages (username, message, room_id, replying_to) VALUES (?, ?, ?, ?)');
    const result = stmt.run(socket.username, text, socket.room, replyId);
    const newId = result.lastInsertRowid;

    // Fetch reply context if present
    let reply_user = null, reply_text = null;
    if (replyId) {
      const orig = db.prepare('SELECT username, message FROM messages WHERE id = ?').get(replyId);
      if (orig) { reply_user = orig.username; reply_text = orig.message; }
    }

    io.to(socket.room).emit('message', {
      id: newId,
      user: socket.username,
      text,
      room: socket.room,
      replying_to: replyId,
      reply_user,
      reply_text,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    if (socket.username && socket.room) {
      getRoomUsers(socket.room).delete(socket.username);
      io.to(socket.room).emit('userList', Array.from(getRoomUsers(socket.room)));

      db.prepare('INSERT INTO messages (username, message, room_id) VALUES (?, ?, ?)').run('System', `${socket.username} left`, socket.room);

      io.to(socket.room).emit('message', {
        id: null,
        user: 'System',
        text: `${socket.username} left`,
        room: socket.room,
        replying_to: null,
        reply_user: null,
        reply_text: null,
        timestamp: new Date().toISOString()
      });
    }
  });
});

// Middleware to check API key
function requireApiKey(req, res, next) {
  const apiKey = req.query.key || req.headers['x-api-key'];
  const validKey = process.env.API_KEY || 'your-secret-key-here';

  console.log('Provided:', apiKey);
  console.log('Expected:', validKey);

  if (apiKey === validKey) {
    next();
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
    'ID,Username,Message,Room,ReplyingTo,Timestamp',
    ...messages.map(m =>
      `${m.id},"${m.username}","${m.message.replace(/"/g, '""')}","${m.room_id || 'general'}","${m.replying_to || ''}","${m.timestamp}"`
    )
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=chat-export.csv');
  res.send(csv);
});

app.get('/stats', requireApiKey, (req, res) => {
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get();
  const uniqueUsers = db.prepare('SELECT COUNT(DISTINCT username) as count FROM messages WHERE username != "System"').get();
  const rooms = db.prepare('SELECT DISTINCT room_id FROM messages WHERE username != "System"').all().map(r => r.room_id);

  res.json({
    totalMessages: totalMessages.count,
    uniqueUsers: uniqueUsers.count,
    rooms,
    exportUrls: {
      json: '/export/json?key=YOUR_KEY',
      csv: '/export/csv?key=YOUR_KEY'
    }
  });
});

// ── Derive a clean room name from existing DB data ────────────────────────
// Room IDs are stored as e.g. "electric-cars-20260415-114602".
// Strip the trailing -YYYYMMDD-HHMMSS timestamp to get "electric-cars".
function cleanRoomName(roomId) {
  return roomId.replace(/-\d{8}-\d{6}$/, '');
}

function getDefaultRoom() {
  const row = db.prepare(
    `SELECT room_id FROM messages WHERE username != 'System'
     GROUP BY room_id ORDER BY COUNT(*) DESC LIMIT 1`
  ).get();
  return row ? cleanRoomName(row.room_id) : TOPIC;
}

// ── Public: distinct rooms in the DB ─────────────────────────────────────
app.get('/rooms', (req, res) => {
  const rows = db.prepare(
    `SELECT room_id, COUNT(*) AS msg_count, MAX(timestamp) AS last_active
     FROM messages WHERE username != 'System'
     GROUP BY room_id ORDER BY last_active DESC`
  ).all();

  // Deduplicate by clean name (multiple timestamped IDs may share a base)
  const seen = new Set();
  const rooms = [];
  for (const r of rows) {
    const name = cleanRoomName(r.room_id);
    if (!seen.has(name)) {
      seen.add(name);
      rooms.push({ name, messageCount: r.msg_count, lastActive: r.last_active });
    }
  }
  res.json(rooms);
});

// ── Public: topic + alternatives derived from DB filename ─────────────────
app.get('/config', (req, res) => {
  res.json({
    topic: TOPIC,
    topicDisplay: TOPIC.replace(/([a-z])([A-Z])/g, '$1 $2')
                       .replace(/^./, c => c.toUpperCase()),
    defaultRoom: getDefaultRoom(),
    options: OPTIONS.map((label, i) => ({
      id: String.fromCharCode(65 + i),   // A, B, C …
      label,
      color: OPTION_COLORS[i % OPTION_COLORS.length]
    }))
  });
});

// ── Public: live analytics (sentiment scoring + pairwise edges + aspects) ─
// Sentiment is computed using AFINN word-list (no ML — pure lexicon lookup).
// Each message that mentions an option contributes its comparative score
// (+comparative if positive, −comparative if negative) to that option's tally.
// Messages mentioning two or more options in the same text create/increment
// a pairwise edge between those options.
const STOPWORDS = new Set([
  'i','me','my','we','you','they','he','she','it','its','the','a','an',
  'and','or','but','in','on','at','to','for','of','with','this','that',
  'these','those','is','are','was','were','be','been','being','have',
  'has','had','do','does','did','will','would','could','should','may',
  'might','not','no','so','if','about','before','after','some','any',
  'all','also','just','get','think','see','know','like','still','more',
  'what','how','when','where','who','which','than','then','their','there',
  'here','can','am','really','great','good','very','even','much','many',
  'them','from','our','your','into','over','between','while','both',
  'each','other','same','such','too','very','well','already','since',
  'let','look','sure','end','day','way','new','big','far','use','used',
  'want','need','make','made','come','came','take','took','give','gave',
  'cars','car','electric','vehicles','vehicle','market','brand','brands',
  'going','going','getting','having','being','said','says','saying',
  'guys','people','someone','anyone','everyone','someone','thing','things',
  'point','side','hear','heard','seen','forget','considering','switching', 'find', 'maybe'
]);

app.get('/analytics', (req, res) => {
  const messages = db.prepare(
    `SELECT id, username, message, replying_to FROM messages
     WHERE username != 'System' ORDER BY id ASC`
  ).all();

  const recentIds = new Set(messages.slice(-5).map(m => m.id));
  const optIds    = OPTIONS.map((_, i) => String.fromCharCode(65 + i));
  const optLower  = OPTIONS.map(o => o.toLowerCase());
  const scores    = Object.fromEntries(optIds.map(id => [id, 0]));
  const edgeCounts = {};
  const aspectMap  = {};
  const recentAspects = new Set();

  const SENTIMENT_WINDOW = 3;

  // Regex to split by punctuation and contrastive conjunctions
  // This treats "but", "however", etc., as boundaries
  const clauseSplitter = /([,;.?!]|\bbut\b|\bhowever\b|\balthough\b|\byet\b|\bwhereas\b)/i;
  const COMPARISON_WORDS = ['than', 'vs', 'better', 'worse', 'prefer', 'beating', 'superior', 'inferior'];
  messages.forEach(row => {
const rawClauses = row.message.split(clauseSplitter);
  const clauses = rawClauses.filter(c => c.trim().length > 1 && !c.match(clauseSplitter));

  clauses.forEach(clause => {
    const tokens = clause.match(/\b\w+\b/g) || [];
    const tokLower = tokens.map(t => t.toLowerCase());

    // 1. Check if this clause is a "Comparison" or a "List"
    const isComparison = tokLower.some(t => COMPARISON_WORDS.includes(t));

    const optHits = OPTIONS.map((opt, i) => {
      const ol = opt.toLowerCase();
      const positions = tokLower.reduce((acc, t, idx) => {
        if (t === ol) acc.push(idx);
        return acc;
      }, []);
      return { id: optIds[i], positions };
    }).filter(o => o.positions.length > 0);

      // --- 2. Sentiment Logic per Clause ---
      optHits.forEach(({ id, positions }) => {
            let finalContrib = 0;

            // SCENARIO A: Only one brand OR it's a list ("Tesla and Rivian are great")
            // We analyze the WHOLE clause sentiment and give it to everyone.
            if (optHits.length === 1 || !isComparison) {
              const result = sentimentAnalyzer.analyze(clause);
              // Lowered threshold slightly to catch mild "good" sentiments
              finalContrib = result.comparative > 0.05 ? 1 : (result.comparative < -0.05 ? -1 : 0);
            } 
            
            // SCENARIO B: A comparison exists ("Tesla is better than Rivian")
            // Fall back to windowing to see which brand is actually near the "better"
            else {
              const pos = positions[0];
              const window = tokens
                .slice(Math.max(0, pos - SENTIMENT_WINDOW), pos + SENTIMENT_WINDOW + 1)
                .join(' ');
              const result = sentimentAnalyzer.analyze(window);
              finalContrib = result.comparative > 0.08 ? 1 : (result.comparative < -0.08 ? -1 : 0);
            }

            scores[id] += finalContrib;
          });
    });

    // --- 3. Pairwise Edges & Aspect Extraction (Keep existing logic) ---
    // Note: Use full message for edges/aspects to maintain context
    const fullTokens = row.message.match(/\b\w+\b/g) || [];
    const fullTokLower = fullTokens.map(t => t.toLowerCase());
    
    const mentioned = optLower.reduce((acc, opt, i) => {
      if (fullTokLower.includes(opt)) acc.push(optIds[i]);
      return acc;
    }, []);

    for (let i = 0; i < mentioned.length; i++) {
      for (let j = i + 1; j < mentioned.length; j++) {
        const key = mentioned[i] + '-' + mentioned[j];
        edgeCounts[key] = (edgeCounts[key] || 0) + 1;
      }
    }

    // Aspects via LLM only (cached after first call)
    const aspects = getLLMAspects(row.id, row.message);
    aspects.forEach(a => {
      aspectMap[a] = (aspectMap[a] || 0) + 1;
      if (recentIds.has(row.id)) recentAspects.add(a);
    });
  });

  // Formatting results for the response
  const edges = Object.entries(edgeCounts)
    .map(([key, weight]) => { 
      const [a, b] = key.split('-'); 
      return { a, b, weight }; 
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 20);

  const aspects = Object.entries(aspectMap)
    .filter(([, c]) => c >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 16)
    .map(([label, count]) => ({ label, count, isNew: recentAspects.has(label) }));

  res.json({ scores, edges, aspects, messageCount: messages.length });
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));