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

export type GameDay = {
  _id: ObjectId;
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