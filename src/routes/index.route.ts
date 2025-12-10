import express from "express";
import authen from "./auth.route";
import admin from "./admin.route";
import floodDepth from "./floodDepth.route";

import jwt from "jsonwebtoken";

const router = express.Router();

router.use(express.json());

router.get("/", (req, res) => {
    res.status(200).json({ message: "Hello from HQH only // used for testing API" });
});

const midAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
        // Kiểm tra xem header Authorization có tồn tại không
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({ message: "No token provided" });
        }

        // Lấy token từ header Authorization
        const token = authHeader.replace("Bearer ", "");

        if (!token) {
            return res.status(401).json({ message: "JWT token is missing" });
        }

        // Kiểm tra tính hợp lệ của token
        jwt.verify(token, process.env.JWT_SECRET as string, (err, decoded) => {
            if (err) {
                console.error("JWT verification failed", err);
                return res.status(401).json({ message: "Unauthorized, invalid token" });
            }
            next(); // Chuyển sang middleware tiếp theo
        });
    } catch (err) {
        console.error("Error in auth middleware:", err);
        res.status(401).json({ message: "Unauthorized, invalid token" });
    }
};


export default function routes(app: express.Application): void {
    const prefixApi = process.env.API_PREFIX as string;

    router.use("/auth", authen);
    router.use("/admin", midAuth, admin);
    router.use("/flood-depth", floodDepth);

    app.use(prefixApi, router);

    console.log("Routes initialized");
}
