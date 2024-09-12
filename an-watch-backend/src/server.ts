import express, { Request, Response } from "express";
import http from "http";
import { Socket, Server } from "socket.io";
import { uuid as uuidv4 } from "uuidv4";
import { TimeSeriesDuplicatePolicies, createClient } from "redis";
import jwt, { JwtPayload, Secret } from "jsonwebtoken";
import cookie from "cookie";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
import cookieParser from "cookie-parser";
// import fernet from "fernet";
import CryptoJS from "crypto-js";
// const secret = new fernet.Secret(process.env.CIPHERTEXT_ALGORITHM as string);
const secretToken = process.env.CIPHERTEXT_ALGORITHM as string;
const redis = createClient();

/** @{param}
 * {
    password: 'jsOeGe8GU4UI2Cs8vjmd88dHctEE7a48',
    socket: {
        host: 'redis-18806.c309.us-east-2-1.ec2.cloud.redislabs.com',
        port: 18806
    }
}
 */

try {
  await redis.connect();
  console.log(process.env.CONNECTION_STRING);
} catch (err) {
  console.log("Error, while connecting to redis!: ", err);
}
interface SDPsType {
  offer?: RTCSessionDescription;
  ans?: RTCSessionDescription;
  user2: String;
}

const app = express();
app.use(express.json());
app.use(cookieParser());
const xrss = {
  origin: "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
};
app.use(cors(xrss));
const backend = http.createServer(app);
const wss = new Server(backend, {
  cors: xrss,
});

interface BUNDLED {
  passcode: string;
  token: string;
  jsecret: string;
  room: string;
  OC: string;
}
interface IP {
  ip: string;
  lastCharIndex?: number;
  socketId: string;
  isOc: boolean;
  streamReady: boolean;
  name: string;
}
interface ROOM {
  room: string;
  passcode: string;
  name: string;
  token: string;
  jsecret: string;
  OC: string;
  ips: Array<IP>;
}
let userRTCClasses: Array<{ socketId: string; server: RTC }> = [];
const rtcServer = (Req: Request, Res: Response) => {
  // console.log("all servers: ", userRTCClasses);
  let server = userRTCClasses.filter(
    (srv) => srv.socketId === Req.headers["socket-id"]
  )[0]?.server;
  if (!server)
    return Res.status(403).json({
      error: "blocked, this action was not allowed",
      code: process.env.FORBIDDEN,
    });

  return server;
};
class RTC {
  private websocket: Socket;
  public id: string;
  public room: string;
  private passcode: string;
  private name: string;
  public yourName = "";
  private ipv4: string;
  private BUNDLED: BUNDLED | {};
  private verified: boolean;
  public roomName = "";
  constructor(websocket: Socket, id: string) {
    this.websocket = websocket;
    this.id = id;
    this.room = "";
    this.name = "";
    this.passcode = "";
    this.BUNDLED = "";
    this.verified = false;
    this.ipv4 = "";
  }
  detatchOc() {
    this.verified = true;
  }

  setIp(ip: string) {
    this.ipv4 = ip;
  }
  joinRoom(OC: string) {
    // console.log("my name is ", this.yourName);
    wss.to(OC).emit("send:request", {
      name: this.yourName,
      id: this.id,
    });
  }

