import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.BONARIO_PORT || 3001;

app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: false
}));

app.use(express.json({ limit: '256kb' }));

app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, '../bonario-frontend'), {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../bonario-frontend/index.html'));
});

app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use((err, req, res, next) => {
  console.error('[Bonario] Error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Bonario Ads Report Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
});

function shutdown(signal) {
  console.log(`[Bonario] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('[Bonario] HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;