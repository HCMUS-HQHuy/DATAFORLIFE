import 'dotenv/config'
import express from "express";

import routes from "./routes/index.routes";

const app: express.Application = express();

const PORT = process.env.PORT || 8220;

app.get('/', (res: any, req: any)=> {
    req.send('hello from hqh');
});
