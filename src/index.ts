import cors from "cors";
import dotenv from 'dotenv';
import express from "express";
import 'express-async-errors';
import session, { SessionOptions } from 'express-session';
import { Document, Filter, MongoClient, ObjectId } from "mongodb";
import * as crypto from 'crypto';
import { GameDay } from "./types";
import { createServer } from "http";
import { Server } from "socket.io";
import MongoStore from 'connect-mongo';

dotenv.config();

const env = process.env.NODE_ENV || 'development';
const corsOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://127.0.0.1:5500', 'http://localhost:5500', 'https://duly-charming-whale.ngrok-free.app'];
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
const mongoDbName = process.env.MONGO_DB_NAME || 'pelada';
const domain = process.env.COOKIE_DOMAIN || '';

const mongoClient = new MongoClient(mongoUrl);
const db = mongoClient.db(mongoDbName);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigins,
  }
});

io.on("connection", (socket) => {
  socket.on("join", (gameDayId: string) => {
    console.log('join', gameDayId);
    socket.join(gameDayId);
  });
  socket.on("leave", (gameDayId: string) => {
    console.log('leave', gameDayId);
    socket.leave(gameDayId);
  });

  socket.on("game-day:updated", (gameDayId: string) => {
    socket.to(gameDayId).emit('game-day:updated');
  })
});

app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

app.use(express.json());

const sessionOptions: SessionOptions = {
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  name: 'pelada.sid',
  store: MongoStore.create({
    client: mongoClient,
    dbName: mongoDbName,
  }),
  cookie: {
    domain,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  }
}

if(env === 'production') {
  app.set('trust proxy', 1);
  sessionOptions.cookie!.secure = true;
  sessionOptions.cookie!.sameSite = 'none';
}

app.use(session(sessionOptions));

const gameDaysCollection = db.collection<GameDay>('game-days');

const getGameDayPlayersWithRatings = async (gameDayId: ObjectId) => {
  const result = gameDaysCollection.aggregate([
    {
      $match: {
        _id: gameDayId,
      },
    },
    {
      $unwind: "$players", 
    },
    {
      $lookup: {
        from: "players",
        localField: "players.name",
        foreignField: "name",
        as: "playerWithRating",
      },
    },
    {
      $unwind: "$playerWithRating",
    },
    {
      $addFields: {
        mergedPlayer: {
          $mergeObjects: ["$players", "$playerWithRating"],
        },
      },
    },
    {
      $group: {
        _id: "$_id", 
        players: {
          $push: "$mergedPlayer",
        },
      },
    },
  ]);
  if(!result.hasNext()) {
    return [];
  }

  return (await result.next())?.players ?? [];
}


app.get('/game-days', async (req, res) => {
  const gameDays = await db.collection('game-days').find({}).sort({
    playedOn: -1
  }).toArray();
  res.json(gameDays.map(({ _id, ...data }) => ({
    id: _id,
    ...data,
  })));
})

app.post('/game-days', async (req, res) => {
  const joinCode = crypto.randomBytes(2).toString('hex').toUpperCase();

  const court = {
    _id: new ObjectId(),
    autoSwitchTeamsPoints: req.body.autoSwitchTeamsPoints,
    maxPoints: req.body.maxPoints,
    playersPerTeam: req.body.playersPerTeam,
    playingTeams: req.body.playingTeams,
  }

  const created = await gameDaysCollection.insertOne({
    _id: new ObjectId(),
    autoSwitchTeamsPoints: req.body.autoSwitchTeamsPoints,
    maxPoints: req.body.maxPoints,
    playersPerTeam: req.body.playersPerTeam,
    extraCourts: [court],
    isLive: req.body.isLive,
    matches: req.body.matches,
    players: req.body.players,
    joinCode,
    joinCodeExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
    playedOn: new Date(req.body.playedOn),
  });

  req.session.gameDayId = created.insertedId.toHexString();
  req.session.courtId = court._id.toHexString();
  
  res.status(201).json({
    id: created.insertedId,
    courtId: court._id,
    joinCode,
  });
})

app.put('/game-days/join/:code', async (req, res) => {
  const gameDay = await gameDaysCollection.findOne({
    joinCode: req.params.code,
    joinCodeExpiration: {
      $gt: new Date()
    }
  });
  if (!gameDay) {
    res.status(404).end();
    return;
  }

  const courtId = new ObjectId();
  const newCourt = {
    _id: courtId,
    autoSwitchTeamsPoints: gameDay.autoSwitchTeamsPoints,
    maxPoints: gameDay.maxPoints,
    playersPerTeam: gameDay.playersPerTeam,
    playingTeams: [],
  }

  await gameDaysCollection.updateOne({
    _id: gameDay._id
  }, {
    $push: {
      extraCourts: newCourt
    },
  });
  io.to(gameDay._id.toHexString()).emit('game-day:updated');

  req.session.gameDayId = gameDay._id.toHexString();
  req.session.courtId = courtId.toHexString();
  res.status(200).json({
    id: gameDay._id,
    courtId,
    otherPlayingTeams: [
      ...gameDay.extraCourts?.map(court => court.playingTeams).flat() ?? [],
    ],
    ...gameDay,
    ...newCourt,
  })
});

