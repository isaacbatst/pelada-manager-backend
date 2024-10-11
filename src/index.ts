import cors from "cors";
import express from "express";
import 'express-async-errors';
import { Document, Filter, MongoClient, ObjectId } from "mongodb";
import dotenv from 'dotenv';
import session, { SessionOptions } from 'express-session';
dotenv.config();

const env = process.env.NODE_ENV || 'development';
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
const mongoDbName = process.env.MONGO_DB_NAME || 'pelada';
const domain = process.env.DOMAIN || 'localhost';

const client = new MongoClient(mongoUrl);
const db = client.db(mongoDbName);

const app = express();
app.use(cors());
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
    sameSite: 'none',
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
  const created = await db.collection('game-days').insertOne(req.body);
  res.status(201).json({
    id: created.insertedId,
  });
})

app.put('/game-days/:id', async (req, res) => {
  const id = req.params.id;
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