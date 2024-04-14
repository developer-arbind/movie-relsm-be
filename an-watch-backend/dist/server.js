import express from "express";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from 'uuid';
import { createClient } from 'redis';
import jwt from "jsonwebtoken";
import cookie from "cookie";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
const redis = createClient({
    password: 'jsOeGe8GU4UI2Cs8vjmd88dHctEE7a48',
    socket: {
        host: 'redis-18806.c309.us-east-2-1.ec2.cloud.redislabs.com',
        port: 18806
    }
});
try {
    await redis.connect();
    console.log(process.env.CONNECTION_STRING);
}
catch (err) {
    console.log("Error, while connecting to redis!: ", err);
}
const app = express();
app.use(express.json());
const xrss = {
    origin: process.env.CONNECTION_STRING,
    methods: ["*"]
};
app.use(cors(xrss));
const backend = http.createServer(app);
const wss = new Server(backend, {
    cors: xrss,
});
class RTC {
    constructor(websocket, id, name) {
        this.websocket = websocket;
        this.id = id;
        this.room = "";
        this.name = "";
        this.yourName = name;
        this.passcode = "";
        this.BUNDLED = "";
    }
    joinRoom(room, OC) {
        if (OC) {
            return this.websocket.join(room);
        }
        this.websocket.broadcast.to(OC).emit('send-request', {
            name: this.yourName,
            id: this.id
        });
    }
    onAcceptance(room) {
        this.joinRoom(room);
    }
    ;
    directJoinforOC(room) {
        this.websocket.join(room);
    }
    async createRoom(name) {
        this.room = uuidv4();
        this.name = name;
        const secretToken = this.generateRandomToken(34);
        await redis.rPush("key", JSON.stringify({
            room: this.room,
            passcode: this.passcode,
            name,
            token: this.generateRandomToken(64),
            jsecret: secretToken,
            OC: this.id
        }));
        this.websocket.join(this.room);
        return `${process.env.ENDPOINT}/${this.room}`;
    }
    generateRandomToken(length) {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let token = '';
        for (let i = 0; i < length; i++) {
            const randomIndex = Math.floor(Math.random() * charset.length);
            token += charset[randomIndex];
        }
        return token;
    }
    pushVerificationCode(bundled) {
        // await redis.set("hcode", JSON.stringify(bundled));
        this.BUNDLED = bundled;
    }
    removePushVerification() {
        this.BUNDLED = {};
    }
    getPushVerificaation() {
        return this.BUNDLED;
    }
}
let server;
let yourName;
wss.on("connection", (websocket) => {
    websocket.join(websocket.id);
    console.log("connected!");
    server = new RTC(websocket, websocket.id, yourName);
    websocket.on("on:reject", (roomname) => {
        websocket.emit("you:got:rejected", roomname);
    });
    websocket.on("on:acceptance", (room) => {
        server.onAcceptance(room);
    });
});
app.post("/:room", async (Req, Res) => {
    const { token, passcode } = Req.query;
    const room = Req.params.room;
    const encodedJWT = Req.body.ejwt;
    if (encodedJWT) {
        if (!room || !token)
            return Res.status(404).json({
                error: "page not found!",
                code: process.env.PAGENOTFOUND
            });
        const rooms = await redis.lRange("key", 0, -1);
        const rm = rooms.filter(r => JSON.parse(r).room === room);
        if (rm.length === 0) {
            const cookieOptions = {
                httpOnly: true,
                expires: new Date(0)
            };
            const cookieString = cookie.serialize('jwtToken', '', cookieOptions);
            Res.setHeader('Set-Cookie', cookieString);
            return Res.status(401).json({
                error: "OC removed the room!",
                code: 401
            });
        }
        const decodedJWT = jwt.verify(encodedJWT, JSON.parse(rm[0]).secretToken);
        if (decodedJWT === JSON.parse(rm[0]).room) {
            return server.joinRoom(JSON.parse(rm[0]).room);
        }
        return Res.status(500).json({
            error: "server error! try again later",
            code: 500
        });
    }
    if (token) {
        let pass = server.getPushVerificaation();
        if (!pass.passcode)
            return Res.status(404).json({
                error: "page not found!",
                code: process.env.PAGENOTFOUND
            });
        if (pass.hasOwnProperty("passcode") && pass?.passcode !== passcode) {
            return Res.status(process.env.FORBIDDEN ? +process.env.FORBIDDEN : 403).json({
                error: "Incorrect passcode",
                code: process.env.FORBIDDEN
            });
        }
        ;
        pass = JSON.stringify(pass);
        server.removePushVerification();
        const cookieOptions = {
            httpOnly: true,
        };
        const token = jwt.sign({
            data: JSON.parse(pass).room
        }, JSON.parse(pass).jsecret, { expiresIn: '24h' });
        const cookieString = cookie.serialize('jwtToken', token, cookieOptions);
        server.joinRoom(JSON.parse(pass).room, JSON.parse(pass).OC);
        Res.setHeader('Set-Cookie', cookieString);
        return Res.status(200).json({
            message: "you successfully entered the room"
        });
    }
    const rooms = await redis.lRange("key", 0, -1);
    const rm = rooms.filter(r => JSON.parse(r).room === room);
    if (rm.length === 0) {
        return Res.status(404).json({
            error: "Incorrect Room Id",
            code: 404
        });
    }
    ;
    server.pushVerificationCode({
        passcode: JSON.parse(rm[0]).passcode,
        token: JSON.parse(rm[0]).token,
        jsecret: JSON.parse(rm[0]).jsecret,
        room: JSON.parse(rm[0]).room,
        OC: JSON.parse(rm[0]).OC
    });
    Res.status(200).json({
        message: "valid room id",
        token: JSON.parse(rm[0]).token
    });
});
app.get("/oc-token", async (Req, Res) => {
    const authorization = { ssl: "ws://@ocadmintoken" };
    const cookieOptions = {
        httpOnly: true,
    };
    const token = jwt.sign({
        data: JSON.stringify(authorization)
    }, process.env.JWTVERIFIER, { expiresIn: '24h' });
    const cookieString = cookie.serialize('oc-token', token, cookieOptions);
    Res.setHeader('Set-Cookie', cookieString);
    return Res.status(200).json({
        code: process.env.SAVED
    });
});
app.get("/verify-oc-token", async (Req, Res) => {
    const oauth = Req.headers.oauth;
    const { room } = Req.query;
    if (!oauth)
        return Res.status(404).json({
            error: "token not found!",
            code: 404
        });
    const decodedJWT = jwt.verify(oauth, process.env.JWTVERIFIER);
    if (JSON.parse(decodedJWT.data).ssl !== { ssl: "ws://@ocadmintoken" }.ssl) {
        return Res.status(403).json({
            error: "Encryption Failed!",
            code: 403
        });
    }
    const rooms = await redis.lRange("key", 0, -1);
    const name = JSON.parse(rooms.filter(r => JSON.parse(r).room === room)[0]).name;
    yourName = name;
    return Res.status(200).json({
        message: "Encryption succeed",
        code: 200,
        list: "OC"
    });
});
const restoreSockets = async (room, Res) => {
    const rooms = await redis.lRange("key", 0, -1);
    if (!rooms)
        return Res.status(404).json({ error: "memory storage, problem!", code: 9001 });
    const rm = rooms.filter(r => JSON.parse(r).room === room);
    server.directJoinforOC(JSON.parse(rm[0]).room);
};
app.get("/connect-admin", async (Req, Res) => {
    const { room } = Req.body.query;
    await restoreSockets(room, Res);
    return Res.status(200).json({
        message: "connected",
        code: 200
    });
});
app.get("/create-room/:payload", async (Req, Res) => {
    const payload = Req.params.payload;
    const endpoint = await server.createRoom(payload);
    return Res.status(200).json({
        message: "room created, successfully",
        endpoint, code: 200
    });
});
app.get("/name/:name", (Req, Res) => {
    const name = Req.params.name;
    yourName = name;
    return Res.status(200).json({
        message: "name, attached!",
        code: 200
    });
});
backend.listen(8080, () => {
    console.log("server running on 8080");
});
//# sourceMappingURL=server.js.map