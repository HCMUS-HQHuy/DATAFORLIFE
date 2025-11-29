import express from "express";
import authenController from "src/controllers/auth.controllers";

const route = express.Router();

route.post("/login", authenController.login);

export default route;
