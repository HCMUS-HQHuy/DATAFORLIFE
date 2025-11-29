import 'dotenv/config'
import express from "express";

import routes from "./routes/index.routes";

const app: express.Application = express();

const PORT = Number(process.env.PORT) || 8220;

// Attach routes with prefix
routes(app);

// Health check
app.get('/', (req, res) => {
    res.send('hello from hqh');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