  async onAcceptance(room: string) {
    this.websocket.join(room);
    let rooms = await redis.lRange("key", 0, -1);
    const rm = JSON.parse(
      rooms.filter((r) => (JSON.parse(r).room as string) === room)[0] || "{}"
    );
    // console.log("acceptance room: ", rm, room);
    const token = jwt.sign(
      {
        data: room,
      },
      rm.jsecret,
      { expiresIn: "24h" }
    );
    let encJson = CryptoJS.AES.encrypt(
      JSON.stringify(token),
      secretToken
    ).toString();
    let chipertextCryption = CryptoJS.enc.Base64.stringify(
      CryptoJS.enc.Utf8.parse(encJson)
    );
    rm.ips.push({
      ip: this.ipv4,
      lastCharIndex: chipertextCryption.length - 1,
      socketId: this.id,
      isOc: false,
      streamReady: false,
      name: this.yourName,
    } as IP);
    let index = rooms.findIndex((rt) => JSON.parse(rt).room === room);
    // console.log("the index: ", index);
    if (index === -1) return new Error("Redis Crashed!");
    rooms[index] = JSON.stringify(rm);

    await redis.lSet("key", index, rooms[index]);
    // console.log("updated room index: ", rooms[index]);
    this.websocket.emit(
      "booked:token",
      chipertextCryption +
        (() =>
          [...Array(Math.floor(Math.random() * 20))]
            .map(
              () =>
                "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ="[
                  Math.floor(Math.random() * 63)
                ]
            )
            .join(""))()
    );
  }
  async nonAdminDirectJoin(room: string) {
    this.websocket.join(room);
    let rooms = await redis.lRange("key", 0, -1);
    const index = rooms.findIndex((r) => JSON.parse(r).room === room);

    if (index === -1) {
      console.error("No room found!");
      return;
    }

    const rm = JSON.parse(rooms[index]);
    // console.log("before changing: ", [...rm.ips]);
    let stack: string = "";
    for (let i = 0; i < rm.ips.length; i++) {
      if (rm.ips[i].ip === this.ipv4) {
        stack = rm.ips[i].socketId;
        // console.log("the update ip: ", this.id, rm.ips[i].socketId);
        rm.ips[i].socketId = this.id;
        break;
      }
    }
    rooms[index] = JSON.stringify(rm);
    // console.log("after changed: ", rm, rooms[index]);
    await redis.lSet("key", index, rooms[index]);

    wss.to(stack).emit("leave:invitation:for:you", { room, socketId: this.id });
    this.websocket.emit("direct:join:for:you", room);
  }

  async updateStreamCondition(room: string) {
    this.websocket.join(room);
    let rooms = await redis.lRange("key", 0, -1);
    const index = rooms.findIndex((r) => JSON.parse(r).room === room);

    if (index === -1) {
      console.error("No room found!");
      return;
    }

    const rm = JSON.parse(rooms[index]) as { ips: Array<IP> };
    for (let i = 0; i < rm.ips.length; i++) {
      if (rm.ips[i].ip === this.ipv4) {
        rm.ips[i].streamReady = true;
        break;
      }
    }
    rooms[index] = JSON.stringify(rm);
    await redis.lSet("key", index, rooms[index]);

    console.log("Light: does everything as planned: ", rm.ips);
  }
  async directJoinforOC(room: string, ipv6?: string) {
    this.websocket.join(room);
    let rooms = await redis.lRange("key", 0, -1);

    const index = rooms.findIndex((r) => JSON.parse(r).room === room);

    if (index === -1) {
      console.error("No room found!");
      return;
    }

    const rm = JSON.parse(rooms[index]);
    let ipExistance = false;
    for (let i = 0; i < rm.ips.length; i++) {
      if (rm.ips[i].ip === ipv6) {
        rm.ips[i].socketId = this.id;
        ipExistance = true;
        break;
      }
    }
    rm.OC = this.id;
    if (!ipExistance) {
      rm.ips.push({
        ip: ipv6,
        socketId: this.id,
        isOc: true,
        streamReady: true,
        name: this.yourName,
      } as IP);
    }
    rooms[index] = JSON.stringify(rm);
    await redis.lSet("key", index, rooms[index]);
  }

  viceVersa(
    rootA: string,
    { room, socketId }: { room: string; socketId: string }
  ) {
    wss.to(rootA).emit("vice:versa", { room, socketId });
  }

  forcefulleaveRoom() {
    const currentServerIndex = userRTCClasses.findIndex(
      (srv) => srv.socketId == this.ipv4
    );
    if (currentServerIndex === -1) {
      return console.log("Ocps not found! haha");
    }

    userRTCClasses.splice(currentServerIndex, 1);
  }

  getOutFromRoom(room: string) {
    this.websocket.leave(room);
    this.websocket.disconnect();
  }

  async createRoom(name: string, Req: Request, passcode: string) {
    const ip = Req.headers["x-forwarded-for"] || Req.connection.remoteAddress;
    this.room = uuidv4();
    this.detatchOc();
    this.name = name;
    this.passcode = passcode;
    const secretToken = this.generateRandomToken(34);
    await redis.rPush(
      "key",
      JSON.stringify({
        room: this.room,
        passcode,
        name,
        token: this.generateRandomToken(64),
        jsecret: secretToken,
        OC: this.id,
        ips: [] as Array<IP>,
      } as ROOM)
    );
    await redis.rPush(
      "oc-ips",
      JSON.stringify({
        runningRoom: true,
        ocOf: this.room,
        ip,
      })
    );
    this.websocket.join(this.room);
    return `${process.env.ENDPOINT}/${this.room}`;
  }

