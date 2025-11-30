import 'dotenv/config'
import express from "express";
import cors from "cors";
import path from "path";

import routes from "./routes/index.route";

const app: express.Application = express();

const PORT = Number(process.env.PORT) || 8220;

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true
}));

// Serve static heatmap images
app.use('/heatmaps', express.static(path.join(__dirname, '../public/heatmaps')));

routes(app);

app.get('/', (req, res) => {
    res.send('hello from hqh');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
