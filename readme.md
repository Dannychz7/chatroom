# Decision Making with LLMs and Agents — Research Web Platform

A full-stack web application built as part of undergraduate research with **Professor Farhad Mohsin**, exploring the question: *"How can we make fair and equitable group decisions with the help of LLMs?"*

---

## Research Background

Many people know what they want *in context*, but struggle to express it *in the abstract*.

For example, when asked what they want for lunch, someone might say:
> *"Hmmm, I don't know, but I definitely do not want Chinese food or Italian."*

There is no explicit preference stated — only constraints. Conventional decision systems break down here. But LLMs can parse natural language, extract implicit preferences, weight alternatives, and help groups converge on a fair outcome.

Initial work focused on two main problems (Fall 2025 to Spring 2026):
1. **Synthetic data generation** — creating datasets to train and refine logic for group decision-making.
2. **Natural language to structured representation** — converting freeform conversation into a form an LLM can reason over and act on.

---

## Research Questions

- Do LLMs perform better with structured or unstructured input data?
- How do we handle long conversations — what happens when context is lost or truncated?
- How can we extract meaningful signals (preferences, objections, weights) from natural language?
- How do we build a platform that takes a live group chat and uses an LLM to help surface a fair group decision?

---

## Tech Stack

| Layer | Tools |
|---|---|
| LLM Inference | Anthropic Claude, Llama, Qwen (via Ollama) |
| Agent / Extraction | DSPy, `extract.py` (Python) |
| Frontend | HTML, CSS, JavaScript, P5.js |
| Backend | Node.js, Express, Socket.IO |
| Database | SQLite via `better-sqlite3` |
| Sentiment Analysis | AFINN lexicon (`sentiment` npm package) |

---

## Platform Features

- **Real-time group chat** via WebSockets — supports concurrent users with live join/leave notifications
- **Live standings panel** — tracks alternative rankings using a +1 / -1 weighting system updated as preferences emerge
- **Interactive graph (P5.js)** — visualizes alternatives as nodes; edges and weights update as options are discussed together
- **Alternatives panel** — lists all current candidates being considered by the group
- **LLM aspect extraction** — each message is processed by `extract.py` to pull out structured preference signals (e.g., "battery life", "price point")
- **Persistent chat history** via SQLite — new users joining mid-session see prior conversation
- **CSV simulation mode** — load a synthetic dataset to simulate a full group decision session end-to-end
- **Room reference numbers** with password protection (hashed room key)
- **Reply-to-user threading** for contextual conversation tracking
- **Responsive UI** — works on desktop and mobile

---

## Live Demo

