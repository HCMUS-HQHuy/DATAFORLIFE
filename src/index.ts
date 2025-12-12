import 'dotenv/config';
import express from "express";
import cors from "cors";
import path from "path";

import routes from "./routes/index.route";
import { startScheduler } from "./services/ai.service";

const app = express();

const PORT = Number(process.env.PORT) || 8220;

// Create one CORS config object
const corsOptions = {
    origin: 'https://aqua-safe-fe.vercel.app',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
    credentials: true,
    optionsSuccessStatus: 200
};

// Apply CORS for all requests including preflight
app.use(cors(corsOptions));

// Explicitly handle OPTIONS with SAME config
app.options('*', cors(corsOptions));

// Serve static heatmap images
app.use('/heatmaps', express.static(path.join(__dirname, '../public/heatmaps')));

// Parse JSON body
app.use(express.json());

routes(app);

app.get('/', (req, res) => {
    res.send('hello from hqh');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
