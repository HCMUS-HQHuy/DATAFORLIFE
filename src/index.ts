import 'dotenv/config'
import express from "express";
import cors from "cors";
import path from "path";

import routes from "./routes/index.route";
import {startScheduler} from "./services/ai.service";  

const app: express.Application = express();

const PORT = Number(process.env.PORT) || 8220;

app.use(cors({
    origin: 'https://aqua-safe-fe.vercel.app',  // Set the specific frontend origin
    methods: ['*'],  // Allow all HTTP methods
    credentials: true  // Enable credentials (cookies, etc.)
}));

// Serve static heatmap images
app.use('/heatmaps', express.static(path.join(__dirname, '../public/heatmaps')));

routes(app);
// startScheduler();

app.get('/', (req, res) => {
    res.send('hello from hqh');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
