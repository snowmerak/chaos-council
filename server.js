import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runDebate } from './lib/debate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// SSE debate endpoint
app.post('/api/debate/start', async (req, res) => {
  const { topic, turns = 9 } = req.body;

  if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    await runDebate(topic.trim(), Math.min(Math.max(1, turns), 20), sendEvent);
    sendEvent({ type: 'done', data: {} });
  } catch (err) {
    console.error('Debate error:', err);
    sendEvent({ type: 'error', data: { message: err.message } });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`🎭 Chaos Council is running at http://localhost:${PORT}`);
});
