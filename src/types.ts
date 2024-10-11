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
  playingTeams: GameDayPlayer[][];
  matches: number;
  isLive: boolean;
  autoSwitchTeamsPoints: number;
  playedOn: Date;
  joinCode: string;
  extraCourts?: {
    _id: ObjectId;
    maxPoints: number;
    playersPerTeam: string;
    playingTeams: GameDayPlayer[][];
    autoSwitchTeamsPoints: number;
  }[]
}