  async deleteRoom(room: string, server: RTC) {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    if (!ids) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === this.id) continue;
      wss.to(ids[i].socketId).emit("room:deleted:by:admin");
    }
    await redis.lRem("key", 1, JSON.stringify({ room: room }));
    await redis.lRem("oc-ips", 1, JSON.stringify({ ocOf: room }));
  }

  generateRandomToken(length: number): string {
    const charset =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      token += charset[randomIndex];
    }
    return token;
  }

  pushVerificationCode(bundled: BUNDLED) {
    // await redis.set("hcode", JSON.stringify(bundled));
    this.BUNDLED = bundled;
  }
  removePushVerification() {
    this.BUNDLED = {};
  }
  getPushVerificaation() {
    return this.BUNDLED;
  }
  generateRandomNumbers(count: number) {
    const numbers = [];
    for (let i = 0; i < count; i++) {
      const randomNumber = Math.floor(Math.random() * 9e17) + 1e17;
      numbers.push(randomNumber);
    }
    return numbers;
  }

  sendOffer(
    offer: RTCSessionDescriptionInit,
    socketId: string,
    mySocketId: string
  ) {
    wss
      .to(socketId)
      .emit("get:remote:offer", { offer, whomSocketId: mySocketId });
  }

  sendAnswer(answer: RTCSessionDescriptionInit, socketId: string) {
    wss.to(socketId).emit("get:remote:answer", { answer });
  }
  async getAllSocketsOfARoom(room: string, sendingId?: boolean) {
    const rooms = await redis.lRange("key", 0, -1);
    if (rooms.length === 0) {
      return console.log("error: no rooms found!");
    }
    const calledRoom = JSON.parse(
      rooms.filter((r) => JSON.parse(r).room === room)[0] || "{}"
    );
    const ids = calledRoom.ips;

    // console.log("postgrade ips: ", ids, calledRoom);
    sendingId ? this.websocket.emit("get:ids", ids) : null;
    // console.log("kyaa horrhehai ye???");
    return ids;
  }

  sendNegotiation(
    offer: RTCSessionDescriptionInit,
    socketId: string,
    whomSocketId: string
  ) {
    // console.log("it is my socket id bro: ", whomSocketId, socketId);
    wss.to(socketId).emit("get:negotiation", { offer, socketId: whomSocketId });
  }
  sendNegotiationAnswer(answer: RTCSessionDescriptionInit, socketId: string) {
    wss.to(socketId).emit("get:negotiation:answer", { answer });
  }
}

const detectIp = async (Req: Request) => {
  let memory = await redis.lRange("key", 0, -1);
  const ip = Req.headers["x-forwarded-for"] || Req.connection.remoteAddress;
  const pointer = memory.findIndex((locator) =>
    JSON.parse(locator).ips.some((item: IP) => item.ip === ip)
  );

  if (pointer > -1) {
    console.log("room found!");
    return true;
  }

  return false;
};

