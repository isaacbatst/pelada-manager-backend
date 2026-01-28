import { ObjectId } from "mongodb"

type GameDayPlayer = {
  name: string;
  matches: number;
  victories: number;
  defeats: number;
  lastPlayedMatch: number;
  playing: boolean;
  order: number;
}

export type GameGroup = {
  _id: ObjectId;
  name: string;
  createdAt: Date;
  inviteCode: string;
  inviteCodeExpiration: Date;
  players: GameDayPlayer[];
  deletedAt?: Date;
}

export type GameDay = {
  _id: ObjectId;
  groupId: ObjectId;
  maxPoints: number;
  playersPerTeam: string;
  players: GameDayPlayer[];
  isLive: boolean;
  autoSwitchTeamsPoints: number;
  playedOn: Date;
  joinCode: string;
  joinCodeExpiration: Date;
  playersToNextGame: GameDayPlayer[];
  extraCourts?: {
    _id: ObjectId;
    maxPoints: number;
    matches: number;
    playersPerTeam: string;
    playingTeams: GameDayPlayer[][];
    autoSwitchTeamsPoints: number;
  }[]
}