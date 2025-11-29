import express from "express";
import authen from "./auth.route";
import admin from "./admin.route";

const router = express.Router();

router.use(express.json());

router.get("/", (req, res) => {
    res.status(200).json({ message: "Hello from HQH only // used for testing API" });
});

export default function routes(app: express.Application): void {
    const prefixApi = process.env.API_PREFIX as string;

    router.use("/auth", authen);
    router.use("/admin", admin);

    app.use(prefixApi, router);

    console.log("Routes initialized");
}