wss.on("connection", (websocket: Socket) => {
  websocket.join(websocket.id);

  console.log("connected!");
  const server = new RTC(websocket, websocket.id);
  userRTCClasses.push({
    socketId: websocket.id,
    server,
  });

  // console.log("console.server: ", userRTCClasses);
  websocket.emit("your:socket:id", websocket.id);
  websocket.on("direct:join", (event: { room: string; ip: string }) => {
    server.directJoinforOC(event.room, event.ip);
  });

  websocket.on("set:timeline", ({ room, timeline }) => {
    sendSync(
      room,
      {
        intension: false,
        relative: false,
      },
      { intension: false, relative: false },
      { intension: false, relative: false },
      { intension: true, relative: false, rate: 0 },
      { intensive: true, time: timeline }
    );
  });
  websocket.on("on:acceptance", (room: string) => {
    server.onAcceptance(room);
  });
  websocket.on("sign:accept", (json: { socketId: string; room: string }) => {
    wss.to(json.socketId).emit("you:got:acccepted", json.room);
  });
  websocket.on("leave:forcefull", () => {
    // console.log("ok he just wansts to leave now: ", room);
    server.forcefulleaveRoom();
  });
  websocket.on("kick:out", (room) => {
    server.getOutFromRoom(room);
  });
  websocket.on("set:stream:ready", (room) => {
    console.log("is there something happening?: let's see: ", room);
    server.updateStreamCondition(room);
  });
  websocket.on("get:receiver:local:track", (socketId: string) => {
    wss.to(socketId).emit("track:ready");
  });

  websocket.on("send:message", async ({ room, message, uuid }) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    if (!ids) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss.to(ids[i].socketId).emit("get:someone:message", {
        name: server.yourName,
        message,
        socketId: ids[i].socketId,
        uuid
      });
    }
  });

  let bucketStack: Array<IP[]> = [];
  let typedBucked: Array<{
    socketId: string;
  }> = [];
  websocket.on("set:you:are:typing", async (room) => {
    let ids: IP[];
    if (bucketStack.length === 0) {
      ids = await server.getAllSocketsOfARoom(
        server.roomName ? server.roomName : room
      );
      bucketStack[0] = ids;
      console.log("let suppose typing$");
    } else {
      ids = bucketStack[0];

      console.log("let suppose typing!");
    }

    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      let hasAlready = typedBucked.some(
        (vl) => vl.socketId === ids[i].socketId
      );
      console.log("has aleady: ", hasAlready);
      wss.to(ids[i].socketId).emit("get:someone:typing", {
        name: server.yourName,
        socketId: websocket.id,
        pre: hasAlready,
      });
      typedBucked.push({
        socketId: ids[i].socketId,
      });
    }
  });

  websocket.on("kick:out:user", (socketId) => {
    wss.to(socketId).emit("you:are:kicked:out");
  });
  websocket.on("user:stopped:typing", async (room) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    if (!ids) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss.to(ids[i].socketId).emit("get:someone:stops:typing", websocket.id);

      let opposite = typedBucked.filter(
        (el) => el.socketId !== ids[i].socketId
      );
      typedBucked = [...opposite];
    }
  });

  websocket.on("send:emoji:reaction", async ({ room, id }) => {
    console.log("Hello there, is it comming here or not: ", room, id);
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    if (!ids) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss
        .to(ids[i].socketId)
        .emit("someone:sends:emoji", { socketId: websocket.id, id });
    }
  });

  websocket.on("pause:due:out:of:visiblity", async (room) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    if (!ids) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss.to(ids[i].socketId).emit("on:someone:pause:controller", websocket.id);
    }
  });

  websocket.on("i:am:speaking", async (room) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss.to(ids[i].socketId).emit("on:someone:speaking", websocket.id);
    }
  });

  websocket.on("i:am:stopped:speaking", async (room) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    if (!ids) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss.to(ids[i].socketId).emit("on:someone:stopped:speaking", websocket.id);
    }
  });
  websocket.on("play:due:of:visiblity", async (room) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );

    if (!ids) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss
        .to(ids[i].socketId)
        .emit("on:someone:resume:controller", websocket.id);
    }
  });

  websocket.on(
    "send:negotiation",
    ({
      offer,
      socketId,
      mySocketId,
    }: {
      offer: RTCSessionDescriptionInit;
      socketId: string;
      mySocketId: string;
    }) => {
      server.sendNegotiation(offer, socketId, mySocketId);
    }
  );

  websocket.on("get:name", async ({ room, socketId }) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );

    if (!ids) return;
    let name: string = "";
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === socketId) {
        name = ids[i].name;
        break;
      }
    }
    if (name) {
      websocket.emit("set:name", name);
    }
  });
  websocket.on("set:mute", async ({ room }) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss.to(ids[i].socketId).emit("on:user:mute", websocket.id);
    }
  });
  websocket.on("set:unmute", async ({ room }) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss.to(ids[i].socketId).emit("on:user:unmute", websocket.id);
    }
  });
  websocket.on("set:video:mute", async ({ room }) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );

    if (!ids) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss.to(ids[i].socketId).emit("on:user:stream:mute", websocket.id);
    }
  });
  websocket.on("set:video:unmute", async ({ room }) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );

    if (!ids) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss.to(ids[i].socketId).emit("on:user:stream:unmute", websocket.id);
    }
  });
  websocket.on(
    "negotiation:complete",
    ({
      answer,
      socketId,
    }: {
      answer: RTCSessionDescriptionInit;
      socketId: string;
    }) => {
      server.sendNegotiationAnswer(answer, socketId);
    }
  );
  websocket.on("negotiate:transfer:file", (socketId) => {
    wss.to(socketId).emit("start:transmission", websocket.id);
  });

  websocket.on(
    "reject:socketid",
    (json: { socketId: string; room: string }) => {
      wss.to(json.socketId).emit("you:got:rejected", json.room);
    }
  );
  interface PolyIn {
    intension: boolean;
    relative: boolean;
  }

  const sendSync = async (
    room: string,
    pause: PolyIn,
    forward: PolyIn,
    increase: PolyIn,
    speed: { intension: boolean; rate: number; relative: boolean },
    Len: { intensive: boolean; time: number }
  ) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    if (!ids) return;

    console.log("do am I comming@@ here??:", ids ? true : false);
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      console.log(
        "intensive and relative: ",
        pause,
        forward,
        increase,
        speed,
        Len
      );
      if (
        pause.intension &&
        !forward.intension &&
        !increase.intension &&
        !speed.intension &&
        !Len.intensive
      ) {
        console.log("but it's like a native one!");
        pause.relative
          ? wss.to(ids[i].socketId).emit("on:someone:pause", websocket.id)
          : wss.to(ids[i].socketId).emit("on:someone:resume", websocket.id);
      } else if (forward.intension && !speed.intension && !increase.intension) {
        forward.relative && !Len.intensive
          ? wss.to(ids[i].socketId).emit("on:someone:forward", websocket.id)
          : wss.to(ids[i].socketId).emit("on:someone:rewind", websocket.id);
      } else if (increase.intension && !speed.intension) {
        increase.relative && !Len.intensive
          ? wss.to(ids[i].socketId).emit("on:someone:increase", websocket.id)
          : wss.to(ids[i].socketId).emit("on:someone:decrease", websocket.id);
      } else if (speed.intension && !Len.intensive) {
        speed.relative
          ? wss.to(ids[i].socketId).emit("on:someone:speed", {
              rate: speed.rate,
              socketId: websocket.id,
            })
          : wss.to(ids[i].socketId).emit("on:someone:slow", {
              rate: speed.rate,
              socketId: websocket.id,
            });
      } else {
        wss.to(ids[i].socketId).emit("on:someone:skip-timeline", {
          from: websocket.id,
          timeline: Len.time,
        });
      }
    }
  };

  websocket.on("set:dragging:portion", async ({ room, timeline }) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    if (!ids) return;

    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;

      wss
        .to(ids[i].socketId)
        .emit("on:dragged:timeline", { user: websocket.id, timeline });
    }
  });

  websocket.on("set:rate:speed", async ({ room, speed }) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    if (!ids) return;

    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;

      wss
        .to(ids[i].socketId)
        .emit("on:playback:speed", { user: websocket.id, speed });
    }
  });
  websocket.on("sync:pause", async (room: string) => {
    sendSync(
      room,
      {
        intension: true,
        relative: true,
      },
      { intension: false, relative: false },
      { intension: false, relative: false },
      { intension: false, relative: false, rate: 0 },
      { intensive: false, time: 0 }
    );
  });
  websocket.on("sync:play", (room) => {
    sendSync(
      room,
      {
        intension: true,
        relative: false,
      },
      { intension: false, relative: false },
      { intension: false, relative: false },
      { intension: false, relative: false, rate: 0 },
      { intensive: false, time: 0 }
    );
  });
  websocket.on("on:forward", (room) => {
    sendSync(
      room,
      {
        intension: false,
        relative: false,
      },
      { intension: true, relative: true },
      { intension: false, relative: false },
      { intension: false, relative: false, rate: 0 },
      { intensive: false, time: 0 }
    );
  });
  websocket.on("on:rewind", (room) => {
    sendSync(
      room,
      {
        intension: false,
        relative: false,
      },
      { intension: true, relative: false },
      { intension: false, relative: false },
      { intension: false, relative: false, rate: 0 },
      { intensive: false, time: 0 }
    );
  });
  websocket.on("on:volume:up", (room) => {
    sendSync(
      room,
      {
        intension: false,
        relative: false,
      },
      { intension: false, relative: false },
      { intension: true, relative: true },
      { intension: false, relative: false, rate: 0 },
      { intensive: false, time: 0 }
    );
  });
  websocket.on("on:volume:down", (room) => {
    sendSync(
      room,
      {
        intension: false,
        relative: false,
      },
      { intension: false, relative: false },
      { intension: true, relative: false },
      { intension: false, relative: false, rate: 0 },
      { intensive: false, time: 0 }
    );
  });
  websocket.on("on:speed:increase:by", ({ room, rate }) => {
    sendSync(
      room,
      {
        intension: false,
        relative: false,
      },
      { intension: false, relative: false },
      { intension: false, relative: false },
      { intension: true, relative: true, rate },
      { intensive: false, time: 0 }
    );
  });
  websocket.on("on:speed:decrease:by", ({ room, rate }) => {
    sendSync(
      room,
      {
        intension: false,
        relative: false,
      },
      { intension: false, relative: false },
      { intension: false, relative: false },
      { intension: true, relative: false, rate },
      { intensive: false, time: 0 }
    );
  });
  websocket.on("send:ids:to:me", (room: string) => {
    server.getAllSocketsOfARoom(room, true);
  });
  websocket.on("set:room:name", (room) => {
    server.roomName = room;
  });
  websocket.on("send:chat:message", async ({ room, message }) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    if (!ids) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;
      wss
        .to(ids[i].socketId)
        .emit("on:chat:message:recieved", { socketId: websocket.id, message });
    }
  });
  websocket.on(
    "i:am:done",
    async ({ room, socketId }: { room: string; socketId: string }) => {
      console.log("user wants to leave$: ", room, server.roomName);
      const ids: IP[] = await server.getAllSocketsOfARoom(
        server.roomName ? server.roomName : room
      );

      if (!ids) return;
      for (let i = 0; i < ids.length; i++) {
        if (ids[i].socketId === websocket.id || ids[i].socketId === socketId)
          continue;
        wss.to(ids[i].socketId).emit("on:user:disconnects", websocket.id);
      }
    }
  );

  websocket.on(
    "send-offer",
    ({
      socketId,
      offer,
      mySocketId,
    }: {
      socketId: string;
      offer: RTCSessionDescriptionInit;
      mySocketId: string;
    }) => {
      server.sendOffer(offer, socketId, mySocketId);
    }
  );

  websocket.on("get:admin:timeline", async (room) => {
    const ids: IP[] = await server.getAllSocketsOfARoom(
      server.roomName ? server.roomName : room
    );
    if (!ids) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i].socketId === websocket.id) continue;

      if (ids[i].isOc) {
        wss.to(ids[i].socketId).emit("pass:the:timeline", websocket.id);

        break;
      }
    }
  });

  websocket.on("send:back:timeline", ({ user, timeline }) => {
    wss.to(user).emit("get:back:the:timeline", timeline);
  });
  websocket.on(
    "send:remote:offer",
    ({
      socketId,
      answer,
    }: {
      socketId: string;
      answer: RTCSessionDescriptionInit;
    }) => {
      server.sendAnswer(answer, socketId);
    }
  );
  websocket.on("delete:room", (room: string) => {
    server.deleteRoom(room, server);
  });
});

