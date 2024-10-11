import cors from "cors";
import dotenv from 'dotenv';
import express from "express";
import 'express-async-errors';
import session, { SessionOptions } from 'express-session';
import { Document, Filter, MongoClient, ObjectId } from "mongodb";
import * as crypto from 'crypto';
dotenv.config();

const env = process.env.NODE_ENV || 'development';
const corsOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://127.0.0.1:5500', 'http://localhost:5500']
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
const mongoDbName = process.env.MONGO_DB_NAME || 'pelada';
const domain = process.env.COOKIE_DOMAIN || '';

const client = new MongoClient(mongoUrl);
const db = client.db(mongoDbName);

const app = express();
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
}

app.use(session(sessionOptions));

app.get('/game-days', async (req, res) => {
  console.log('req.session', req.session);
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
  const created = await db.collection('game-days').insertOne({
    ...req.body,
    joinCode,
    playedOn: new Date(req.body.playedOn),
  });

  req.session.gameDayId = created.insertedId.toHexString();

  res.status(201).json({
    id: created.insertedId,
    joinCode,
  });
})

app.put('/game-days/join/:code', async (req, res) => {
  const gameDay = await db.collection('game-days').findOne({
    joinCode: req.params.code
  });
  if (!gameDay) {
    res.status(404).end();
    return;
  }
  req.session.gameDayId = gameDay._id.toHexString();
  res.status(200).json(gameDay)
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


app.get('/sessions/game-day', async (req, res) => {
  const id = req.session.gameDayId;
  console.log('session', req.session)
  if (!id) {
    res.status(404).end();
    return;
  }
  const gameDay = await db.collection('game-days').findOne({
    _id: new ObjectId(id),
    isLive: true,
  });
  if (!gameDay) {
    res.status(404).end();
    return;
  }
  res.json({
    id,
    ...gameDay,
  });
});
app.put('/sessions/game-day', async (req, res) => {
  const id = req.session.gameDayId;
  if (!id) {
    res.status(404).end();
    return;
  }
  const result = await db.collection('game-days').updateOne({
    _id: new ObjectId(id)
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


async function main() {
  try {
    await client.connect();
    console.log('Connected to the database');
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (e) {
    console.error(e);
  }
}

main();