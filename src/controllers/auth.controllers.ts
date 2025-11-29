import { Request, Response } from "express";
import jwt from "jsonwebtoken";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "secret";
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

function createToken(payload: object) {
    return (jwt.sign as any)(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export default {
  login: (req: Request, res: Response) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ message: "username and password are required" });
    }

    const isValid = username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
    if (!isValid) {
      return res.status(401).json({ message: "invalid credentials" });
    }

    const token = createToken({ username });
    return res.status(200).json({ message: "login successful", token });
  },
};