**Hosted on Render.com:** [https://votely-mwzo.onrender.com]

> **Note:** The free tier on Render spins down after 15 minutes of inactivity. The first user may experience a ~30 second wake-up delay. Once active, the platform runs smoothly for all concurrent users.

---

## How the Application Works

### Topics and Alternatives

Topics and alternatives are **derived directly from the database filename**, not hardcoded in the app logic.

The naming convention is:
```
<topic>-<OptionA><OptionB><OptionC>.db
```
For example:
- `food-ItalianChineseGreek.db` → topic = `food`, options = `["Italian", "Chinese", "Greek"]`
- `electriccars-TeslaRivianFord.db` → topic = `electriccars`, options = `["Tesla", "Rivian", "Ford"]`

`server.js` parses this at startup using a CamelCase splitter. The `/config` endpoint then exposes the derived topic and options to the frontend, which uses them to build the graph, standings panel, and alternatives list dynamically.

**To run a new experiment with a different topic**, rename the `.db` file using the convention above and update the `dbPath` variable in `server.js`.

> **Note:** The db naming convention was done as a hotfix to some bugs and should be used as a temporany solution for creating subjects and topcis. 

### Point System (Standings)

Standings are computed by the `/analytics` endpoint on demand. The algorithm:

1. Each message is split into clauses at punctuation and contrastive conjunctions (`but`, `however`, `although`, etc.).
2. Within each clause, the system checks which options (e.g., "Italian", "Chinese") are mentioned.
3. Sentiment is scored using the AFINN lexicon:
   - **Single-option clause** or **list** ("Italian and Chinese are great"): whole-clause sentiment is applied to all mentioned options. `+1` if positive, `-1` if negative, `0` if neutral.
   - **Comparison clause** ("Tesla is better than Rivian"): a sliding window around each option's position is analyzed separately, so the right option receives the positive score and the wrong one the negative.
4. Scores accumulate across all messages and are returned as `{ A: 3, B: -1, C: 0 }` where keys are option IDs (`A`, `B`, `C`…).

### Aspect Extraction (LLM)

Each message is also passed to `extract.py` via `spawnSync('python3', ['extract.py', messageText])`. The Python script:
- Sends the message to an LLM (Ollama by default, Anthropic Claude available via a comment toggle).
- Prompts the LLM to return concrete, measurable features or attributes being discussed (e.g., "delivery time", "portion size").
- Filters out stopwords, brand names, sentiment words, and garbage phrases.
- Returns a JSON array of extracted aspects.

Results are **cached per message** in the `message_aspects` table so the LLM is only called once per unique message, even across page reloads or multiple analytics queries.

### Rooms

Rooms are identified by a timestamped ID (e.g., `food-20260415-114602`). The base room name is derived by stripping the timestamp suffix. This means multiple sessions on the same topic share a logical "clean name" while being physically stored as separate room entries in the DB.

The `getDefaultRoom()` function finds the most active room in the database and uses its clean name as the landing room for new users.

---

## API Endpoints

### Public Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Serves `index.html` — the main chat UI |
| `GET` | `/config` | Returns the topic, display name, default room, and options array (id, label, color) derived from the DB filename |
| `GET` | `/rooms` | Returns all distinct rooms in the DB with message count and last-active timestamp |
| `GET` | `/analytics` | Returns live scores (per option), pairwise edge weights, extracted aspects, and total message count |

### Protected Endpoints (require API key)

Pass the key as a query param `?key=YOUR_KEY` or header `x-api-key: YOUR_KEY`. The key is set via the `API_KEY` environment variable.
> **Note:** Once again, the key query param was done as a sloppy way of extracting data, an admin portal should be created for data extraction or login for proper creds

| Method | Path | Description |
|---|---|---|
| `GET` | `/export/json` | Downloads the full message history as a JSON file |
| `GET` | `/export/csv` | Downloads the full message history as a CSV file |
| `GET` | `/stats` | Returns aggregate stats: total messages, unique users, room list, and export URLs |

### WebSocket Events (Socket.IO)

| Direction | Event | Payload | Description |
|---|---|---|---|
| Client → Server | `join` | `{ username, room }` | Joins a room; server responds with history and user list |
| Client → Server | `message` | `{ text, replying_to }` | Sends a chat message; `replying_to` is an optional message ID |
| Server → Client | `history` | Array of message objects | Full room history sent on join |
| Server → Client | `message` | Message object | New message broadcast to all users in the room |
| Server → Client | `userList` | Array of usernames | Updated on join/leave |

---

## Database

The SQLite database is created automatically on first run if it does not exist.

### Schema

**`messages`**
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-incremented |
| `username` | TEXT | User's display name, or `"System"` for join/leave events |
| `message` | TEXT | Raw message content |
| `room_id` | TEXT | Timestamped room ID (e.g., `food-20260415-114602`) |
| `replying_to` | INTEGER | Foreign key → `messages.id`, nullable |
| `timestamp` | DATETIME | UTC, set by SQLite default |

**`message_aspects`**
| Column | Type | Notes |
|---|---|---|
| `message_id` | INTEGER PK | References `messages.id` |
| `aspects` | TEXT | JSON array of extracted aspect strings |

### Changing the Database

To run a new experiment:
1. Create a new `.db` file (or let the server create one on startup) following the naming convention.
2. Update `dbPath` in `server.js` to point to the new file.
3. Restart the server — the topic, options, and room context will update automatically.

---

## Data Collection

### How It Works

The platform collects data in two ways:

**Live sessions:** Users join a room, chat naturally, and the server records every message to SQLite in real time. At any point, an authorized user can call `/export/json` or `/export/csv` to download the full conversation log for offline analysis.

**CSV simulation:** A pre-generated synthetic dataset (users, topics, messages, reply chains) is loaded into the platform and replayed as if real users were live. This allows controlled, reproducible experiments without needing real human participants.

### Synthetic Dataset Format (CSV Simulation)

The CSV should include:
- 10 simulated users
- 3–4 responses per user
- 3 to 5 alternatives
- A `replying_to` column indicating which message each row responds to (to reconstruct conversation threads)

As the simulation plays back, the LLM extracts aspects from each message, scores update in real time, and the P5.js graph adds nodes and edges dynamically.

---

## `extract.py` — LLM Aspect Extraction

`extract.py` is both a **standalone CLI tool** and a **subprocess called by the server**.

### Standalone batch mode (CSV)
```bash
python3 extract.py -i path/to/data.csv -c sentence -d "food" -o output.csv
```
Processes every row in the CSV, extracts aspects per sentence, counts frequency, and saves results.

### Single-sentence mode (used by server)
```bash
python3 extract.py "I really liked the Greek place but not the Italian one"
# Returns: ["flavor profile", "ambiance"]
```
The server calls this form via `spawnSync` and parses the JSON output.

### Switching LLM backends

Two backends are available in `extract.py` — uncomment one block and comment out the other:

- **Ollama (default, local):** Requires Ollama running locally. Set `MODEL` to your preferred model (e.g., `codellama:13b`, `llama3`, `qwen`).
- **Anthropic Claude:** Requires `ANTHROPIC_API_KEY` in your `.env`. Set `MODEL` to a Claude model ID (e.g., `claude-haiku-4-5-20251001`).
> **Note:** This was also done in a sloppy way (due to time), use a config file or settings file that holds or import models, not showing the raw config in plain text in server

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 18.x or higher
- Python 3.9+
- Ollama (or Anthropic API key for Claude)

### Installation

```bash
# 1. Clone the repository
git clone <repo-url>
cd website

# 2. Install Node dependencies
npm install

# 3. Install Python dependencies
pip install ollama pandas anthropic python-dotenv

# 4. (Optional) Create a .env for the Anthropic backend
echo "pref_llm_key=YOUR_API_KEY" > .env

# 5. Start the server
node server.js
```

Visit `http://localhost:3000`.

---

## Suggested Changes

### Application Improvements

1. **Dynamic topic and alternatives creation** — currently, the topic and alternatives are derived from the DB filename at startup, which means changing the topic requires a server restart. Consider adding an admin UI or a `/create-room` endpoint that accepts a topic and list of alternatives, creates a new `.db` file with the correct filename, and switches the server to use it — no restart needed. Ensure the P5.js graph reinitializes accordingly.

2. **Room-specific alternatives** — right now all rooms share the same set of alternatives (from the DB filename). Consider storing a `room_options` table in the DB that maps each room to its own alternatives list, allowing parallel experiments with different topics to run in the same server instance.

3. **Async LLM calls** — `extract.py` is currently called via `spawnSync`, which blocks the Node.js event loop until the Python process returns. For any message volume above light testing, switch to `spawn` with a promise wrapper (or use a job queue like Bull) so that LLM calls are non-blocking and user messages are not delayed.

4. **Production-grade code structure** — the current single-file approach (`index.html`, `server.js`) is fine for research prototyping. For production or larger experiments, consider:
   - Separating JS utilities into a `utils/` directory
   - Migrating to a framework like React (frontend) + Express with route files (backend), or Django + vue.js or flask, etc... 
   - Using environment-based config management (`dotenv`, `config` package)

### Experiment Improvements

1. **Structured LLM output for scoring** — currently, point assignment relies on regex-based keyword matching and lexicon sentiment. Consider extending the LLM prompt in `extract.py` to return a second structured field alongside aspects: `{ aspects: [...], scores: [{ option: "Italian", score: 1 }] }`. This would allow the LLM to directly assign points, removing the dependency on the AFINN lexicon and making scoring more contextually accurate.

2. **Larger and more capable LLMs** — the current setup uses `codellama:13b` locally via Ollama, which produces extractable aspects but can struggle with nuanced natural language. If API access is available, switching the extraction backbone to a larger Claude or GPT-4-class model would greatly improve aspect quality and could allow synthetic sentence generation to be more human-like. The prompt change needed is minimal — adjust the template to: keep sentences to 1–2 max, don't compare every option in one message, add informal punctuation and vocabulary, and keep it short.

3. **Conversation-level LLM tracking** — rather than analyzing messages in isolation, consider adding a second LLM pass (or a second prompt on the same call) that maintains a running summary of the group conversation. This stateful tracker could:
   - Keep track of which options have been discussed and which have not yet come up
   - Flag options with polarized sentiment (e.g., a user who says "I would rather not eat than choose Italian" — this option should likely be excluded)
   - Maintain a running winner explanation: *"Out of options X, Y, Z — option Y is currently winning because users A and B have expressed strong dislike for X and Z, while user C is neutral on X and Y but strongly opposed to Z. Y is the Condorcet-style choice: no one goes home unhappy."*
   - Suggest undiscussed options to nudge the conversation toward full coverage before a decision is made

