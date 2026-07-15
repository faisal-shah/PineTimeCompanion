export type RootStackParamList = {
  WatchList: undefined;
  WatchDetail: { watchId: string };
  EventEdit: { watchId: string; eventId?: number };
  WatchPair: { watchId: string };
  PrayerSettings: { watchId: string };
  Beacon: { watchId: string };
  AppleLogin: undefined;
};