app.get('/sessions/game-day', async (req, res) => {
  const id = req.session.gameDayId;
  if (!id) {
    res.status(404).end();
    return;
  }
  const gameDay = await gameDaysCollection.findOne({
    _id: new ObjectId(id),
    isLive: true,
  });
  if (!gameDay) {
    res.status(404).end();
    return;
  }

  const playersWithRatings = await getGameDayPlayersWithRatings(gameDay._id);
  
  if(req.session.courtId) {
    const courtId = new ObjectId(req.session.courtId);
    const court = gameDay.extraCourts?.find(court => court._id.equals(courtId));
    if(!court) {
      res.status(404).end();
      return;
    }
    const otherPlayingTeams = gameDay.extraCourts?.filter(court => !court._id.equals(courtId)).map(court => court.playingTeams).flat() ?? [];

    if(court) {
      res.json({
        id,
        courtId,
        otherPlayingTeams: [
          ...otherPlayingTeams,
        ],
        ...gameDay,
        ...court,
        players: playersWithRatings,
      });
    }
    return;
  }

  res.json({
    id,
    otherPlayingTeams:
      gameDay.extraCourts?.map((court) => court.playingTeams).flat() ?? [],
    ...gameDay,
    players: playersWithRatings,
  });
});
app.put('/sessions/game-day', async (req, res) => {
  const id = req.session.gameDayId;
  const courtId = req.session.courtId;
  if (!id) {
    res.status(404).end();
    return;
  }

  if(req.body.isLive === false) {
    req.session.destroy((err) => {
      if(err) {
        console.log('err session.destroy()', err)
      }
    });
  }


  if(courtId) {
    const result = await gameDaysCollection.updateOne({
      _id: new ObjectId(id),
      "extraCourts._id": new ObjectId(courtId),
    }, {
      $set: {
        "extraCourts.$.playingTeams": req.body.playingTeams,
        "extraCourts.$.autoSwitchTeamsPoints": req.body.autoSwitchTeamsPoints,
        "extraCourts.$.maxPoints": req.body.maxPoints,
        "extraCourts.$.playersPerTeam": req.body.playersPerTeam,
        players: req.body.players,
        matches: req.body.matches,
        isLive: req.body.isLive,
      }
    });

    if(result.matchedCount === 0) {
      res.status(404).end();
      return;
    }

    res.status(200).end();
    return;
  }

  const result = await gameDaysCollection.updateOne({
    _id: new ObjectId(id),
  },
  {
    $set: req.body
  });
  if(result.matchedCount === 0) {
    res.status(404).end();
    return;
  }
  res.status(200).end();
});

app.put('/sessions/game-day/leave', async (req, res) => {
  if(!req.session.gameDayId || !req.session.courtId) {
    res.status(404).end();
    return;
  }

  // clean playing teams from court
  const result = await gameDaysCollection
    .updateOne({
      _id: new ObjectId(req.session.gameDayId),
      "extraCourts._id": new ObjectId(req.session.courtId),
    }, {
      $set: {
        "extraCourts.$.playingTeams": [],
      }
    });
  if(result.matchedCount === 0) {
    res.status(404).end();
    return;
  }
  req.session.destroy(() => {
    res.status(200).end();
  });
});

app.put('/players', async (req, res) => {
  const existing = await db.collection('players').findOne({
    name: req.body.name
  });

  if (existing) {
    res.status(200).end();
    return;
  }

  const result = await db.collection('players').insertOne(req.body);
  res.status(201).json({
    id: result.insertedId,
  });
})

app.get('/players', async (req, res) => {
  const query: Filter<Document> = {}

  if(typeof req.query.name === 'string') {
    query.name = {
      $in: req.query.name.split(',')
    }
  }
  const players = await db.collection('players').find(query).toArray();
  res.json(players.map(({ _id, ...data }) => ({
    id: _id,
    ...data,
  })));
})

app.put('/players/bulk', async (req, res) => {
  const gameDayId = req.session.gameDayId;
  if(!gameDayId) {
    res.status(401).end();
  }
  const bulk = db.collection('players').initializeOrderedBulkOp();
  req.body.forEach((player: { name: string, mu: number, sigma: number }) => {
    bulk.find({ name : player.name }).upsert().updateOne({
      $set: {
        mu: player.mu,
        sigma: player.sigma,
      }
    });
  });
  await bulk.execute();
  res.status(200).end();
})

app.post('/migrations/to-database', async (req, res) => {
  const migrations = await db.collection('migrations').find({}).toArray();
  if(migrations.find(migration => migration.name === 'to-database')) {
    res.status(200).end();
    return;
  }

  const { gameDays, players } = req.body;
  
  if(players){
    await db.collection('players').deleteMany({});
    await db.collection('players').insertMany(Object.entries<{ mu: number, sigma: number }>(players).map(([name, { mu, sigma }]) => ({
      name,
      mu,
      sigma,
    })));
  }

  if(gameDays){
    await db.collection('game-days').deleteMany({});
    await db.collection('game-days').insertMany(gameDays?.map((gameDay: any) => {
      const playedOn = gameDay.playedOn.split('/').reverse().join('-');
      return {
        ...gameDay,
        playedOn: new Date(playedOn),
      };
    }));
  }
  await db.collection('migrations').insertOne({
    date: new Date(),
    name: 'to-database',
  });
  res.status(201).end();
})



async function main() {
  try {
    await mongoClient.connect();
    console.log('Connected to the database');
    const PORT = process.env.PORT || 4000;
    httpServer.listen(PORT, () => {
      console.log(`Server is running on ${PORT}`);
    });
  } catch (e) {
    console.error(e);
  }
}

main();