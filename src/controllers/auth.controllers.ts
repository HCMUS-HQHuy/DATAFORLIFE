import express from "express";
import jwt from "jsonwebtoken";

import util from "src/utils/index.utils";
import schemas from "src/schemas/index.schema";
import prisma from "src/models/prismaClient";

import { LoginForm, UserInfor } from "src/types/index.types";

async function validateToken(req: express.Request, res: express.Response) {
    const token = req.cookies["auth_jwt"];
    if (!token) {
        return res.status(200).json(util.response.error("No token provided"));
    }
    return res.status(200).json(util.response.success("Token is valid"));
}

async function login(req: express.Request, res: express.Response) {
    const parsedBody = schemas.form.login.safeParse(req.body);
    if (!parsedBody.success) {
        return res.status(200).json(util.response.zodValidationError(parsedBody.error));
    }
    const credential: LoginForm = parsedBody.data;
    try {
        const userInfo = await prisma.users.findFirst({
            where: {
                email: credential.email
            },
            select: {
                userId: true,
                username: true,
                password: true,
                role: true
            }
        });
        if (userInfo === null) {
            return res.status(401).json(util.response.error("Invalid credentials"));
        }
        if (!util.password.compare(credential.password, userInfo.password)) {
            return res.status(401).json(util.response.error("Invalid credentials"));
        }
        console.log("User logged in:", userInfo);
        const user: UserInfor = { userId: userInfo.userId, username: userInfo.username, role: userInfo.role, shop: null };
        const token = jwt.sign(user, process.env.JWT_SECRET as string, { expiresIn: "1y" }); // 1y = 1 year for testing purposes
        res.cookie("auth_jwt", token, {
            path: "/",
            httpOnly: true,
            secure: true,
            sameSite: "none",
            maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year in milliseconds
        });
        return res.status(201).json(util.response.success("Login successful", {userInfor: user}));
    } catch (error: any) {
        console.error("Authentication error:", error);
        return res.status(501).json(util.response.internalServerError());
    }
}

function logout(req: express.Request, res: express.Response) {
    res.clearCookie("auth_jwt");
    return res.status(200).json(util.response.success("Logout successful"));
}

const authenController = {
    validateToken,
    login,
    logout
}

export default authenController;