app.post("/:room", async (Req: Request, Res: Response) => {
  const server = rtcServer(Req, Res) as RTC;
  const { token, passcode } = Req.query;
  const ip = Req.headers["x-forwarded-for"] || Req.connection.remoteAddress;
  const room = Req.params.room;
  let encodedJWT = Req.body.ejwt;
  if (encodedJWT) {
    try {
      if (!room)
        return Res.status(404).json({
          error: "page not found!",
          code: process.env.PAGENOTFOUND,
        });

      const rooms = await redis.lRange("key", 0, -1);
      let rm: string[] | string = rooms.filter(
        (r) => (JSON.parse(r).room as string) === room
      );
      if (!JSON.parse(rm[0]).room) {
        return Res.status(409).json({
          error: "OC endedup this room",
          code: 409,
        });
      }
      rm = rm[0];
      const ips = JSON.parse(rm).ips;
      let lastIndex = 0;
      let sendAhead = false;
      for (let i = 0; i < ips.length; i++) {
        if (ips[i].ip === ip) {
          // console.log("post last index: ", ips[i].lastCharIndex);
          sendAhead = true;
          lastIndex = ips[i].lastCharIndex;
          break;
        }
      }
      // console.log("post ips: ", ips, rm);
      if (!sendAhead) {
        return Res.status(403).json({
          error: "action blocked, due to unauthorized access",
        });
      }
      // console.log("encoded first: ", encodedJWT);
      encodedJWT = encodedJWT.slice(0, lastIndex);
      // console.log("encoded second: ", encodedJWT);
      let decData = CryptoJS.enc.Base64.parse(encodedJWT).toString(
        CryptoJS.enc.Utf8
      );
      let encryptedToken = CryptoJS.AES.decrypt(decData, secretToken).toString(
        CryptoJS.enc.Utf8
      );
      encryptedToken = encryptedToken.replace(/"/g, "");
      // console.log("verified token: ", encryptedToken);
      const parser = jwt.verify(
        encryptedToken as unknown as string,
        JSON.parse(rm).jsecret as Secret
      ) as JwtPayload;
      // console.log("post parser: ", parser);
      if (parser.data === room) {
        server.nonAdminDirectJoin(room);
        return Res.status(200).json({
          message: "socket connection returned",
          code: 200,
        });
      }
      const detecting = await detectIp(Req);
      if (detecting) {
        return Res.status(400).json({
          error: "end one room, before creating one",
          code: 400,
        });
      }
      return Res.status(403).json({
        message: "action was blocked, due to unauthorized access",
        code: 403,
      });
    } catch (err: any) {
      return Res.status(403).json({
        messgae: "failed, distructing token",
        code: 403,
      });
    }
  }
  if (token) {
    let pass: BUNDLED | string = server.getPushVerificaation() as BUNDLED;
    if (!pass.passcode)
      return Res.status(404).json({
        error: "page not found!",
        code: process.env.PAGENOTFOUND,
      });
    if (pass.hasOwnProperty("passcode") && pass?.passcode !== passcode) {
      return Res.status(
        process.env.FORBIDDEN ? (+process.env.FORBIDDEN as number) : 403
      ).json({
        error: "Incorrect passcode",
        code: process.env.FORBIDDEN,
      });
    }
    pass = JSON.stringify(pass);
    server.joinRoom(JSON.parse(pass).OC);

    server.removePushVerification();
    return Res.status(200).json({
      message: "sent for acceptance",
      code: 200,
    });
  }
  const detecting = await detectIp(Req);
  if (detecting) {
    return Res.status(400).json({
      error: "end one room, before creating one",
      code: 400,
    });
  }
  const rooms = await redis.lRange("key", 0, -1);
  const rm = JSON.parse(
    rooms.filter((r) => (JSON.parse(r).room as string) === room)[0] || "{}"
  );
  if (!rm.hasOwnProperty("jsecret")) {
    return Res.status(404).json({
      error: "Incorrect Room Id",
      code: 404,
    });
  }
  server.pushVerificationCode({
    passcode: rm.passcode,
    token: rm.token,
    jsecret: rm.jsecret,
    room: rm.room,
    OC: rm.OC,
  });
  Res.status(200).json({
    message: "valid room id",
    token: rm.token,
  });
});

app.get("/oc-token", async (Req: Request, Res: Response) => {
  const server = rtcServer(Req, Res) as RTC;
  const ip = Req.headers["x-forwarded-for"] || Req.connection.remoteAddress;
  // console.log("my ip address: ", ip);
  server.setIp(ip as string);
  const rooms = await redis.lRange("key", 0, -1);

  const JWTVERIFIER = JSON.parse(
    rooms.filter((r) => (JSON.parse(r).room as string) === server.room)[0] ||
      "{}"
  ).jsecret;
  const authorization = { ssl: JWTVERIFIER };
  const token = jwt.sign(
    {
      data: JSON.stringify(authorization),
    },
    process.env.JWTVERIFIER as string,
    { expiresIn: "24h" }
  );
  // const chipertextCryption = new fernet.Token({
  //   secret: secret,
  //   time: Date.parse("1"),
  //   iv: server.generateRandomNumbers(16),
  // });
  // const chipertextCryption = CryptoJS.AES.encrypt(
  //   token,
  //   secretToken
  // ).toString();
  let encJson = CryptoJS.AES.encrypt(
    JSON.stringify(token),
    secretToken
  ).toString();
  let chipertextCryption = CryptoJS.enc.Base64.stringify(
    CryptoJS.enc.Utf8.parse(encJson)
  );

  const chipertext = chipertextCryption;
  const cookieString = cookie.serialize("octoken", chipertext, {
    httpOnly: false,
    secure: false,
    path: "/",
    sameSite: "strict",
  });
  Res.setHeader("Set-Cookie", cookieString);
  return Res.status(200).json({
    code: process.env.SAVED,
  });
});
app.get("/verify-oc-token/:room", async (Req: Request, Res: Response) => {
  const server = rtcServer(Req, Res) as RTC;
  try {
    const ip = Req.headers["x-forwarded-for"] || Req.connection.remoteAddress;
    server.setIp(ip as string);
    // console.log("your ip address is : ", ip);
    const room = Req.params.room;
    const cache = await redis.lRange("key", 0, -1);
    const folder = cache.filter((r) => JSON.parse(r).room === room);
    if (folder.length === 0) {
      return Res.status(404).json({
        error: "no Room found!",
        code: 404,
      });
    }
    const ocIps = await redis.lRange("oc-ips", 0, -1);
    const exactIp = JSON.parse(
      ocIps.filter(
        (rI) => JSON.parse(rI).ip === ip && JSON.parse(rI).ocOf === room
      )[0] || "{}"
    );
    // console.log("comming here: ", exactIp);
    if (!exactIp.hasOwnProperty("ocOf") || ip !== exactIp.ip) {
      return Res.status(403).json({
        error: "action blocked, due to unauathorize access",
        code: 456,
      });
    }
    // console.log("auth token: ", Req.headers);
    // let oauth = Req.headers.cookie?.split("=")[1].trim();
    //not using pre-sent-cookie due to a lot of values on it.
    // if (!oauth) {
    let oauth;
    try {
      oauth = Req.headers.authorization?.split(" ")[1].trim();
    } catch (err: any) {
      return Res.status(403).json({
        error: "access, blocked due to unauthorized access",
        code: 901,
      });
    }
    // }
    if (!oauth)
      return Res.status(403).json({
        error: "token not found!",
        code: 944,
      });
    // const token = new fernet.Token({
    //   secret: secret,
    //   token: oauth,
    //   ttl: 3600,
    // });
    // const token = CryptoJS.AES.decrypt(oauth, secretToken).toString(
    //   CryptoJS.enc.Utf8
    // );
    let decData = CryptoJS.enc.Base64.parse(oauth).toString(CryptoJS.enc.Utf8);
    let token = CryptoJS.AES.decrypt(decData, secretToken).toString(
      CryptoJS.enc.Utf8
    );
    token = token.replace(/"/g, "");
    const decodedJWT = jwt.verify(
      token as unknown as string,
      process.env.JWTVERIFIER as Secret
    ) as JwtPayload;

    const decodingJsecret = JSON.parse(
      cache.filter(
        (r) =>
          (JSON.parse(r).jsecret as string) === JSON.parse(decodedJWT.data).ssl
      )[0] || "{}"
    );
    if (!decodingJsecret.hasOwnProperty("room")) {
      return Res.status(403).json({
        error: "Encryption Failed!",
        code: 403,
      });
    }
    const ocsIp = JSON.parse(folder[0]).ips;
    if (ocsIp.length === 0)
      return Res.status(200).json({
        message: "ocp$notfound!",
        code: 200,
        ip,
      });
    const detectingIp = ocsIp.filter((IPV: IP) => IPV.ip === ip && IPV.isOc)[0];
    if (detectingIp.hasOwnProperty("ip")) {
      server.viceVersa(detectingIp.socketId, { room, socketId: server.id });
    }
    return Res.status(200).json({
      message: "Encryption succeed",
      code: 200,
      ip,
    });
  } catch (err: any) {
    return Res.status(403).json({
      error: "access, blocked due to unauthorized access",
      code: 901,
    });
  }
});

app.get(
  "/create-room/:payload/:passcode",
  async (Req: Request, Res: Response) => {
    const detecting = await detectIp(Req);
    if (detecting) {
      return Res.status(400).json({
        error: "end one room, before creating one",
        code: 400,
      });
    }
    const server = rtcServer(Req, Res) as RTC;
    // console.log("this the server: ", server);
    const payload = Req.params.payload;
    const passcode = Req.params.passcode;
    const endpoint = await server.createRoom(payload, Req, passcode);
    return Res.status(200).json({
      message: "room created, successfully",
      endpoint,
      code: 200,
    });
  }
);

app.get("/name/:name", async (Req: Request, Res: Response) => {
  const detecting = await detectIp(Req);
  if (detecting) {
    console.log("!!!!")
    return Res.status(400).json({
      error: "end one room, before creating one",
      code: 400,
    });
  }
  const server = rtcServer(Req, Res) as RTC;
  const name = Req.params.name;
  server.yourName = name;

  // console.log("setting name: ", name);
  return Res.status(200).json({
    message: "name, attached!",
    code: 200,
  });
});

backend.listen(8080, () => {
  console.log("server running on 8080");
});
