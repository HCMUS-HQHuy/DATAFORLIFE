import express from "express";
import authenController from "src/controllers/auth.controller";

const route = express.Router();

route.post("/login", authenController.login);

export default route;
